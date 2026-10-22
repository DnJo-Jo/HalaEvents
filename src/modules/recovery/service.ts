import "server-only";
import { inputHash } from "@/lib/ai/hash";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";
import { getAiProvider } from "@/modules/ai/provider";
import { explainAiError, runPipeline, type AiActionResult } from "@/modules/ai/service";
import * as commsRepo from "@/modules/comms/repo";
import * as eventsRepo from "@/modules/events/repo";
import { EventType } from "@/modules/events/schemas";
import { getEventForMember } from "@/modules/events/service";
import { requireMember } from "@/modules/profiles/service";
import { playbookFor } from "@/playbooks";
import { RECOVERY_SYSTEM, recoveryPrompt } from "./prompts";
import * as repo from "./repo";
import {
  budgetView,
  buildChanges,
  buildInquiries,
  dateInZone,
  planningWindow,
  validateProposal,
} from "./rules";
import { RecoveryProposal } from "./schemas";

/**
 * Venue-cancellation recovery (event.md §23). Everything here is a simulation. Authorization comes
 * from the verified session (event owner/organizer); the RPCs repeat it. The model's proposal is
 * validated (Zod + rules) before it is stored, and storing it changes nothing.
 */

async function managerContext(eventId: string) {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const [event, role] = await Promise.all([
    eventsRepo.getEvent(db, eventId),
    eventsRepo.getRole(db, eventId, user.id),
  ]);
  if (!event || !role)
    throw new AppError("not_found", "That event doesn't exist or isn't visible to you.");
  if (role !== "owner" && role !== "organizer")
    throw new AppError(
      "forbidden",
      "Only the event's owner or organizers can run or approve a recovery.",
    );
  return { db, event, user };
}

async function incidentInEvent(
  db: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  eventId: string,
  incidentId: string,
) {
  const incident = await repo.getIncident(db, incidentId);
  if (!incident || incident.event_id !== eventId)
    throw new AppError("not_found", "That incident isn't part of this event.");
  return incident;
}

/**
 * Idempotency key of a simulation request: the booking plus how many recoveries it already had.
 * A double click or a retry computes the same key and gets the same incident; the database also
 * allows only one active recovery per booking, whatever key arrives.
 */
export function simulationKey(bookingId: string, previousCount: number) {
  return `sim:${bookingId}:${previousCount}`;
}

// ------------------------------------------------------------------------------------------------
// Read models
// ------------------------------------------------------------------------------------------------

export async function getIncidentsView(eventId: string) {
  const { event, canManage } = await getEventForMember(eventId);
  if (!canManage) {
    return { event, canManage, incidents: [], bookings: [] };
  }
  const db = await createSupabaseServerClient();
  const [incidents, bookings] = await Promise.all([
    repo.listIncidents(db, eventId),
    repo.listSimulatable(db, eventId),
  ]);
  return { event, canManage, incidents, bookings };
}

export async function getIncidentView(eventId: string, incidentId: string) {
  const { event, canManage } = await getEventForMember(eventId);
  if (!canManage)
    throw new AppError("forbidden", "Only the event's owner or organizers can see recovery plans.");
  const db = await createSupabaseServerClient();
  const incident = await incidentInEvent(db, eventId, incidentId);
  const [plans, flags, approvals, communications] = await Promise.all([
    repo.listPlans(db, incidentId),
    repo.listFlags(db, incidentId),
    commsRepo.listApprovals(db, eventId),
    commsRepo.listCommunications(db, eventId),
  ]);
  const current = plans.find((p) => p.status === "proposed") ?? plans[0] ?? null;
  const [changes, inquiries] = current
    ? await Promise.all([repo.listChanges(db, current.id), repo.listInquiries(db, current.id)])
    : [[], []];
  const planIds = new Set(plans.map((p) => p.id));
  const messages = communications.filter(
    (c) => c.recovery_plan_id && planIds.has(c.recovery_plan_id),
  );
  const provider = getAiProvider();
  return {
    event,
    incident,
    plans,
    current,
    changes,
    inquiries,
    flags,
    approvals,
    messages,
    budget: budgetView(incident.impact),
    provider: { name: provider.name, isMock: provider.isMock },
  };
}

// ------------------------------------------------------------------------------------------------
// Commands
// ------------------------------------------------------------------------------------------------

export async function simulate(eventId: string, input: { bookingId: string; note: string | null }) {
  const { db } = await managerContext(eventId);
  const previous = (await repo.listIncidents(db, eventId)).filter(
    (i) => i.booking_id === input.bookingId,
  ).length;
  const r = await repo.simulate(db, {
    eventId,
    bookingId: input.bookingId,
    key: simulationKey(input.bookingId, previous),
    note: input.note,
  });
  return {
    incidentId: r.id,
    created: r.created,
    message: r.created
      ? "Simulated venue cancellation recorded. The booking itself was not changed."
      : "This cancellation was already simulated, so nothing new was created.",
  };
}

