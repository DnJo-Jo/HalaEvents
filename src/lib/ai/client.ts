import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { logAiAttempt, type AiLogEntry } from "./log";
import type { AiErrorCode, AiPipeline, AiProvider, ProviderResult, Usage } from "./types";

/**
 * The shared AI client. Every model call in the app goes through `generate()`, which:
 * - gives each attempt its own timeout (AbortSignal);
 * - retries a transient failure (timeout, network, 5xx) once, with a short backoff;
 * - never retries a quota/rate-limit error inside a request (no retry loops against a quota);
 * - parses the text as JSON, validates it with the Zod schema and the caller's semantic checks, and
 *   on failure asks the model once to repair its answer, quoting the validation errors;
 * - returns data only when it passed validation.
 * At most AI_LIMITS.maxAttempts provider calls are made per request.
 */
export const AI_LIMITS = {
  maxAttempts: 3,
  transientRetries: 1,
  repairRetries: 1,
  defaultTimeoutMs: 30_000,
  backoffMs: 500,
  maxOutputTokens: 8192,
} as const;

export interface GenerateRequest<T> {
  pipeline: AiPipeline;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  /** Business-rule checks after the schema (unknown ids, cycles, dates…). Errors trigger a repair. */
  validate?: (data: T) => string[];
  context?: unknown;
  temperature?: number;
  timeoutMs?: number;
  requestId?: string;
  /** Test hooks. */
  sleep?: (ms: number) => Promise<void>;
  logger?: (entry: AiLogEntry) => void;
}

interface Meta {
  requestId: string;
  model: string;
  attempts: number;
  latencyMs: number;
  usage: Usage;
}
export type GenerateResult<T> =
  | ({ ok: true; data: T } & Meta)
  | ({
      ok: false;
      error: { code: AiErrorCode; message: string; retryAfterSeconds?: number };
    } & Meta);

const schemaCache = new WeakMap<z.ZodType, Record<string, unknown>>();

/** JSON Schema for provider-side structured output; computed once per schema. */
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

function parseText<T>(text: string, schema: z.ZodType<T>, validate?: (d: T) => string[]) {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    return { ok: false as const, errors: ["The response was not valid JSON."] };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false as const,
      errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  const errors = validate?.(parsed.data) ?? [];
  return errors.length ? { ok: false as const, errors } : { ok: true as const, data: parsed.data };
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function generate<T>(
  provider: AiProvider,
  req: GenerateRequest<T>,
): Promise<GenerateResult<T>> {
  const requestId = req.requestId ?? randomUUID();
  const sleep = req.sleep ?? wait;
  const logger = req.logger ?? logAiAttempt;
  const jsonSchema = jsonSchemaFor(req.schema);
  const messages: { role: "user" | "model"; content: string }[] = [
    { role: "user", content: req.prompt },
  ];
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const started = Date.now();
  let model = provider.model;
  let transient = 0;
  let repairs = 0;
  let last: { code: AiErrorCode; message: string; retryAfterSeconds?: number } = {
    code: "provider_error",
    message: "No attempt was made.",
  };

  for (let attempt = 1; attempt <= AI_LIMITS.maxAttempts; attempt++) {
    const t0 = Date.now();
    const log = (outcome: AiLogEntry["outcome"], extra: Partial<AiLogEntry> = {}) =>
      logger({
        requestId,
        pipeline: req.pipeline,
        provider: provider.name,
        model,
        attempt,
        outcome,
        latencyMs: Date.now() - t0,
        ...extra,
      });

    const res: ProviderResult = await provider
      .generate({
        pipeline: req.pipeline,
        system: req.system,
        messages,
        jsonSchema,
        temperature: req.temperature ?? 0.2,
        maxOutputTokens: AI_LIMITS.maxOutputTokens,
        signal: AbortSignal.timeout(req.timeoutMs ?? AI_LIMITS.defaultTimeoutMs),
        context: req.context,
      })
      .catch(() => ({
        ok: false as const,
        code: "provider_error" as const,
        message: "The AI provider failed.",
      }));

    if (res.usage) {
      usage.inputTokens += res.usage.inputTokens;
      usage.outputTokens += res.usage.outputTokens;
    }
    const meta = (): Meta => ({
      requestId,
      model,
      attempts: attempt,
      latencyMs: Date.now() - started,
      usage,
    });

    if (!res.ok) {
      log(res.code, {
        retryAfterSeconds: "retryAfterSeconds" in res ? res.retryAfterSeconds : undefined,
      });
      last = {
        code: res.code,
        message: res.message,
        retryAfterSeconds: "retryAfterSeconds" in res ? res.retryAfterSeconds : undefined,
      };
      const retryable = "retryable" in res && res.retryable === true;
      if (retryable && transient < AI_LIMITS.transientRetries && attempt < AI_LIMITS.maxAttempts) {
        transient++;
        await sleep(AI_LIMITS.backoffMs * 2 ** (transient - 1));
        continue;
      }
      return { ok: false, error: last, ...meta() };
    }

    model = res.model;
    const parsed = parseText(res.text, req.schema, req.validate);
    if (parsed.ok) {
      log("ok", { inputTokens: res.usage?.inputTokens, outputTokens: res.usage?.outputTokens });
      return { ok: true, data: parsed.data, ...meta() };
    }
    last = { code: "invalid_output", message: "The AI response didn't pass validation." };
    if (repairs >= AI_LIMITS.repairRetries || attempt >= AI_LIMITS.maxAttempts) {
      log("invalid_output");
      return { ok: false, error: last, ...meta() };
    }
    log("repair");
    repairs++;
    messages.push(
      { role: "model", content: res.text.slice(0, 8000) },
      {
        role: "user",
        content:
          "Your previous JSON was rejected for these reasons:\n" +
          parsed.errors
            .slice(0, 12)
            .map((e) => `- ${e.slice(0, 200)}`)
            .join("\n") +
          "\nReturn the complete corrected JSON only, following the same schema and rules.",
      },
    );
  }
  return {
    ok: false,
    error: last,
    requestId,
    model,
    attempts: AI_LIMITS.maxAttempts,
    latencyMs: Date.now() - started,
    usage,
  };
}
