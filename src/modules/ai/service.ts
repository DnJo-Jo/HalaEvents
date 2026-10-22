import "server-only";
import { generate, type GenerateRequest, type GenerateResult } from "@/lib/ai/client";
import { inputHash } from "@/lib/ai/hash";
import type { AiErrorCode, AiPipeline, AiProvider } from "@/lib/ai/types";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getSessionUser } from "@/lib/auth/session";
import { AppError } from "@/lib/errors";
import { allowRequest } from "@/lib/rate-limit";
import {
  answerContext,
  eventContext,
  interviewEditable,
  interviewState,
  withFollowUps,
} from "@/modules/events/interview-rules";
import * as eventsRepo from "@/modules/events/repo";
import { getEventForMember } from "@/modules/events/service";
import { EventType } from "@/modules/events/schemas";
import { requireMember } from "@/modules/profiles/service";
import { playbookFor } from "@/playbooks";
import {
  INTERVIEW_SYSTEM,
  PLAN_SYSTEM,
  REVISE_SYSTEM,
  interviewPrompt,
  planPrompt,
  revisePrompt,
} from "./prompts";
import { getAiProvider } from "./provider";
import * as repo from "./repo";
import {
  MAX_FOLLOW_UPS,
  evidenceCatalog,
  filterFollowUps,
  missingInformation,
  planContext,
  playbookPlan,
  resolvePlan,
  validatePlan,
  validateRevision,
} from "./rules";
import { FollowUpOutput, PlanOutput, type PlanOverview, TaskRevisionOutput } from "./schemas";

/**
 * AI orchestration (event.md §6.2, §17). Every entry point authorizes from the verified session
 * (event owner/organizer, event still being planned) before any model call; the RPCs re-check.
 * Output is stored as proposals only.
 */

export interface AiActionResult {
  outcome: "created" | "existing" | "stale" | "fallback" | "failed" | "none";
  message: string;
}

/** Plain-language explanation of a failed model call. Never includes provider details. */
export function explainAiError(code: AiErrorCode, retryAfterSeconds?: number): string {
  switch (code) {
    case "rate_limited":
      return `The AI usage limit has been reached${retryAfterSeconds ? ` (try again in about ${retryAfterSeconds} s)` : ""}.`;
    case "timeout":
      return "The AI service didn't answer in time.";
    case "model_unavailable":
      return "The configured AI model isn't available (check GEMINI_MODEL).";
    case "invalid_output":
      return "The AI's answer didn't pass HalaEvents' checks, so it was discarded.";
    case "network":
      return "The AI service couldn't be reached.";
    case "not_configured":
      return "The AI service rejected the configuration (check the API key).";
    case "provider_error":
      return "The AI service returned an error.";
  }
}

const RUN_STATUS: Record<
  AiErrorCode,
  "invalid_output" | "failed" | "rate_limited" | "timeout" | "model_unavailable"
> = {
  rate_limited: "rate_limited",
  timeout: "timeout",
  invalid_output: "invalid_output",
  model_unavailable: "model_unavailable",
  provider_error: "failed",
  network: "failed",
  not_configured: "failed",
};

/** Loads everything an AI action needs, after checking the caller may plan this event. */
async function managerContext(eventId: string) {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const [event, role] = await Promise.all([
    eventsRepo.getEvent(db, eventId),
    eventsRepo.getRole(db, eventId, user.id),
  ]);
  if (!event || !role)
    throw new AppError("not_found", "That event doesn't exist or isn't visible to you.");
  if (role !== "owner" && role !== "organizer") {
    throw new AppError("forbidden", "Only the event's owner or organizers can use AI planning.");
  }
  if (!interviewEditable(event.status)) {
    throw new AppError(
      "conflict",
      `This event is ${event.status}, so its plan can no longer be changed.`,
    );
  }
  const playbook = playbookFor(EventType.parse(event.event_type));
  const [stored, followUps] = await Promise.all([
    eventsRepo.listInterviewAnswers(db, eventId),
    repo.listFollowUps(db, eventId),
  ]);
  const live = followUps
    .filter((f) => f.status === "proposed" || f.status === "accepted")
    .map((f) => f.question);
  const ectx = eventContext(event);
  const state = interviewState(withFollowUps(playbook, live), ectx, stored);
  return { db, event, playbook, ectx, state, followUps, actx: answerContext(ectx, state) };
}

