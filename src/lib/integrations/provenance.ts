import { z } from "zod";

/**
 * Provenance carried by every external-data result (event.md §25): where it came from, when it was
 * retrieved and which provider identifiers it references. `isMock` results come from deterministic
 * fixtures and must be shown as mock; they never stand in for a live provider response.
 */
export const ProvenanceSchema = z.object({
  provider: z.string().min(1).max(40),
  isMock: z.boolean(),
  retrievedAt: z.iso.datetime(),
  /** Public URL a person can open to check the data, when the provider has one. */
  sourceUrl: z.url().max(500).optional(),
  /** Provider-side identifiers (place id, model/grid id, document id). */
  providerIds: z.record(z.string().max(40), z.string().max(200)).default({}),
});
export type Provenance = z.infer<typeof ProvenanceSchema>;

/** Failure of an integration call. `message` is safe to show: no URLs with keys, no raw bodies. */
export type IntegrationError = {
  code:
    "not_configured" | "timeout" | "unreachable" | "rejected" | "invalid_response" | "rate_limited";
  message: string;
};

export type IntegrationResult<T> =
  | { ok: true; data: T; provenance: Provenance }
  | { ok: false; error: IntegrationError; provenance: Provenance };

export const DEFAULT_TIMEOUT_MS = 8_000;
/** External bodies are read through this cap before JSON parsing (bounded resource use). */
export const MAX_RESPONSE_BYTES = 256 * 1024;

/** fetch with a timeout and a response-size cap. Never throws; errors become IntegrationError. */
export async function boundedJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ ok: true; json: unknown } | { ok: false; error: IntegrationError }> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error",
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return {
      ok: false,
      error: timedOut
        ? { code: "timeout", message: "The provider did not answer in time." }
        : { code: "unreachable", message: "Couldn't reach the provider." },
    };
  }
  if (res.status === 429)
    return {
      ok: false,
      error: { code: "rate_limited", message: "The provider is rate limiting requests." },
    };
  if (!res.ok)
    return {
      ok: false,
      error: {
        code: "rejected",
        message: `The provider refused the request (HTTP ${res.status}).`,
      },
    };
  try {
    const text = await res.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new Error("too large");
    return { ok: true, json: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      error: { code: "invalid_response", message: "The provider's answer was not usable." },
    };
  }
}
