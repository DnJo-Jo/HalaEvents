/**
 * Provider-independent AI contract (event.md §17.7). A provider turns chat messages into raw text;
 * it never parses or trusts that text. The gateway (./gateway.ts) owns JSON parsing and Zod
 * validation, so every provider gets the same guarantees. One request per call: no retries and no
 * repair turns (quota-friendly; the caller decides whether to try again).
 */

export type AiErrorCode =
  | "not_configured"
  /** Credentials rejected (401/403). */
  | "auth_failed"
  /** Provider quota or rate limit (429). */
  | "rate_limited"
  | "timeout"
  /** Model id unknown or not serving (404, model-specific 400s). */
  | "model_unavailable"
  /** Other provider failures (5xx, network, unreadable response). */
  | "provider_error"
  /** The prompt exceeded the configured input limit; nothing was sent. */
  | "input_too_large"
  /** The response wasn't JSON or failed the schema / business checks. */
  | "invalid_output";

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

export interface ProviderRequest {
  messages: ChatMessage[];
  /** JSON Schema for provider-side structured output, when the provider supports it. */
  jsonSchema?: Record<string, unknown>;
  maxOutputTokens: number;
  temperature: number;
  timeoutMs: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type ProviderResult =
  | { ok: true; text: string; usage?: Usage }
  | { ok: false; code: AiErrorCode; retryAfterSeconds?: number };

export interface AiProvider {
  /** Recorded in ai_runs.provider (CHECK-constrained). */
  readonly id: "cloudflare";
  readonly model: string;
  complete(req: ProviderRequest): Promise<ProviderResult>;
}
