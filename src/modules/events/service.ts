import "server-only";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";
import { requireMember } from "@/modules/profiles/service";
import { playbookFor } from "@/playbooks";
import { listFollowUps } from "@/modules/planning/repo";
import { missingInformation } from "@/modules/planning/rules";
import {
  answerContext,
  eventContext,
  interviewEditable,
  interviewState,
  parseSubmission,
  withFollowUps,
} from "./interview-rules";
import { canTransition } from "./rules";
import * as repo from "./repo";
import type { EventRow } from "./repo";
import { EventType, type EventFormInput, type EventMemberRole, type EventStatus } from "./schemas";

export async function listMyEvents() {
  const { user } = await requireMember();
  return repo.listMyEvents(await createSupabaseServerClient(), user.id);
}

/** The event plus the caller's role, or 404 when the caller is not a member. */
export async function getEventForMember(eventId: string) {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const [event, role] = await Promise.all([
    repo.getEvent(db, eventId),
    repo.getRole(db, eventId, user.id),
  ]);
  if (!event || !role) notFound();
  return { event, role, canManage: role === "owner" || role === "organizer" };
}

export async function requireEventManager(eventId: string): Promise<EventMemberRole> {
  const { user } = await requireMember();
  const role = await repo.getRole(await createSupabaseServerClient(), eventId, user.id);
  if (role !== "owner" && role !== "organizer") {
    throw new AppError("forbidden", "Only the event's owner or organizers can do this.");
  }
  return role;
}

export async function createEvent(input: EventFormInput): Promise<string> {
  const { user, roles } = await requireMember();
  if (!roles.includes("organizer"))
    throw new AppError("forbidden", "Add the “Organizer” role in Settings first.");
  return repo.createEvent(await createSupabaseServerClient(), user.id, input);
}

/** The event's playbook, the caller's answers so far, the next round and plan readiness. */
export async function getInterview(eventId: string) {
  const { event, role, canManage } = await getEventForMember(eventId);
  const db = await createSupabaseServerClient();
  const playbook = playbookFor(EventType.parse(event.event_type));
  const [stored, followUps] = await Promise.all([
    repo.listInterviewAnswers(db, eventId),
    listFollowUps(db, eventId),
  ]);
  const live = followUps.filter((f) => f.status === "proposed");
  const questions = withFollowUps(
    playbook,
    live.map((f) => f.question),
  );
  const ctx = eventContext(event);
  const state = interviewState(questions, ctx, stored);
  return {
    event,
    role,
    playbook,
    state,
    /** Open AI follow-ups by question key, so the page can label them and offer "Dismiss". */
    followUps: new Map(live.map((f) => [f.question.key, f])),
    missing: missingInformation(playbook, answerContext(ctx, state)),
    canEdit: canManage && interviewEditable(event.status),
  };
}

/** Validates a submitted round against the playbook and saves it (event owner/organizers only). */
export async function saveInterview(
  eventId: string,
  raw: Record<string, unknown>,
): Promise<{ ok: true; complete: boolean } | { ok: false; fieldErrors: Record<string, string[]> }> {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const [event, role] = await Promise.all([
    repo.getEvent(db, eventId),
    repo.getRole(db, eventId, user.id),
  ]);
  if (!event || !role)
    throw new AppError("not_found", "That event doesn't exist or isn't visible to you.");
  if (role !== "owner" && role !== "organizer") {
    throw new AppError(
      "forbidden",
      "Only the event's owner or organizers can answer the interview.",
    );
  }
  if (!interviewEditable(event.status)) {
    throw new AppError(
      "conflict",
      `This event is ${event.status}, so its interview answers can't be changed.`,
    );
  }
  const ctx = eventContext(event);
  const [stored, followUps] = await Promise.all([
    repo.listInterviewAnswers(db, eventId),
    listFollowUps(db, eventId),
  ]);
  // Only open AI follow-ups can be answered; their keys are validated like playbook questions.
  const playbook = withFollowUps(
    playbookFor(EventType.parse(event.event_type)),
    followUps.filter((f) => f.status === "proposed").map((f) => f.question),
  );
  const parsed = parseSubmission(playbook, ctx, stored, raw);
  if (!parsed.ok) return parsed;
  await repo.saveInterviewAnswers(db, eventId, playbook, parsed.answers, parsed.removeKeys);
  const kept = Object.fromEntries(
    Object.entries(stored).filter(([k]) => !parsed.removeKeys.includes(k)),
  );
  return {
    ok: true,
    complete: interviewState(playbook, ctx, { ...kept, ...parsed.answers }).complete,
  };
}

/** The playbook, interview state and answer context of an event (for plan, compliance, reminders). */
export async function planningContext(
  db: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  event: EventRow,
) {
  const playbook = playbookFor(EventType.parse(event.event_type));
  const [stored, followUps] = await Promise.all([
    repo.listInterviewAnswers(db, event.id),
    listFollowUps(db, event.id),
  ]);
  const live = followUps
    .filter((f) => f.status === "proposed" || f.status === "accepted")
    .map((f) => f.question);
  const ectx = eventContext(event);
  const state = interviewState(withFollowUps(playbook, live), ectx, stored);
  return { playbook, state, ctx: answerContext(ectx, state) };
}

/** Event details can be edited until the event is completed, archived or cancelled. */
const DETAILS_EDITABLE = new Set<EventStatus>(["draft", "planning", "ready", "live"]);

async function managedEvent(eventId: string) {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const [event, role] = await Promise.all([
    repo.getEvent(db, eventId),
    repo.getRole(db, eventId, user.id),
  ]);
  if (!event || !role)
    throw new AppError("not_found", "That event doesn't exist or isn't visible to you.");
  if (role !== "owner" && role !== "organizer")
    throw new AppError("forbidden", "Only the event's owner or organizers can change the event.");
  return { db, event };
}

export async function updateEvent(eventId: string, input: EventFormInput): Promise<void> {
  const { db, event } = await managedEvent(eventId);
  if (!DETAILS_EDITABLE.has(event.status)) {
    throw new AppError("conflict", `This event is ${event.status}, so its details can't change.`);
  }
  await repo.updateEvent(db, eventId, input);
}

/** Lifecycle change; the rules table is checked here and again by the events trigger (0003). */
export async function changeEventStatus(eventId: string, to: EventStatus): Promise<void> {
  const { db, event } = await managedEvent(eventId);
  if (!canTransition(event.status, to)) {
    throw new AppError("invalid_transition", `An event can't go from ${event.status} to ${to}.`);
  }
  await repo.setEventStatus(db, eventId, to);
}

/** Important changes to the event (from the audit log, whitelisted fields only). Any member. */
export async function getTimeline(eventId: string, limit = 30) {
  await getEventForMember(eventId);
  return repo.listTimeline(await createSupabaseServerClient(), eventId, limit);
}