const AI_BURST_LIMIT = 6;
const AI_BURST_WINDOW_MS = 60_000;

/** Starts a run (single flight + hourly cap in SQL), calls the model, records the outcome. Shared with comms. */
export async function runPipeline<T>(
  db: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  provider: AiProvider,
  eventId: string,
  hash: string,
  req: GenerateRequest<T> & { pipeline: AiPipeline },
): Promise<{ runId: string; result: GenerateResult<T> }> {
  // Cheap per-instance burst guard in front of the authoritative hourly cap in SQL (event.md §5.6).
  const user = await getSessionUser();
  if (user && !allowRequest(`ai:${user.id}`, AI_BURST_LIMIT, AI_BURST_WINDOW_MS))
    throw new AppError(
      "rate_limited",
      "That's a lot of AI requests at once. Wait a minute and try again.",
    );
  let runId: string;
  try {
    runId = await repo.startRun(db, {
      eventId,
      pipeline: req.pipeline,
      provider: provider.name,
      model: provider.model,
      inputHash: hash,
      isMock: provider.isMock,
    });
  } catch (e) {
    if (e instanceof AppError && e.code === "conflict") {
      throw new AppError(
        "conflict",
        "This is already being generated. Wait a moment and reload the page.",
      );
    }
    if (e instanceof AppError && e.code === "rate_limited") {
      throw new AppError(
        "rate_limited",
        "You've reached the hourly limit of 20 AI requests. Try again later.",
      );
    }
    throw e;
  }
  let result: GenerateResult<T>;
  try {
    result = await generate(provider, req);
  } catch {
    result = {
      ok: false,
      error: { code: "provider_error", message: "Unexpected failure." },
      requestId: "unknown",
      model: provider.model,
      attempts: 0,
      latencyMs: 0,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }
  await repo.finishRun(db, runId, {
    status: result.ok ? "succeeded" : RUN_STATUS[result.error.code],
    errorCode: result.ok ? null : result.error.code,
    attempts: result.attempts,
    latencyMs: result.latencyMs,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    model: result.model,
  });
  return { runId, result };
}

// ------------------------------------------------------------------------------------------------
// Plan
// ------------------------------------------------------------------------------------------------

/**
 * Generates the plan once per set of inputs. An identical request reuses the saved plan; changed
 * answers need an explicit regenerate. If the model fails and there is no plan yet, the
 * deterministic playbook plan is saved instead, clearly labelled as not AI-generated.
 */
function overviewOf(p: PlanOutput): PlanOverview {
  return {
    summary: p.summary,
    requirements: p.requirements,
    missingInformation: p.missingInformation,
    budgetCategories: p.budgetCategories,
    risks: p.risks,
  };
}

export async function generatePlan(
  eventId: string,
  opts: { regenerate: boolean },
): Promise<AiActionResult> {
  const c = await managerContext(eventId);
  const missing = missingInformation(c.playbook, c.actx);
  if (missing.length) {
    throw new AppError(
      "validation_failed",
      `The plan needs more information first: ${missing.map((m) => m.label).join("; ")}.`,
    );
  }
  const provider = getAiProvider();
  const evidence = evidenceCatalog(c.playbook, c.actx, c.state);
  const pctx = planContext(c.event, evidence);
  const { prompt, data } = planPrompt(c.event, c.playbook, c.actx, c.state, pctx, missing);
  const hash = inputHash({
    pipeline: "plan",
    provider: provider.name,
    model: provider.model,
    playbook: [c.playbook.id, c.playbook.version],
    data,
  });

  const current = await repo.getCurrentPlan(c.db, eventId);
  if (
    current &&
    current.plan.input_hash === hash &&
    (current.plan.source === "ai" || !opts.regenerate)
  ) {
    return {
      outcome: "existing",
      message: "A plan for these answers already exists, so nothing new was generated.",
    };
  }
  if (current && !opts.regenerate) {
    return {
      outcome: "stale",
      message:
        "Your answers changed since this plan was made. Use “Regenerate plan” to replace it.",
    };
  }

  const deterministic = playbookPlan(c.playbook, c.actx, evidence);
  const { runId, result } = await runPipeline(c.db, provider, eventId, hash, {
    pipeline: "plan",
    system: PLAN_SYSTEM,
    prompt,
    schema: PlanOutput,
    validate: (plan) => validatePlan(plan, pctx),
    context: { deterministicPlan: deterministic },
    temperature: 0.3,
  });
  const playbookRef = { id: c.playbook.id, version: c.playbook.version };

  if (result.ok) {
    await repo.savePlan(c.db, {
      eventId,
      runId,
      source: "ai",
      inputHash: hash,
      playbook: playbookRef,
      assumptions: result.data.assumptions,
      overview: overviewOf(result.data),
      tasks: resolvePlan(result.data.tasks, pctx),
    });
    return {
      outcome: "created",
      message: provider.isMock
        ? "Plan created by the mock AI provider (offline demo data). Review each task before using it."
        : "Plan created. These are suggestions: review each task before using it.",
    };
  }

  const why = explainAiError(result.error.code, result.error.retryAfterSeconds);
  if (current) return { outcome: "failed", message: `${why} Your existing plan is unchanged.` };
  await repo.savePlan(c.db, {
    eventId,
    runId: null,
    source: "playbook",
    inputHash: hash,
    playbook: playbookRef,
    assumptions: deterministic.assumptions,
    overview: overviewOf(deterministic),
    tasks: resolvePlan(deterministic.tasks, pctx),
  });
  return {
    outcome: "fallback",
    message: `${why} A plan was built from the HalaEvents playbook instead, without AI. You can try “Regenerate plan” later.`,
  };
}

/** Rewrites one task of the current plan from the organizer's note; the rest of the plan is untouched. */
export async function reviseTask(
  eventId: string,
  suggestionId: string,
  note: string,
): Promise<AiActionResult> {
  const c = await managerContext(eventId);
  const current = await repo.getCurrentPlan(c.db, eventId);
  const target = current?.tasks.find((t) => t.id === suggestionId);
  if (!current || !target) throw new AppError("not_found", "That task isn't in the current plan.");
  const others = current.tasks.filter((t) => t.id !== suggestionId).map((t) => t.task);
  const provider = getAiProvider();
  const pctx = planContext(c.event, evidenceCatalog(c.playbook, c.actx, c.state));
  const { prompt, data } = revisePrompt(c.event, target.task, others, note, pctx);
  const hash = inputHash({
    pipeline: "revise_task",
    provider: provider.name,
    model: provider.model,
    data,
  });

  const { runId, result } = await runPipeline(c.db, provider, eventId, hash, {
    pipeline: "revise_task",
    system: REVISE_SYSTEM,
    prompt,
    schema: TaskRevisionOutput,
    validate: (r) => validateRevision(r.task, target.task, others, pctx),
    context: { task: target.task, note },
  });
  if (!result.ok) {
    return {
      outcome: "failed",
      message: `${explainAiError(result.error.code, result.error.retryAfterSeconds)} The task is unchanged.`,
    };
  }
  const [resolved] = resolvePlan([result.data.task], pctx);
  await repo.reviseTask(c.db, suggestionId, runId, {
    ...resolved,
    changeSummary: result.data.changeSummary,
  });
  return { outcome: "created", message: `Task revised: ${result.data.changeSummary}` };
}

export async function dismissSuggestion(eventId: string, suggestionId: string): Promise<void> {
  const c = await managerContext(eventId);
  const current = await repo.getCurrentPlan(c.db, eventId);
  const isTask = current?.tasks.some((t) => t.id === suggestionId);
  const isQuestion = c.followUps.some((f) => f.id === suggestionId && f.status === "proposed");
  if (!isTask && !isQuestion)
    throw new AppError("not_found", "That suggestion doesn't exist or was already handled.");
  await repo.dismissSuggestion(c.db, suggestionId);
}

/** Read model for the plan page (any event member). */
export async function getPlanView(eventId: string) {
  const { event, role, canManage } = await getEventForMember(eventId);
  const db = await createSupabaseServerClient();
  const playbook = playbookFor(EventType.parse(event.event_type));
  const [stored, followUps, current] = await Promise.all([
    eventsRepo.listInterviewAnswers(db, eventId),
    repo.listFollowUps(db, eventId),
    repo.getCurrentPlan(db, eventId),
  ]);
  const live = followUps
    .filter((f) => f.status === "proposed" || f.status === "accepted")
    .map((f) => f.question);
  const ectx = eventContext(event);
  const state = interviewState(withFollowUps(playbook, live), ectx, stored);
  const actx = answerContext(ectx, state);
  const evidence = evidenceCatalog(playbook, actx, state);
  const provider = getAiProvider();
  return {
    event,
    role,
    canEdit: canManage && interviewEditable(event.status),
    missing: missingInformation(playbook, actx),
    current,
    evidence,
    provider: { name: provider.name, isMock: provider.isMock },
  };
}

// ------------------------------------------------------------------------------------------------
// Interview follow-ups
// ------------------------------------------------------------------------------------------------

/**
 * Asks the model for up to 3 follow-up questions once the playbook questions are answered.
 * Identical inputs are not sent again; dismissed and answered questions are never re-asked.
 */
export async function suggestFollowUps(eventId: string): Promise<AiActionResult> {
  const c = await managerContext(eventId);
  if (c.state.next.some((q) => !q.key.startsWith("custom."))) {
    throw new AppError(
      "conflict",
      "Answer the open playbook questions first; follow-ups come after them.",
    );
  }
  const liveCount = c.followUps.filter(
    (f) => f.status === "proposed" || f.status === "accepted",
  ).length;
  if (liveCount >= MAX_FOLLOW_UPS) {
    return {
      outcome: "none",
      message: `This event already has ${MAX_FOLLOW_UPS} follow-up questions.`,
    };
  }
  const provider = getAiProvider();
  const asked = [...c.playbook.questions, ...c.followUps.map((f) => f.question)];
  const { prompt, data } = interviewPrompt(c.event, c.state, asked);
  const hash = inputHash({
    pipeline: "interview",
    provider: provider.name,
    model: provider.model,
    data,
  });
  if (await repo.hasSucceededRun(c.db, eventId, "interview", hash)) {
    return {
      outcome: "existing",
      message: "Nothing changed since the last suggestions, so no new request was made.",
    };
  }

  const { runId, result } = await runPipeline(c.db, provider, eventId, hash, {
    pipeline: "interview",
    system: INTERVIEW_SYSTEM,
    prompt,
    schema: FollowUpOutput,
    context: { existingKeys: asked.map((q) => q.key) },
    temperature: 0.4,
  });
  if (!result.ok) {
    return {
      outcome: "failed",
      message: `${explainAiError(result.error.code, result.error.retryAfterSeconds)} You can continue with the playbook questions; the plan doesn't need follow-ups.`,
    };
  }
  const questions = filterFollowUps(result.data, {
    keys: new Set(asked.map((q) => q.key)),
    texts: asked.map((q) => q.text),
    liveCount,
  });
  if (questions.length === 0) {
    return {
      outcome: "none",
      message: "The assistant has no further questions: there's enough information to plan.",
    };
  }
  const saved = await repo.saveFollowUps(c.db, runId, eventId, questions);
  return {
    outcome: "created",
    message: `${saved} follow-up question${saved === 1 ? "" : "s"} added${provider.isMock ? " (mock AI)" : ""}. They're optional.`,
  };
}
