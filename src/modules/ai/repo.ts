import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import type { AiPipeline } from "@/lib/ai/types";
import type { Question } from "./playbook";
import { AiRunStatus, PlanSource, StoredFollowUp, StoredTask, SuggestionStatus } from "./schemas";

/** DB access for ai_runs, ai_plans and ai_suggestions. Writes go through the RPCs in migration 0006. */

export async function startRun(
  db: SupabaseServerClient,
  run: {
    eventId: string;
    pipeline: AiPipeline;
    provider: string;
    model: string;
    inputHash: string;
    isMock: boolean;
  },
): Promise<string> {
  const { data, error } = await db.rpc("start_ai_run", {
    p_event_id: run.eventId,
    p_pipeline: run.pipeline,
    p_provider: run.provider,
    p_model: run.model.slice(0, 80),
    p_input_hash: run.inputHash,
    p_is_mock: run.isMock,
  });
  if (error) throw fromDbError(error);
  return z.string().parse(data);
}

export async function finishRun(
  db: SupabaseServerClient,
  runId: string,
  r: {
    status: z.infer<typeof AiRunStatus>;
    errorCode: string | null;
    attempts: number;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    model: string;
  },
): Promise<void> {
  const { error } = await db.rpc("finish_ai_run", {
    p_run_id: runId,
    p_status: r.status,
    p_error_code: r.errorCode,
    p_attempts: r.attempts,
    p_latency_ms: Math.min(r.latencyMs, 600_000),
    p_input_tokens: r.inputTokens,
    p_output_tokens: r.outputTokens,
    p_model: r.model.slice(0, 80),
  });
  if (error) throw fromDbError(error);
}

/** A successful earlier run with exactly this input: its result is reused instead of a new call. */
export async function hasSucceededRun(
  db: SupabaseServerClient,
  eventId: string,
  pipeline: AiPipeline,
  inputHash: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("ai_runs")
    .select("id")
    .eq("event_id", eventId)
    .eq("pipeline", pipeline)
    .eq("input_hash", inputHash)
    .eq("status", "succeeded")
    .limit(1);
  if (error) throw fromDbError(error);
  return (data ?? []).length > 0;
}

const PlanRow = z.object({
  id: z.string(),
  source: PlanSource,
  input_hash: z.string(),
  assumptions: z.array(z.string()),
  is_mock: z.boolean(),
  created_at: z.string(),
  ai_run_id: z.string().nullable(),
});
export type PlanRow = z.infer<typeof PlanRow>;

const SuggestionRow = z.object({
  id: z.string(),
  item_key: z.string(),
  status: SuggestionStatus,
  source: PlanSource,
  revision: z.number(),
  is_mock: z.boolean(),
  payload: z.unknown(),
});

export interface PlanTask {
  id: string;
  revision: number;
  source: "ai" | "playbook";
  isMock: boolean;
  task: StoredTask;
}

export async function getCurrentPlan(
  db: SupabaseServerClient,
  eventId: string,
): Promise<{ plan: PlanRow; tasks: PlanTask[] } | null> {
  const { data, error } = await db
    .from("ai_plans")
    .select("id, source, input_hash, assumptions, is_mock, created_at, ai_run_id")
    .eq("event_id", eventId)
    .eq("status", "current")
    .maybeSingle();
  if (error) throw fromDbError(error);
  if (!data) return null;
  const plan = PlanRow.parse(data);
  const rows = await db
    .from("ai_suggestions")
    .select("id, item_key, status, source, revision, is_mock, payload")
    .eq("plan_id", plan.id)
    .eq("status", "proposed");
  if (rows.error) throw fromDbError(rows.error);
  const tasks = z
    .array(SuggestionRow)
    .parse(rows.data)
    .map((r) => ({
      id: r.id,
      revision: r.revision,
      source: r.source,
      isMock: r.is_mock,
      task: StoredTask.parse(r.payload),
    }))
    .sort(
      (a, b) =>
        a.task.dueDate.localeCompare(b.task.dueDate) || a.task.title.localeCompare(b.task.title),
    );
  return { plan, tasks };
}

export async function savePlan(
  db: SupabaseServerClient,
  p: {
    eventId: string;
    runId: string | null;
    source: "ai" | "playbook";
    inputHash: string;
    playbook: { id: string; version: number };
    assumptions: string[];
    tasks: StoredTask[];
  },
): Promise<string> {
  const { data, error } = await db.rpc("save_ai_plan", {
    p_event_id: p.eventId,
    p_run_id: p.runId,
    p_source: p.source,
    p_input_hash: p.inputHash,
    p_playbook_id: p.playbook.id,
    p_playbook_version: p.playbook.version,
    p_assumptions: p.assumptions,
    p_tasks: p.tasks.map((t) => ({ key: t.tempId, payload: t })),
  });
  if (error) throw fromDbError(error);
  return z.string().parse(data);
}

export interface FollowUp {
  id: string;
  status: z.infer<typeof SuggestionStatus>;
  isMock: boolean;
  question: Question;
}

/** Every AI follow-up of the event, any status (dismissed ones are needed to avoid re-asking). */
export async function listFollowUps(
  db: SupabaseServerClient,
  eventId: string,
): Promise<FollowUp[]> {
  const { data, error } = await db
    .from("ai_suggestions")
    .select("id, item_key, status, source, revision, is_mock, payload")
    .eq("event_id", eventId)
    .eq("kind", "question");
  if (error) throw fromDbError(error);
  return z
    .array(SuggestionRow)
    .parse(data)
    .map((r) => ({
      id: r.id,
      status: r.status,
      isMock: r.is_mock,
      question: StoredFollowUp.parse(r.payload),
    }));
}

export async function saveFollowUps(
  db: SupabaseServerClient,
  runId: string,
  eventId: string,
  questions: Question[],
): Promise<number> {
  const { data, error } = await db.rpc("save_ai_followups", {
    p_run_id: runId,
    p_event_id: eventId,
    p_questions: questions.map((q) => ({ key: q.key, payload: q })),
  });
  if (error) throw fromDbError(error);
  return z.number().parse(data);
}

export async function reviseTask(
  db: SupabaseServerClient,
  suggestionId: string,
  runId: string,
  task: StoredTask,
): Promise<void> {
  const { error } = await db.rpc("revise_ai_task", {
    p_suggestion_id: suggestionId,
    p_run_id: runId,
    p_payload: task,
  });
  if (error) throw fromDbError(error);
}

export async function dismissSuggestion(
  db: SupabaseServerClient,
  suggestionId: string,
): Promise<void> {
  const { error } = await db.rpc("dismiss_ai_suggestion", { p_suggestion_id: suggestionId });
  if (error) throw fromDbError(error);
}
