import "server-only";
import { aiSetup, generateJson, type AiSetup, type GenerateResult } from "@/lib/ai/gateway";
import type { AiErrorCode } from "@/lib/ai/types";
import { inputHash } from "@/lib/input-hash";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";
import { allowRequest } from "@/lib/rate-limit";
import { interviewEditable } from "@/modules/events/interview-rules";
import * as eventsRepo from "@/modules/events/repo";
import { EVENT_TYPE_LABELS, EventType } from "@/modules/events/schemas";
import { getEventForMember, planningContext } from "@/modules/events/service";
import { requireMember } from "@/modules/profiles/service";
import { draftToPlan, fullDraftToPlan } from "./agent";
import { ENGINE_VERSION, buildPlan } from "./engine";
import {
  PLAN_FULL_PROMPT_VERSION,
  PLAN_PROMPT_VERSION,
  buildFullPlanPrompt,
  buildPlanPrompt,
} from "./plan-prompt";
import * as repo from "./repo";
import {
  evidenceCatalog,
  fullPlanErrors,
  missingInformation,
  planContext,
  resolvePlan,
  validatePlan,
  type PlanContext,
} from "./rules";
import {
  AiFullPlanDraft,
  AiPlanDraft,
  PlanOutput,
  type AiRunStatus,
  type PlanOverview,
} from "./schemas";

/**
 * Plan orchestration (event.md §6.2, §17). Two explicit modes, chosen by the organizer:
 * - "template": the deterministic playbook engine (engine.ts), offline;
 * - "custom": one request through the AI gateway, validated locally (Zod + validatePlan), with
 *   budget amounts and the schedule still computed by the engine (agent.ts).
 * A failed custom draft stores nothing and never turns into a template plan by itself. Every entry
 * point authorizes from the verified session (event owner/organizer, event still being planned)
 * first; the RPCs re-check. Results are proposals only: an organizer reviews and accepts them.
 */

export type PlanMode = "custom" | "template";

export interface PlanActionResult {
  outcome: "created" | "existing" | "stale" | "none";
  message: string;
}

/** Loads everything a planning action needs, after checking the caller may plan this event. */
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
    throw new AppError("forbidden", "Only the event's owner or organizers can plan this event.");
  }
  if (!interviewEditable(event.status)) {
    throw new AppError(
      "conflict",
      `This event is ${event.status}, so its plan can no longer be changed.`,
    );
  }
  const { playbook, state, ctx } = await planningContext(db, event);
  return { db, user, event, playbook, state, ctx };
}

const overviewOf = (p: PlanOutput): PlanOverview => ({
  summary: p.summary,
  goals: p.goals,
  requirements: p.requirements,
  missingInformation: p.missingInformation,
  decisions: p.decisions,
  followUpQuestions: p.followUpQuestions,
  budgetCategories: p.budgetCategories,
  budgetSummary: p.budgetSummary,
  risks: p.risks,
  conflicts: p.conflicts,
  schedule: p.schedule,
});

type PlanningInputs = Awaited<ReturnType<typeof planningContext>> & { event: eventsRepo.EventRow };

/**
 * Fingerprint of everything a plan is built from; a saved plan with another hash is out of date.
 * Custom drafts also depend on the prompt version and model, so either change makes a new draft.
 */
export function planInputHash(
  { playbook, event, state }: PlanningInputs,
  draft?: { model: string; promptVersion: string },
): string {
  return inputHash({
    pipeline: "plan",
    engine: ENGINE_VERSION,
    playbook: [playbook.id, playbook.version],
    event: {
      name: event.name,
      starts: event.starts_at,
      ends: event.ends_at,
      timezone: event.timezone,
      capacity: event.capacity,
      budget: event.budget_amount,
      currency: event.currency,
      city: event.city,
      venue: event.venue_type,
    },
    answers: state.answered.map((a) => [a.question.key, a.value]),
    // Custom drafts also read the organizer's free-text details; template plans don't.
    ...(draft
      ? { draft: [draft.promptVersion, draft.model], details: event.additional_details ?? null }
      : {}),
  });
}