/** Asks the model for a recovery proposal, validates it, and stores it (changing nothing else). */
export async function generateRecovery(
  eventId: string,
  incidentId: string,
): Promise<AiActionResult> {
  const { db, event } = await managerContext(eventId);
  const incident = await incidentInEvent(db, eventId, incidentId);
  if (incident.status !== "assessing" && incident.status !== "replan_proposed")
    throw new AppError("invalid_transition", `This incident is ${incident.status}.`);
  const impact = incident.impact;
  const today = dateInZone(Date.now(), impact.event.timezone);
  if (planningWindow(impact, today).last < today)
    throw new AppError(
      "conflict",
      "The event has already started, so there is nothing to re-plan.",
    );

  const provider = getAiProvider();
  const guidance = playbookFor(EventType.parse(event.event_type)).recovery?.venueCancellation;
  const { prompt, data } = recoveryPrompt(impact, today, guidance);
  const { runId, result } = await runPipeline(
    db,
    provider,
    eventId,
    inputHash({
      pipeline: "recovery",
      provider: provider.name,
      model: provider.model,
      incident: incidentId,
      data,
      at: Date.now(),
    }),
    {
      pipeline: "recovery",
      system: RECOVERY_SYSTEM,
      prompt,
      schema: RecoveryProposal,
      validate: (p) => validateProposal(p, impact, today),
      context: { impact, today, guidance },
      temperature: 0.3,
    },
  );
  if (!result.ok) {
    return {
      outcome: "failed",
      message: `${explainAiError(result.error.code, result.error.retryAfterSeconds)} Nothing was changed. The affected items below were found by rules, not AI, so you can still act on them.`,
    };
  }
  await repo.savePlan(db, {
    incidentId,
    runId,
    proposal: result.data,
    changes: buildChanges(result.data, impact),
    inquiries: buildInquiries(result.data, impact, guidance),
    attendeeDraft: result.data.attendeeUpdate,
  });
  return {
    outcome: "created",
    message: provider.isMock
      ? "Recovery proposal created by the mock AI (offline template). Nothing has been applied or sent."
      : "Recovery proposal created. Nothing has been applied or sent: review it, choose the changes and ask for approval.",
  };
}

async function planInEvent(eventId: string, planId: string) {
  const { db } = await managerContext(eventId);
  const { data, error } = await db
    .from("recovery_plans")
    .select("id, event_id, incident_id")
    .eq("id", planId)
    .maybeSingle();
  if (error || !data || data.event_id !== eventId)
    throw new AppError("not_found", "That plan isn't part of this event.");
  return { db, incidentId: data.incident_id as string };
}

export async function selectChanges(eventId: string, planId: string, changeIds: string[]) {
  const { db } = await planInEvent(eventId, planId);
  await repo.setSelection(db, planId, changeIds);
}

export async function rejectPlan(eventId: string, planId: string, reason: string) {
  const { db } = await planInEvent(eventId, planId);
  await repo.rejectPlan(db, planId, reason);
}

export async function closeIncident(
  eventId: string,
  incidentId: string,
  outcome: "resolved" | "dismissed",
  reason: string,
) {
  const { db } = await managerContext(eventId);
  await incidentInEvent(db, eventId, incidentId);
  await repo.closeIncident(db, incidentId, outcome, reason);
}

export async function resolveFlag(eventId: string, flagId: string, note: string) {
  const { db } = await managerContext(eventId);
  await repo.resolveFlag(db, flagId, note);
}

export async function editInquiry(eventId: string, id: string, subject: string, body: string) {
  const { db } = await managerContext(eventId);
  await repo.updateInquiry(db, id, subject, body);
}

export async function discardInquiry(eventId: string, id: string) {
  const { db } = await managerContext(eventId);
  await repo.discardInquiry(db, id);
}

export async function requestApproval(
  eventId: string,
  action: "apply_recovery" | "send_provider_inquiry",
  targetId: string,
) {
  const { db } = await managerContext(eventId);
  return commsRepo.requestApproval(db, action, targetId);
}

async function approvalOf(eventId: string, approvalId: string, action: string) {
  const { db } = await managerContext(eventId);
  const a = await commsRepo.getApproval(db, approvalId);
  if (!a || a.event_id !== eventId || a.action_type !== action)
    throw new AppError("not_found", "That approval isn't part of this event.");
  return { db, approval: a };
}

/** Applies the approved subset of changes, in one database transaction. */
export async function applyApproved(eventId: string, approvalId: string) {
  const { db } = await approvalOf(eventId, approvalId, "apply_recovery");
  const r = await repo.executeApply(db, approvalId);
  return r === "executed"
    ? "Applied. Only the approved changes were made; bookings were not cancelled."
    : "What was approved changed after the review, so nothing was applied. Ask for a new approval.";
}

/** Records an approved provider inquiry as sent. Nobody is contacted: the incident is a simulation. */
export async function recordInquiryApproved(eventId: string, approvalId: string) {
  const { db } = await approvalOf(eventId, approvalId, "send_provider_inquiry");
  const r = await repo.executeInquiry(db, approvalId);
  return r === "executed"
    ? "Recorded as sent (simulated). No provider was contacted."
    : "The inquiry changed after the review, so nothing was recorded. Ask for a new approval.";
}
