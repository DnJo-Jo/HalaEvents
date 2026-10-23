import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import type { Question } from "./playbook";
import { PlanOverview, PlanSource, StoredFollowUp, StoredTask, SuggestionStatus } from "./schemas";

/**
 * DB access for ai_runs, ai_plans and ai_suggestions. The table names predate the move to the
 * deterministic planning engine and are kept so saved plans stay readable. Writes go through the
 * RPCs in migrations 0006/0010.
 */

/** Pipelines that record a run row (the venue-recovery proposal needs one to be saved). */
export type RunPipeline = "plan" | "recovery";

export async function startRun(
  db: SupabaseServerClient,
  run: {
    eventId: string;
    pipeline: RunPipeline;
    inputHash: string;
  },
): Promise<string> {
  const { data, error } = await db.rpc("start_ai_run", {
    p_event_id: run.eventId,
    p_pipeline: run.pipeline,
    p_provider: "playbook",
    p_model: "rules",
    p_input_hash: run.inputHash,
    p_is_mock: false,
  });
  if (error) throw fromDbError(error);
  return z.string().parse(data);
}

/** Marks a rules run as done. Rules runs don't fail halfway: nothing external is called. */
export async function finishRun(db: SupabaseServerClient, runId: string): Promise<void> {
  const { error } = await db.rpc("finish_ai_run", {
    p_run_id: runId,
    p_status: "succeeded",
    p_error_code: null,
    p_attempts: 1,
    p_latency_ms: 0,
    p_input_tokens: 0,
    p_output_tokens: 0,
    p_model: "rules",
  });
  if (error) throw fromDbError(error);
}

const PlanRow = z.object({
  id: z.string(),
  source: PlanSource,
  input_hash: z.string(),
  assumptions: z.array(z.string()),
  overview: PlanOverview.nullish().transform((v) => v ?? null),
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
    .select("id, source, input_hash, assumptions, overview, is_mock, created_at, ai_run_id")
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
    overview: PlanOverview;
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
  const planId = z.string().parse(data);
  const saved = await db.rpc("set_ai_plan_overview", { p_plan_id: planId, p_overview: p.overview });
  if (saved.error) throw fromDbError(saved.error);
  return planId;
}

export interface FollowUp {
  id: string;
  status: z.infer<typeof SuggestionStatus>;
  isMock: boolean;
  question: Question;
}

/** Follow-up questions saved on the event earlier, any status. Kept so their answers stay visible. */
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

export async function dismissSuggestion(
  db: SupabaseServerClient,
  suggestionId: string,
): Promise<void> {
  const { error } = await db.rpc("dismiss_ai_suggestion", { p_suggestion_id: suggestionId });
  if (error) throw fromDbError(error);
}