/** The configured AI setup, or null when off or misconfigured (startup reports the details). */
function configuredAi(): AiSetup | null {
  try {
    return aiSetup();
  } catch {
    return null;
  }
}

/** Prompt version of the configured strategy: "full" (model writes everything) or "hybrid". */
const promptVersionFor = (setup: AiSetup) =>
  setup.planStrategy === "full" ? PLAN_FULL_PROMPT_VERSION : PLAN_PROMPT_VERSION;

/** Organizer-facing outcome of a failed custom draft. Never names the provider. */
const DRAFT_ERRORS: Record<AiErrorCode, [AppError["code"], string]> = {
  rate_limited: [
    "rate_limited",
    "Custom drafts have reached their usage limit for now. Try again later, or use a template draft.",
  ],
  timeout: [
    "ai_unavailable",
    "The custom draft took too long. Try again, or use a template draft.",
  ],
  invalid_output: [
    "ai_unavailable",
    "The custom draft didn't pass HalaEvents' checks, so nothing was saved. Try again, or use a template draft.",
  ],
  input_too_large: [
    "validation_failed",
    "This event has too much detail for a custom draft. Use a template draft instead.",
  ],
  not_configured: [
    "ai_unavailable",
    "Custom drafts aren't available right now. Use a template draft.",
  ],
  auth_failed: [
    "ai_unavailable",
    "Custom drafts aren't available right now. Use a template draft.",
  ],
  model_unavailable: [
    "ai_unavailable",
    "Custom drafts aren't available right now. Use a template draft.",
  ],
  provider_error: [
    "ai_unavailable",
    "Custom drafts aren't available right now. Use a template draft.",
  ],
};

const RUN_STATUS: Partial<Record<AiErrorCode, AiRunStatus>> = {
  rate_limited: "rate_limited",
  timeout: "timeout",
  model_unavailable: "model_unavailable",
  invalid_output: "invalid_output",
};

/** Custom drafts per user per minute, in front of the SQL cap (20 runs/user/hour). */
const DRAFT_BURST = { limit: 3, windowMs: 60_000 };

/**
 * Builds the plan once per set of inputs. An identical request keeps the saved plan; changed
 * answers need an explicit regenerate, which replaces all open proposals. A custom draft for
 * unchanged inputs, prompt version and model is always reused (no new request).
 */
export async function generatePlan(
  eventId: string,
  opts: { regenerate: boolean; mode?: PlanMode },
): Promise<PlanActionResult> {
  const mode = opts.mode ?? "template";
  const c = await managerContext(eventId);
  const setup = mode === "custom" ? configuredAi() : null;
  if (mode === "custom" && !setup) {
    const [code, message] = DRAFT_ERRORS.not_configured;
    throw new AppError(code, message);
  }
  // Missing answers never block planning: they become assumptions and follow-up questions.
  const evidence = evidenceCatalog(c.playbook, c.ctx, c.state);
  const pctx = planContext(c.event, evidence);
  const base = buildPlan({ playbook: c.playbook, event: c.event, ctx: c.ctx, plan: pctx });
  const hash = planInputHash(
    c,
    setup ? { model: setup.provider.model, promptVersion: promptVersionFor(setup) } : undefined,
  );

  const current = await repo.getCurrentPlan(c.db, eventId);
  if (current && current.plan.input_hash === hash && (!opts.regenerate || setup)) {
    return {
      outcome: "existing",
      message: "A plan for these answers already exists, so nothing new was created.",
    };
  }
  if (current && !opts.regenerate) {
    return {
      outcome: "stale",
      message:
        "Your answers changed since this plan was made. Use a “Regenerate” button to replace it.",
    };
  }

  const plan = setup ? await customDraft(c, setup, base, evidence, pctx, hash) : null;
  // The engine's own output must pass the same checks any plan would: a failure here is a
  // playbook mistake, caught by tests, never something to show half-built to an organizer.
  if (!plan) {
    const errors = validatePlan(base, pctx);
    if (errors.length > 0) {
      console.error(
        JSON.stringify({
          msg: "plan_invalid",
          playbook: c.playbook.id,
          errors: errors.slice(0, 5),
        }),
      );
      throw new AppError(
        "internal",
        "The plan couldn't be built for this event. Please try again, or contact support if it keeps happening.",
      );
    }
  }
  const saved = plan ?? { output: base, runId: null };
  await repo.savePlan(c.db, {
    eventId,
    runId: saved.runId,
    source: plan ? "ai" : "playbook",
    inputHash: hash,
    playbook: { id: c.playbook.id, version: c.playbook.version },
    assumptions: saved.output.assumptions,
    overview: overviewOf(saved.output),
    tasks: resolvePlan(saved.output.tasks, pctx),
  });
  return {
    outcome: "created",
    message: plan
      ? "Custom draft created. These are suggestions: review each task before accepting it."
      : "Plan created. These are suggestions: review each task before accepting it.",
  };
}

