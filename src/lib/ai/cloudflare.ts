import "server-only";
import type { AiErrorCode, AiProvider, ProviderRequest, ProviderResult } from "./types";

/**
 * Cloudflare Workers AI over its REST API (no SDK): POST /accounts/{id}/ai/run/{model} with chat
 * `messages`, `max_tokens` and JSON mode (`response_format: { type: "json_schema" }`). Exactly one
 * request per call. The token is sent only in the Authorization header and never logged; provider
 * error text is reduced to an error code and never shown to users.
 */

const API_BASE = "https://api.cloudflare.com/client/v4";
const MAX_RESPONSE_BYTES = 256 * 1024;

export interface CloudflareConfig {
  accountId: string;
  apiToken: string;
  model: string;
}

const CfResponse = (v: unknown) =>
  v as {
    success?: boolean;
    result?: { response?: unknown; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    errors?: { code?: number; message?: string }[];
  };

/** Classifies a failed response from its status and Cloudflare's error list. */
function failure(status: number, body: ReturnType<typeof CfResponse> | null): AiErrorCode {
  const errors = body?.errors ?? [];
  const text = errors
    .map((e) => e.message ?? "")
    .join(" ")
    .toLowerCase();
  // Daily free allocation used up / account limits (Cloudflare error 4006 "neurons").
  if (status === 429 || errors.some((e) => e.code === 4006) || /neuron|allocation/.test(text))
    return "rate_limited";
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 404) return "model_unavailable";
  if (status === 408 || status === 504) return "timeout";
  if (status === 400 && /json mode|json schema/.test(text)) return "invalid_output";
  if (status === 400 && /model/.test(text)) return "model_unavailable";
  return "provider_error";
}

export function createCloudflareProvider(
  config: CloudflareConfig,
  fetchImpl: typeof fetch = fetch,
): AiProvider {
  const url = `${API_BASE}/accounts/${config.accountId}/ai/run/${config.model}`;
  return {
    id: "cloudflare",
    model: config.model,
    async complete(req: ProviderRequest): Promise<ProviderResult> {
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.apiToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messages: req.messages,
            max_tokens: req.maxOutputTokens,
            temperature: req.temperature,
            ...(req.jsonSchema
              ? { response_format: { type: "json_schema", json_schema: req.jsonSchema } }
              : {}),
          }),
          signal: AbortSignal.timeout(req.timeoutMs),
          redirect: "error",
        });
      } catch (e) {
        // By name, not instanceof: DOMException isn't an Error subclass in every runtime.
        const name = (e as { name?: unknown } | null)?.name;
        const timedOut = name === "TimeoutError" || name === "AbortError";
        return { ok: false, code: timedOut ? "timeout" : "provider_error" };
      }

      let body: ReturnType<typeof CfResponse> | null = null;
      try {
        const text = await res.text();
        if (text.length > MAX_RESPONSE_BYTES) return { ok: false, code: "provider_error" };
        body = CfResponse(JSON.parse(text));
      } catch {
        body = null;
      }

      if (!res.ok || !body || body.success === false) {
        const retryAfter = Number(res.headers.get("retry-after"));
        return {
          ok: false,
          code: res.ok && !body ? "provider_error" : failure(res.status, body),
          ...(Number.isFinite(retryAfter) && retryAfter > 0
            ? { retryAfterSeconds: retryAfter }
            : {}),
        };
      }

      // JSON mode may return the parsed object; plain mode returns a string.
      const out = body.result?.response;
      const text =
        typeof out === "string" ? out : out && typeof out === "object" ? JSON.stringify(out) : null;
      if (text === null) return { ok: false, code: "provider_error" };
      const usage = body.result?.usage;
      return {
        ok: true,
        text,
        ...(usage
          ? {
              usage: {
                inputTokens: Math.max(0, Math.round(usage.prompt_tokens ?? 0)),
                outputTokens: Math.max(0, Math.round(usage.completion_tokens ?? 0)),
              },
            }
          : {}),
      };
    },
  };
}
