import "server-only";
import { z } from "zod";
import type { AiProvider, ProviderRequest, ProviderResult, Usage } from "./types";

/**
 * Google Gemini (Google AI Studio API key) over the REST `generateContent` endpoint, with
 * JSON-schema structured output. Plain `fetch` instead of `@google/genai`: the npm registry is not
 * reachable from the dev machine, and the REST API is the documented contract the SDK wraps
 * (event.md §17.1). This is the only file that talks to Google.
 *
 * The API key travels in the `x-goog-api-key` header, never in the URL, and is never logged or
 * echoed in errors.
 */

const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
/** Model ids look like "gemini-2.5-flash"; anything else could alter the request path. */
export const GeminiModelName = z.string().regex(/^[a-z0-9][a-z0-9.-]{0,79}$/);

const Envelope = z.object({
  candidates: z
    .array(
      z.object({
        content: z
          .object({ parts: z.array(z.object({ text: z.string().optional() })).optional() })
          .optional(),
        finishReason: z.string().optional(),
      }),
    )
    .optional(),
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
    })
    .optional(),
  modelVersion: z.string().optional(),
});

const ErrorBody = z.object({
  error: z.object({
    code: z.number().optional(),
    status: z.string().optional(),
    message: z.string().optional(),
    details: z
      .array(
        z.object({ "@type": z.string().optional(), retryDelay: z.string().optional() }).loose(),
      )
      .optional(),
  }),
});

export interface GeminiOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createGeminiProvider(opts: GeminiOptions): AiProvider {
  const model = GeminiModelName.parse(opts.model);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${opts.baseUrl ?? DEFAULT_BASE_URL}/models/${model}:generateContent`;

  return {
    name: "gemini",
    model,
    isMock: false,
    async generate(req: ProviderRequest): Promise<ProviderResult> {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": opts.apiKey },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: req.system }] },
            contents: req.messages.map((m) => ({ role: m.role, parts: [{ text: m.content }] })),
            generationConfig: {
              responseMimeType: "application/json",
              responseJsonSchema: toGeminiSchema(req.jsonSchema),
              temperature: req.temperature,
              maxOutputTokens: req.maxOutputTokens,
              // Gemini 3.x spends output tokens on hidden thinking (1.3k for a tiny plan, verified live);
              // planning here is structured filling, so keep it low. Not valid for 2.x models.
              ...(model.startsWith("gemini-3") ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
            },
          }),
          signal: req.signal,
          cache: "no-store",
        });
      } catch (e) {
        const name = (e as { name?: string }).name;
        return name === "TimeoutError" || name === "AbortError"
          ? {
              ok: false,
              code: "timeout",
              message: "Gemini did not answer in time.",
              retryable: true,
            }
          : { ok: false, code: "network", message: "Couldn't reach Gemini.", retryable: true };
      }

      if (!res.ok) return mapHttpError(res.status, await res.json().catch(() => null));

      const body = Envelope.safeParse(await res.json().catch(() => null));
      if (!body.success)
        return { ok: false, code: "provider_error", message: "Unexpected Gemini response." };
      const usage: Usage | undefined = body.data.usageMetadata && {
        inputTokens: body.data.usageMetadata.promptTokenCount ?? 0,
        outputTokens: body.data.usageMetadata.candidatesTokenCount ?? 0,
      };
      if (body.data.promptFeedback?.blockReason) {
        return { ok: false, code: "provider_error", message: "Gemini blocked the request.", usage };
      }
      const candidate = body.data.candidates?.[0];
      if (!candidate)
        return { ok: false, code: "provider_error", message: "Gemini returned no answer.", usage };
      if (candidate.finishReason && candidate.finishReason !== "STOP") {
        // MAX_TOKENS → truncated JSON; SAFETY/RECITATION → no usable content.
        return {
          ok: false,
          code: "invalid_output",
          message: `Gemini stopped early (${candidate.finishReason.slice(0, 30)}).`,
          usage,
        };
      }
      const text = (candidate.content?.parts ?? []).map((p) => p.text ?? "").join("");
      return { ok: true, text, model: body.data.modelVersion ?? model, usage };
    },
  };
}

/**
 * Gemini accepts a subset of JSON Schema. Keep only widely supported keywords; everything removed
 * here (patterns, length limits, additionalProperties) is still enforced by Zod on the response.
 * minItems/maxItems are dropped too: Gemini 3.x answers 400 INVALID_ARGUMENT for the plan schema
 * with them (verified live 2026-10-22); the prompt states the array limits instead.
 */
const SCHEMA_KEYS = new Set([
  "type",
  "title",
  "description",
  "enum",
  "items",
  "minimum",
  "maximum",
  "anyOf",
  "properties",
  "required",
]);
export function toGeminiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toGeminiSchema);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (!SCHEMA_KEYS.has(k)) continue;
    out[k] =
      k === "properties"
        ? Object.fromEntries(Object.entries(v as object).map(([p, s]) => [p, toGeminiSchema(s)]))
        : toGeminiSchema(v);
  }
  return out;
}

function mapHttpError(status: number, raw: unknown): ProviderResult {
  const err = ErrorBody.safeParse(raw);
  const retryDelay = err.success
    ? err.data.error.details?.find((d) => d.retryDelay)?.retryDelay
    : undefined;
  const seconds = retryDelay ? Number.parseFloat(retryDelay) : NaN;
  // Google's own error text (never contains the key) goes to the server log only, for diagnosis.
  console.warn(
    JSON.stringify({
      msg: "gemini_http_error",
      status,
      error: err.success ? (err.data.error.message ?? "").slice(0, 300) : undefined,
    }),
  );
  switch (true) {
    case status === 429:
      return {
        ok: false,
        code: "rate_limited",
        message: "The Gemini quota or rate limit was reached.",
        retryAfterSeconds: Number.isFinite(seconds) ? Math.ceil(seconds) : undefined,
      };
    case status === 404:
      return {
        ok: false,
        code: "model_unavailable",
        message: "The configured Gemini model isn't available.",
      };
    case status === 401 || status === 403:
      return {
        ok: false,
        code: "not_configured",
        message: "Gemini rejected the API key or project.",
      };
    case status === 400:
      // Bad request or schema: retrying the same request won't help.
      return {
        ok: false,
        code: "provider_error",
        message: "Gemini rejected the request.",
        retryable: false,
      };
    default:
      return {
        ok: false,
        code: "provider_error",
        message: `Gemini is unavailable (HTTP ${status}).`,
        retryable: status >= 500,
      };
  }
}