/**
 * One gateway request for a custom draft, recorded as an ai_runs row (provider, model, prompt
 * version, latency, tokens). Returns the validated plan, or throws an organizer-friendly error
 * after closing the run; nothing is saved on failure.
 */
async function customDraft(
  c: Awaited<ReturnType<typeof managerContext>>,
  setup: AiSetup,
  base: PlanOutput,
  evidence: Map<string, string>,
  pctx: PlanContext,
  hash: string,
): Promise<{ output: PlanOutput; runId: string }> {
  if (!allowRequest(`plan-draft:${c.user.id}`, DRAFT_BURST.limit, DRAFT_BURST.windowMs)) {
    throw new AppError(
      "rate_limited",
      "Please wait a minute before requesting another custom draft.",
    );
  }
  const full = setup.planStrategy === "full";
  const promptVersion = promptVersionFor(setup);
  const common = {
    eventTypeLabel: EVENT_TYPE_LABELS[EventType.parse(c.event.event_type)],
    event: c.event,
    startDate: pctx.startDate,
    endDate: pctx.endDate,
    leadDays: Math.max(
      0,
      Math.round((Date.parse(pctx.startDate) - Date.parse(pctx.today)) / 86_400_000),
    ),
    state: c.state,
    missing: missingInformation(c.playbook, c.ctx),
    details: c.event.additional_details,
  };
  // Full: only event facts and answers are sent. Hybrid: also the playbook's baseline rows.
  const prompt = full
    ? buildFullPlanPrompt(common)
    : buildPlanPrompt(
        { ...common, playbook: c.playbook, ctx: c.ctx, baselineTasks: base.tasks },
        setup.limits.maxInputChars,
      );
  // Single flight per event (unique running run) and the hourly cap are enforced here, in SQL.
  const runId = await repo.startRun(c.db, {
    eventId: c.event.id,
    pipeline: "plan",
    inputHash: hash,
    provider: setup.provider.id,
    model: setup.provider.model,
    promptVersion,
  });

  let result: GenerateResult<AiPlanDraft | AiFullPlanDraft>;
  try {
    result = full
      ? await generateJson(setup, { ...prompt, schema: AiFullPlanDraft })
      : await generateJson(setup, { ...prompt, schema: AiPlanDraft });
  } catch (e) {
    await repo.finishRun(c.db, runId, { status: "failed", errorCode: "unexpected", attempts: 1 });
    throw e;
  }

  let output: PlanOutput | null = null;
  let code: AiErrorCode | null = result.ok ? null : result.code;
  let validationErrors = result.ok ? 0 : (result.meta.validationErrors ?? 0);
  if (result.ok) {
    const candidate = full
      ? fullDraftToPlan(result.data as AiFullPlanDraft, evidence)
      : draftToPlan(result.data, base, evidence);
    const merged = PlanOutput.safeParse(candidate);
    const errors = merged.success
      ? [...validatePlan(merged.data, pctx), ...(full ? fullPlanErrors(merged.data, pctx) : [])]
      : ["shape"];
    if (merged.success && errors.length === 0) output = merged.data;
    else {
      code = "invalid_output";
      validationErrors = merged.success ? errors.length : merged.error.issues.length;
    }
  }
  const { meta } = result;
  await repo.finishRun(c.db, runId, {
    status: output ? "succeeded" : (RUN_STATUS[code!] ?? "failed"),
    errorCode: code,
    attempts: meta.requests,
    latencyMs: meta.latencyMs,
    inputTokens: meta.usage?.inputTokens ?? null,
    outputTokens: meta.usage?.outputTokens ?? null,
  });
  // Usage line: codes and counts only, never prompt or output text, never credentials.
  console.info(
    JSON.stringify({
      msg: "plan_draft",
      ok: Boolean(output),
      code,
      provider: meta.provider,
      model: meta.model,
      prompt: promptVersion,
      latencyMs: meta.latencyMs,
      inputChars: meta.inputChars,
      inputTokens: meta.usage?.inputTokens ?? null,
      outputTokens: meta.usage?.outputTokens ?? null,
      validationErrors,
    }),
  );
  if (!output) {
    const [errCode, message] = DRAFT_ERRORS[code!];
    throw new AppError(errCode, message);
  }
  return { output, runId };
}

