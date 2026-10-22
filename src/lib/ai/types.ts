/**
 * AI provider adapter (event.md §6.1, §17). A provider turns a prompt into raw JSON text; it never
 * parses or trusts that text. `generate()` in ./client.ts owns timeouts, retries, Zod validation
 * and logging, so every provider gets the same guarantees.
 */

export type AiPipeline = "interview" | "plan" | "revise_task" | "draft_message" | "recovery";

export type AiErrorCode =
  | "timeout"
  | "rate_limited"
  | "invalid_output"
  | "model_unavailable"
  | "provider_error"
  | "network"
  | "not_configured";

export interface ProviderRequest {
  pipeline: AiPipeline;
  system: string;
  /** User turns; a repair retry appends the validation errors as another turn. */
  messages: { role: "user" | "model"; content: string }[];
  /** JSON Schema for provider-side structured output (from z.toJSONSchema). */
  jsonSchema: Record<string, unknown>;
  temperature: number;
  maxOutputTokens: number;
  signal: AbortSignal;
  /** Structured, already-validated input. Only the mock provider reads it. */
  context: unknown;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export type ProviderResult =
  | { ok: true; text: string; model: string; usage?: Usage }
  | {
      ok: false;
      code: AiErrorCode;
      message: string;
      /** Transient (timeout, network, 5xx): the client may try once more. Quota errors are not retried. */
      retryable?: boolean;
      retryAfterSeconds?: number;
      usage?: Usage;
    };

export interface AiProvider {
  readonly name: "gemini" | "mock";
  readonly model: string;
  readonly isMock: boolean;
  generate(req: ProviderRequest): Promise<ProviderResult>;
}
