// @vitest-environment node
import { randomBytes } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, fakeClient, member, type FakeState } from "../helpers/fake-supabase";

// Gmail inbox agent with an in-memory Supabase and a fake fetch for Google and Cloudflare.
// Nothing here touches the network.

let state: FakeState;
vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(async () => fakeClient(state)),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  }),
}));

const gmail = await import("@/lib/integrations/gmail");
const { checkReplies, analyzeReply, getInboxView } = await import("@/modules/inbox/service");
const { checkRepliesAction } = await import("@/modules/inbox/actions");
const { matchReference, referenceMap, priceIsGrounded } = await import("@/modules/inbox/rules");
const { emailReference } = await import("@/modules/email/rules");
const connect = await import("@/app/api/integrations/gmail/connect/route");
const callback = await import("@/app/api/integrations/gmail/callback/route");

const EVENT = "11111111-1111-4111-8111-111111111111";
const OTHER_EVENT = "22222222-2222-4222-8222-222222222222";
const VENDOR = "vendor@gmail.com";
const KEY = randomBytes(32).toString("base64");
const REF = emailReference(EVENT, "catering", "p1");
const event = {
  id: EVENT,
  owner_id: "owner",
  name: "Campus Hack 2026",
  event_type: "university_hackathon",
  status: "planning",
  venue_type: "indoor",
  location_text: "Main hall",
  city: "Dubai",
  country: "AE",
  timezone: "Asia/Dubai",
  starts_at: "2026-12-01T05:00:00Z",
  ends_at: "2026-12-02T14:00:00Z",
  capacity: 120,
  budget_amount: 50000,
  currency: "AED",
  services: ["catering"],
  additional_details: null,
};

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const msg = (id: string, subject: string, body: string, from = `Cafe One <${VENDOR}>`) => ({
  id,
  internalDate: String(Date.parse("2026-10-25T10:00:00Z")),
  payload: {
    mimeType: "multipart/alternative",
    headers: [
      { name: "From", value: from },
      { name: "Subject", value: subject },
    ],
    parts: [{ mimeType: "text/plain", body: { data: b64(body) } }],
  },
});
const QUOTE =
  "Hello, we can do catering on 1 Dec. The price is AED 4,500 for 120 guests. A 30% deposit is required.";

const fetchSpy = vi.fn();
let inbox: Record<string, ReturnType<typeof msg>> = {};
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });
function routeFetch() {
  fetchSpy.mockImplementation(async (input: string | URL) => {
    const url = String(input);
    if (url.includes("oauth2.googleapis.com/token"))
      return json({ access_token: "at", refresh_token: "rt" });
    if (url.endsWith("/profile")) return json({ emailAddress: "organizer@gmail.com" });
    if (url.includes("/messages?"))
      return json({ messages: Object.keys(inbox).map((id) => ({ id })) });
    const m = url.match(/\/messages\/([^?]+)\?/);
    if (m) return json(inbox[m[1]]);
    return new Response("unexpected", { status: 500 });
  });
}

let n = 0;
function setup(role: "owner" | "organizer" | "viewer" = "organizer", connected = true) {
  const user = `user-${++n}`;
  state = createFakeState({ sub: user });
  member(state, user, ["organizer"]);
  state.tables.events = [event];
  state.tables.event_members = [{ event_id: EVENT, user_id: user, role }];
  state.tables.event_vendor_shortlist = [
    {
      event_id: EVENT,
      category: "catering",
      place_id: "p1",
      name: "Cafe One",
      address: null,
      phone: null,
      website: null,
      latitude: 1,
      longitude: 1,
      note: null,
      created_at: "2026-10-24T00:00:00Z",
    },
  ];
  state.tables.vendor_replies = [];
  state.tables.gmail_connections = connected
    ? [
        {
          user_id: user,
          email: "organizer@gmail.com",
          refresh_token_enc: gmail.encryptToken("rt", Buffer.from(KEY, "base64")),
        },
      ]
    : [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "client-secret");
  vi.stubEnv("GMAIL_TOKEN_ENCRYPTION_KEY", KEY);
  vi.stubEnv("GMAIL_DEMO_VENDOR_EMAIL", VENDOR);
  return user;
}
const stored = (extra: Record<string, unknown> = {}) => ({
  id: "33333333-3333-4333-8333-333333333333",
  event_id: EVENT,
  category: "catering",
  place_id: "p1",
  reference: REF,
  gmail_message_id: "m1",
  from_email: VENDOR,
  from_name: "Cafe One",
  subject: `Re: Catering [${REF}]`,
  body: QUOTE,
  received_at: "2026-10-25T10:00:00Z",
  analysis: null,
  analyzed_at: null,
  ...extra,
});
const inserted = () =>
  state.writes.filter((w) => w.table === "vendor_replies" && w.op === "upsert");

