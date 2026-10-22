import type { AiErrorCode, AiPipeline } from "./types";

/**
 * One structured line per model attempt. Deliberately has no field for prompts, model output,
 * answers or keys: only ids, timings, token counts and the outcome code.
 */
export interface AiLogEntry {
  requestId: string;
  pipeline: AiPipeline;
  provider: string;
  model: string;
  attempt: number;
  outcome: "ok" | AiErrorCode | "repair";
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  retryAfterSeconds?: number;
}

export function logAiAttempt(entry: AiLogEntry): void {
  if (process.env.NODE_ENV === "test") return;
  console.info(JSON.stringify({ msg: "ai_attempt", ...entry }));
}