export async function dismissSuggestion(eventId: string, suggestionId: string): Promise<void> {
  const c = await managerContext(eventId);
  const current = await repo.getCurrentPlan(c.db, eventId);
  const isTask = current?.tasks.some((t) => t.id === suggestionId);
  const followUps = await repo.listFollowUps(c.db, eventId);
  const isQuestion = followUps.some((f) => f.id === suggestionId && f.status === "proposed");
  if (!isTask && !isQuestion)
    throw new AppError("not_found", "That suggestion doesn't exist or was already handled.");
  await repo.dismissSuggestion(c.db, suggestionId);
}

/** Read model for the plan page (any event member). */
export async function getPlanView(eventId: string) {
  const { event, role, canManage } = await getEventForMember(eventId);
  const db = await createSupabaseServerClient();
  const [planning, current] = await Promise.all([
    planningContext(db, event),
    repo.getCurrentPlan(db, eventId),
  ]);
  const { playbook, state, ctx } = planning;
  const ai = configuredAi();
  // Custom drafts are fingerprinted with their run's model and today's prompt version; viewers
  // can't read runs, so for them a custom draft is never flagged.
  const run =
    current?.plan.source === "ai" && current.plan.ai_run_id
      ? await repo.getRunMeta(db, current.plan.ai_run_id)
      : null;
  const expected =
    current === null
      ? null
      : current.plan.source === "ai"
        ? run &&
          planInputHash(
            { ...planning, event },
            {
              model: run.model,
              promptVersion: ai ? promptVersionFor(ai) : (run.promptVersion ?? PLAN_PROMPT_VERSION),
            },
          )
        : planInputHash({ ...planning, event });
  return {
    event,
    role,
    canEdit: canManage && interviewEditable(event.status),
    // Whether custom drafts are configured (reads the environment; never calls the provider).
    customAvailable: ai !== null,
    /** "full": the model writes the whole custom draft; "hybrid": budget/schedule from the playbook. */
    customStrategy: ai?.planStrategy ?? null,
    missing: missingInformation(playbook, ctx),
    current,
    // The event details or answers changed after the saved plan was built.
    stale: current !== null && expected !== null && current.plan.input_hash !== expected,
    evidence: evidenceCatalog(playbook, ctx, state),
  };
}
