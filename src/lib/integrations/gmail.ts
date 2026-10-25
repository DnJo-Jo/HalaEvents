import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { parseServerEnv } from "@/lib/env.server";

/**
 * Gmail read-only access (OAuth 2.0 web flow, no SDK). The organizer connects their own account;
 * HalaEvents can list and read messages and can never send, delete or change them. Every call is
 * made on explicit user action. The refresh token is stored encrypted (AES-256-GCM).
 */

const SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TIMEOUT_MS = 15_000;

export class GmailError extends Error {
  constructor(readonly code: "not_configured" | "auth_failed" | "failed") {
    super(code);
  }
}

interface Config {
  clientId: string;
  clientSecret: string;
  key: Buffer;
  redirectUri: string;
  demoVendorEmail: string | null;
}

export function gmailConfig(): Config | null {
  let env;
  try {
    env = parseServerEnv();
  } catch {
    return null;
  }
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GMAIL_TOKEN_ENCRYPTION_KEY } = env;
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET || !GMAIL_TOKEN_ENCRYPTION_KEY)
    return null;
  const app = (env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return {
    clientId: GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: GOOGLE_OAUTH_CLIENT_SECRET,
    key: Buffer.from(GMAIL_TOKEN_ENCRYPTION_KEY, "base64"),
    redirectUri: `${app}/api/integrations/gmail/callback`,
    demoVendorEmail: env.GMAIL_DEMO_VENDOR_EMAIL?.toLowerCase() ?? null,
  };
}

function need(): Config {
  const c = gmailConfig();
  if (!c) throw new GmailError("not_configured");
  return c;
}

export function encryptToken(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decryptToken(stored: string, key: Buffer): string {
  const [iv, tag, enc] = stored.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !enc) throw new GmailError("failed");
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

/** Consent-screen URL. `state` is checked by the callback against a cookie (CSRF protection). */
export function authorizationUrl(state: string): string {
  const c = need();
  const q = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${q.toString()}`;
}

async function post(url: string, form: Record<string, string>, fetchImpl: typeof fetch) {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok)
    throw new GmailError(res.status === 400 || res.status === 401 ? "auth_failed" : "failed");
  return (await res.json()) as Record<string, unknown>;
}

async function get(path: string, accessToken: string, fetchImpl: typeof fetch) {
  const res = await fetchImpl(`${API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok)
    throw new GmailError(res.status === 401 || res.status === 403 ? "auth_failed" : "failed");
  return (await res.json()) as Record<string, unknown>;
}

/** Callback step: code → account email + encrypted refresh token. Tokens are never logged. */
export async function connectWithCode(
  code: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ email: string; refreshTokenEnc: string }> {
  const c = need();
  const t = await post(
    TOKEN_URL,
    {
      code,
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uri: c.redirectUri,
      grant_type: "authorization_code",
    },
    fetchImpl,
  );
  const refresh = t.refresh_token;
  const access = t.access_token;
  if (typeof refresh !== "string" || typeof access !== "string")
    throw new GmailError("auth_failed");
  const profile = await get("/profile", access, fetchImpl);
  const email = profile.emailAddress;
  if (typeof email !== "string") throw new GmailError("failed");
  return { email, refreshTokenEnc: encryptToken(refresh, c.key) };
}

export async function accessTokenFor(
  refreshTokenEnc: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const c = need();
  const t = await post(
    TOKEN_URL,
    {
      refresh_token: decryptToken(refreshTokenEnc, c.key),
      client_id: c.clientId,
      client_secret: c.clientSecret,
      grant_type: "refresh_token",
    },
    fetchImpl,
  );
  if (typeof t.access_token !== "string") throw new GmailError("auth_failed");
  return t.access_token;
}

export interface GmailMessage {
  id: string;
  fromEmail: string;
  fromName: string | null;
  subject: string;
  body: string;
  receivedAt: string;
}

const b64url = (s: string) =>
  Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

interface Part {
  mimeType?: string;
  body?: { data?: string };
  parts?: Part[];
  headers?: { name: string; value: string }[];
}

/** Plain-text body: the first text/plain part, else tag-stripped text/html. */
function bodyText(part: Part): string {
  const find = (p: Part, type: string): string | null => {
    if (p.mimeType === type && p.body?.data) return b64url(p.body.data);
    for (const child of p.parts ?? []) {
      const r = find(child, type);
      if (r !== null) return r;
    }
    return null;
  };
  const plain = find(part, "text/plain");
  if (plain !== null) return plain;
  const html = find(part, "text/html");
  return html === null
    ? ""
    : html
        .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
        .replace(/<br\s*\/?>|<\/p>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&");
}

export function parseMessage(raw: Record<string, unknown>): GmailMessage | null {
  const payload = raw.payload as Part | undefined;
  if (typeof raw.id !== "string" || !payload) return null;
  const header = (n: string) =>
    payload.headers?.find((h) => h.name.toLowerCase() === n)?.value ?? "";
  const from = header("from");
  const m = from.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/);
  const fromEmail = (m ? m[2] : from).trim().toLowerCase();
  const fromName = m?.[1]?.trim() || null;
  const ms = Number(raw.internalDate);
  if (!fromEmail || !Number.isFinite(ms)) return null;
  return {
    id: raw.id,
    fromEmail,
    fromName,
    subject: header("subject"),
    body: bodyText(payload).replace(/\r\n/g, "\n").trim(),
    receivedAt: new Date(ms).toISOString(),
  };
}

/** The newest messages received from one address (read-only: list + get). */
export async function fetchMessagesFrom(
  accessToken: string,
  sender: string,
  max = 15,
  fetchImpl: typeof fetch = fetch,
): Promise<GmailMessage[]> {
  const q = new URLSearchParams({ q: `from:${sender}`, maxResults: String(max) });
  const list = await get(`/messages?${q.toString()}`, accessToken, fetchImpl);
  const ids = ((list.messages as { id: string }[] | undefined) ?? []).map((m) => m.id);
  const full = await Promise.all(
    ids.map((id) => get(`/messages/${encodeURIComponent(id)}?format=full`, accessToken, fetchImpl)),
  );
  return full
    .map(parseMessage)
    .filter((m): m is GmailMessage => m !== null && m.fromEmail === sender.toLowerCase());
}
