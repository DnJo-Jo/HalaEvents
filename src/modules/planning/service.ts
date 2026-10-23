import "server-only";
import { inputHash } from "@/lib/input-hash";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";
import { interviewEditable } from "@/modules/events/interview-rules";
import * as eventsRepo from "@/modules/events/repo";
import { getEventForMember, planningContext } from "@/modules/events/service";
import { requireMember } from "@/modules/profiles/service";
import { ENGINE_VERSION, buildPlan } from "./engine";
import * as repo from "./repo";
import {
  evidenceCatalog,
  missingInformation,
  planContext,
  resolvePlan,
  validatePlan,
} from "./rules";
import type { PlanOutput, PlanOverview } from "./schemas";

/**
 * Plan orchestration (event.md §6.2, §17). The plan is built by the deterministic playbook engine
 * (engine.ts); no external service is involved. Every entry point authorizes from the verified
 * session (event owner/organizer, event still being planned) first; the RPCs re-check. The result
 * is stored as proposals only: an organizer reviews and accepts it.
 */

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
  return { db, event, playbook, state, ctx };
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
  schedule: p.schedule,
});

/**
 * Builds the plan once per set of inputs. An identical request keeps the saved plan; changed
 * answers need an explicit regenerate, which replaces all open proposals.
 */
export async function generatePlan(
  eventId: string,
  opts: { regenerate: boolean },
): Promise<PlanActionResult> {
  const c = await managerContext(eventId);
  // Missing answers never block planning: they become assumptions and follow-up questions.
  const evidence = evidenceCatalog(c.playbook, c.ctx, c.state);
  const pctx = planContext(c.event, evidence);
  const plan = buildPlan({ playbook: c.playbook, event: c.event, ctx: c.ctx, plan: pctx });
  const hash = inputHash({
    pipeline: "plan",
    engine: ENGINE_VERSION,
    playbook: [c.playbook.id, c.playbook.version],
    event: {
      name: c.event.name,
      starts: c.event.starts_at,
      ends: c.event.ends_at,
      timezone: c.event.timezone,
      capacity: c.event.capacity,
      budget: c.event.budget_amount,
      currency: c.event.currency,
      city: c.event.city,
      venue: c.event.venue_type,
    },
    answers: c.state.answered.map((a) => [a.question.key, a.value]),
  });

  const current = await repo.getCurrentPlan(c.db, eventId);
  if (current && !opts.regenerate) {
    return current.plan.input_hash === hash
      ? {
          outcome: "existing",
          message: "A plan for these answers already exists, so nothing new was created.",
        }
      : {
          outcome: "stale",
          message:
            "Your answers changed since this plan was made. Use “Regenerate plan” to replace it.",
        };
  }

  // The engine's own output must pass the same checks any plan would: a failure here is a
  // playbook mistake, caught by tests, never something to show half-built to an organizer.
  const errors = validatePlan(plan, pctx);
  if (errors.length > 0) {
    console.error(
      JSON.stringify({ msg: "plan_invalid", playbook: c.playbook.id, errors: errors.slice(0, 5) }),
    );
    throw new AppError(
      "internal",
      "The plan couldn't be built for this event. Please try again, or contact support if it keeps happening.",
    );
  }
  await repo.savePlan(c.db, {
    eventId,
    runId: null,
    source: "playbook",
    inputHash: hash,
    playbook: { id: c.playbook.id, version: c.playbook.version },
    assumptions: plan.assumptions,
    overview: overviewOf(plan),
    tasks: resolvePlan(plan.tasks, pctx),
  });
  return {
    outcome: "created",
    message: "Plan created. These are suggestions: review each task before accepting it.",
  };
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
  const [{ playbook, state, ctx }, current] = await Promise.all([
    planningContext(db, event),
    repo.getCurrentPlan(db, eventId),
  ]);
  return {
    event,
    role,
    canEdit: canManage && interviewEditable(event.status),
    missing: missingInformation(playbook, ctx),
    current,
    evidence: evidenceCatalog(playbook, ctx, state),
  };
}
