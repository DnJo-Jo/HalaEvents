import "server-only";
import { z } from "zod";
import { parseServerEnv, type ServerEnv } from "@/lib/env.server";
import { createCloudflareProvider } from "./cloudflare";
import type { AiErrorCode, AiProvider, Usage } from "./types";

/**
 * Shared AI gateway (event.md §17.7). Agents build prompts; the gateway enforces the input limit,
 * makes exactly one provider request, and accepts the output only if it is JSON that passes the
 * Zod schema and the caller's business checks. There are no retries, no repair turns and no
 * fallback: a failure is returned to the caller, which stores nothing.
 */

export interface AiLimits {
  maxOutputTokens: number;
  maxInputChars: number;
  timeoutMs: number;
}

export interface AiSetup {
  provider: AiProvider;
  limits: AiLimits;
  /** How much of a custom plan the model writes (AI_PLAN_STRATEGY). */
  planStrategy: "full" | "hybrid";
}

/** The configured provider, or null when AI_PROVIDER=none. Never makes a request. */
export function aiSetup(
  env: ServerEnv = parseServerEnv(),
  fetchImpl: typeof fetch = fetch,
): AiSetup | null {
  if (env.AI_PROVIDER !== "cloudflare") return null;
  // parseServerEnv guarantees these when AI_PROVIDER=cloudflare.
  const provider = createCloudflareProvider(
    {
      accountId: env.CLOUDFLARE_ACCOUNT_ID!,
      apiToken: env.CLOUDFLARE_API_TOKEN!,
      model: env.AI_PLAN_MODEL!,
    },
    fetchImpl,
  );
  return {
    provider,
    limits: {
      maxOutputTokens: env.AI_PLAN_MAX_OUTPUT_TOKENS,
      maxInputChars: env.AI_MAX_INPUT_CHARS,
      timeoutMs: env.AI_TIMEOUT_MS,
    },
    planStrategy: env.AI_PLAN_STRATEGY,
  };
}

export interface CallMeta {
  provider: AiProvider["id"];
  model: string;
  /** Provider requests made: 0 when the input was refused before sending, else 1. */
  requests: 0 | 1;
  latencyMs: number;
  usage?: Usage;
  inputChars: number;
  retryAfterSeconds?: number;
  /** Number of validation problems (never their text, which may echo model output). */
  validationErrors?: number;
}

export type GenerateResult<T> =
  { ok: true; data: T; meta: CallMeta } | { ok: false; code: AiErrorCode; meta: CallMeta };

export interface GenerateRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Business-rule checks after the schema; any error rejects the output. */
  check?: (value: T) => string[];
  temperature?: number;
}

const schemaCache = new WeakMap<z.ZodType, Record<string, unknown>>();
/** JSON Schema for provider-side JSON mode; computed once per schema. */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  let json = schemaCache.get(schema);
  if (!json) {
    json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Record<
      string,
      unknown
    >;
    delete json.$schema;
    schemaCache.set(schema, json);
  }
  return json;
}

/** Parses model text as JSON (tolerating a ```json fence) and validates it. */
export function parseOutput<T>(
  text: string,
  schema: z.ZodType<T>,
  check?: (value: T) => string[],
): { ok: true; data: T } | { ok: false; errors: number } {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { ok: false, errors: 1 };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.length };
  const problems = check?.(parsed.data) ?? [];
  return problems.length ? { ok: false, errors: problems.length } : { ok: true, data: parsed.data };
}

export async function generateJson<T>(
  setup: AiSetup,
  req: GenerateRequest<T>,
): Promise<GenerateResult<T>> {
  const { provider, limits } = setup;
  const inputChars = req.system.length + req.user.length;
  const base = { provider: provider.id, model: provider.model, inputChars };
  if (inputChars > limits.maxInputChars) {
    return { ok: false, code: "input_too_large", meta: { ...base, requests: 0, latencyMs: 0 } };
  }

  const started = Date.now();
  const res = await provider.complete({
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    jsonSchema: jsonSchemaFor(req.schema),
    maxOutputTokens: limits.maxOutputTokens,
    temperature: req.temperature ?? 0.2,
    timeoutMs: limits.timeoutMs,
  });
  const meta: CallMeta = { ...base, requests: 1, latencyMs: Date.now() - started };
  if (!res.ok) {
    return {
      ok: false,
      code: res.code,
      meta: {
        ...meta,
        ...(res.retryAfterSeconds ? { retryAfterSeconds: res.retryAfterSeconds } : {}),
      },
    };
  }
  if (res.usage) meta.usage = res.usage;
  const out = parseOutput(res.text, req.schema, req.check);
  if (!out.ok)
    return { ok: false, code: "invalid_output", meta: { ...meta, validationErrors: out.errors } };
  return { ok: true, data: out.data, meta };
}