beforeEach(() => {
  vi.unstubAllEnvs();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  inbox = {};
  routeFetch();
});

describe("reference matching and grounding", () => {
  it("only this event's codes match, from the subject or the quoted body", () => {
    const refs = referenceMap(EVENT, [{ category: "catering", place_id: "p1" }]);
    expect(matchReference({ subject: `Re: x [${REF}]`, body: "" }, refs)).toMatchObject({
      category: "catering",
      placeId: "p1",
      reference: REF,
    });
    expect(
      matchReference(
        { subject: "Re: hi", body: `> quoted [${emailReference(EVENT, "venue")}]` },
        refs,
      ),
    ).toMatchObject({ category: "venue", placeId: null });
    expect(
      matchReference({ subject: `[${emailReference(OTHER_EVENT, "venue")}]`, body: "" }, refs),
    ).toBeNull();
    expect(matchReference({ subject: "no code", body: "none" }, refs)).toBeNull();
  });
  it("a price must appear in the email", () => {
    expect(priceIsGrounded("AED 4,500 per day", QUOTE)).toBe(true);
    expect(priceIsGrounded("AED 9,999", QUOTE)).toBe(false);
    expect(priceIsGrounded(null, QUOTE)).toBe(true);
    expect(priceIsGrounded("free", QUOTE)).toBe(false);
  });
});

describe("Gmail client", () => {
  it("encrypts tokens (round trip, no plain text, tamper-proof)", () => {
    const key = Buffer.from(KEY, "base64");
    const enc = gmail.encryptToken("refresh-secret", key);
    expect(enc).not.toContain("refresh-secret");
    expect(gmail.decryptToken(enc, key)).toBe("refresh-secret");
    expect(() => gmail.decryptToken(enc.slice(0, -2) + "AA", key)).toThrow();
  });
  it("builds a read-only consent URL with the registered redirect URI", () => {
    setup();
    const u = new URL(gmail.authorizationUrl("st"));
    expect(u.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(u.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/integrations/gmail/callback",
    );
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("access_type")).toBe("offline");
  });
  it("parses sender, subject, time and plain-text body; ignores other senders", async () => {
    inbox = { a: msg("a", "Hi", "Body text"), b: msg("b", "Spam", "x", "Other <other@gmail.com>") };
    const out = await gmail.fetchMessagesFrom("at", VENDOR, 15, fetchSpy);
    expect(out).toEqual([
      {
        id: "a",
        fromEmail: VENDOR,
        fromName: "Cafe One",
        subject: "Hi",
        body: "Body text",
        receivedAt: "2026-10-25T10:00:00.000Z",
      },
    ]);
    expect(fetchSpy.mock.calls.every((c) => !c[1]?.method || c[1].method === "GET")).toBe(true);
  });
});

describe("OAuth routes", () => {
  const req = (path: string, cookie?: string) =>
    new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

  it("connect sets a state cookie and redirects to Google", async () => {
    setup();
    const res = await connect.GET(req(`/api/integrations/gmail/connect?event=${EVENT}`));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin).toBe("https://accounts.google.com");
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain(`gmail_oauth=${loc.searchParams.get("state")}.${EVENT}`);
    expect(cookie).toMatch(/HttpOnly/i);
  });
  it("callback rejects a missing or mismatched state and stores nothing", async () => {
    setup();
    const bad = await callback.GET(
      req(`/api/integrations/gmail/callback?code=c&state=evil`, `gmail_oauth=good.${EVENT}`),
    );
    expect(bad.headers.get("location")).toContain("gmail=failed");
    const none = await callback.GET(req(`/api/integrations/gmail/callback?code=c&state=good`));
    expect(none.headers.get("location")).toBe("http://localhost:3000/app");
    expect(state.writes.filter((w) => w.table === "gmail_connections")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("callback with a valid state stores only the encrypted refresh token", async () => {
    setup("organizer", false);
    const res = await callback.GET(
      req(`/api/integrations/gmail/callback?code=c&state=good`, `gmail_oauth=good.${EVENT}`),
    );
    expect(res.headers.get("location")).toContain("gmail=connected");
    const w = state.writes.find((x) => x.table === "gmail_connections")!;
    const row = w.values as { email: string; refresh_token_enc: string };
    expect(row.email).toBe("organizer@gmail.com");
    expect(row.refresh_token_enc).not.toContain("rt");
    expect(gmail.decryptToken(row.refresh_token_enc, Buffer.from(KEY, "base64"))).toBe("rt");
  });
});

describe("Check for replies", () => {
  it("stores only this event's replies from the vendor, once", async () => {
    setup();
    inbox = {
      m1: msg("m1", `Re: Catering quotation request [${REF}]`, QUOTE),
      m2: msg("m2", "Unrelated newsletter", "no code here"),
      m3: msg("m3", `Re: [${emailReference(OTHER_EVENT, "catering")}]`, "other event"),
    };
    expect(await checkReplies(EVENT)).toEqual({ added: 1, seen: 1 });
    expect(inserted()).toHaveLength(1);
    expect(inserted()[0].values).toMatchObject({
      event_id: EVENT,
      place_id: "p1",
      gmail_message_id: "m1",
      from_email: VENDOR,
      body: QUOTE,
    });
  });
  it("does not store a reply twice", async () => {
    setup();
    state.tables.vendor_replies = [stored()];
    inbox = { m1: msg("m1", `Re: [${REF}]`, QUOTE) };
    expect(await checkReplies(EVENT)).toEqual({ added: 0, seen: 1 });
    expect(inserted()).toHaveLength(0);
    const r = await checkRepliesAction(EVENT, {}, new FormData());
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/already shown/) });
  });
  it("the action reports new replies as a notification", async () => {
    setup();
    inbox = { m1: msg("m1", `Re: [${REF}]`, QUOTE) };
    expect(await checkRepliesAction(EVENT, {}, new FormData())).toEqual({
      ok: true,
      message: "1 new vendor reply received.",
    });
  });
  it("needs a connection; viewers are refused; no Google call without them", async () => {
    setup("organizer", false);
    await expect(checkReplies(EVENT)).rejects.toMatchObject({ code: "conflict" });
    setup("viewer");
    await expect(checkReplies(EVENT)).rejects.toMatchObject({ code: "forbidden" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("a Google failure becomes an organizer-friendly error", async () => {
    setup();
    fetchSpy.mockResolvedValue(new Response("no", { status: 401 }));
    await expect(checkReplies(EVENT)).rejects.toMatchObject({
      message: expect.stringMatching(/Connect Gmail again/),
    });
  });
  it("shows replied vendors on the dashboard view", async () => {
    setup();
    state.tables.vendor_replies = [stored()];
    const v = await getInboxView(EVENT);
    expect(v).toMatchObject({
      available: true,
      connectedAs: "organizer@gmail.com",
      vendorEmail: VENDOR,
    });
    expect(v.replies[0]).toMatchObject({ vendorName: "Cafe One", from_email: VENDOR });
  });
});

describe("Analyze reply (Cloudflare via the gateway, fake fetch)", () => {
  const enableAi = () => {
    vi.stubEnv("AI_PROVIDER", "cloudflare");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-token-not-real");
    vi.stubEnv("AI_PLAN_MODEL", "@cf/test/model-1");
  };
  const cf = (response: unknown) => json({ success: true, errors: [], result: { response } });
  const GOOD = {
    price: "AED 4,500 for 120 guests",
    availability: "Available on 1 Dec",
    serviceDetails: ["Catering for 120"],
    conditions: ["30% deposit required"],
  };

  it("one request; saves the extraction; a second click makes no request", async () => {
    setup();
    enableAi();
    state.tables.vendor_replies = [stored()];
    fetchSpy.mockResolvedValueOnce(cf(GOOD));
    expect(await analyzeReply(EVENT, stored().id)).toEqual(GOOD);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(
      state.writes.find((w) => w.table === "vendor_replies" && w.op === "update")?.values,
    ).toMatchObject({ analysis: GOOD });
    // The prompt carries the email but no secrets.
    expect(String(fetchSpy.mock.calls[0][1].body)).toContain("AED 4,500");
    expect(String(fetchSpy.mock.calls[0][1].body)).not.toContain("test-token-not-real");

    state.tables.vendor_replies = [stored({ analysis: GOOD })];
    expect(await analyzeReply(EVENT, stored().id)).toEqual(GOOD);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  it("rejects an invented price and saves nothing", async () => {
    setup();
    enableAi();
    state.tables.vendor_replies = [stored()];
    fetchSpy.mockResolvedValueOnce(cf({ ...GOOD, price: "AED 1,200" }));
    await expect(analyzeReply(EVENT, stored().id)).rejects.toMatchObject({
      code: "ai_unavailable",
    });
    expect(state.writes.filter((w) => w.op === "update")).toEqual([]);
  });
  it("is unavailable without AI, for viewers and for unknown replies; never calls the model", async () => {
    setup();
    state.tables.vendor_replies = [stored()];
    await expect(analyzeReply(EVENT, stored().id)).rejects.toMatchObject({
      code: "not_configured",
    });
    enableAi();
    await expect(analyzeReply(EVENT, "44444444-4444-4444-8444-444444444444")).rejects.toMatchObject(
      { code: "not_found" },
    );
    setup("viewer");
    enableAi();
    await expect(analyzeReply(EVENT, stored().id)).rejects.toMatchObject({ code: "forbidden" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
