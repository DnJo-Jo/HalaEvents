import "server-only";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";
import * as eventsRepo from "@/modules/events/repo";
import { getEventForMember } from "@/modules/events/service";
import { requireMember } from "@/modules/profiles/service";
import * as repo from "./repo";
import { participationOptions, PARTICIPATION_TRANSITIONS, REVIEW_TRANSITIONS } from "./rules";
import type { ParticipationStatus, ReviewStatus } from "./schemas";

/**
 * Attendees (event.md §20). Personal data is visible to the event's owner/organizers only; viewers
 * see counts. Every decision is re-checked by the SQL functions (capacity under an event lock).
 */
const OPEN_EVENT = new Set(["draft", "planning", "ready", "live"]);

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
    throw new AppError("forbidden", "Only the event's owner or organizers can manage attendees.");
  if (!OPEN_EVENT.has(event.status))
    throw new AppError("conflict", `This event is ${event.status}, so attendees can't change.`);
  return { db, event };
}

async function attendeeInEvent(
  db: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  eventId: string,
  id: string,
) {
  const a = await repo.getAttendee(db, id);
  if (!a || a.event_id !== eventId)
    throw new AppError("not_found", "That person isn't registered for this event.");
  return a;
}

export async function getAttendeeBoard(eventId: string) {
  const { event, role, canManage } = await getEventForMember(eventId);
  const db = await createSupabaseServerClient();
  const [summary, attendees, settings] = await Promise.all([
    repo.summary(db, eventId),
    canManage ? repo.listAttendees(db, eventId) : Promise.resolve([]),
    canManage ? repo.registrationSettings(db, eventId) : Promise.resolve(null),
  ]);
  const placesLeft = summary ? summary.capacity - summary.taken : 0;
  return {
    event,
    role,
    canManage,
    canEdit: canManage && OPEN_EVENT.has(event.status),
    summary,
    settings,
    attendees: attendees.map((a) => ({
      ...a,
      participationOptions: participationOptions({
        participation: a.participation_status,
        review: a.review_status,
        registered: a.registration_status === "registered",
        placesLeft,
      }),
      reviewOptions: REVIEW_TRANSITIONS[a.review_status],
    })),
  };
}

export async function addAttendee(
  eventId: string,
  input: { fullName: string; email: string; phone?: string; registered: boolean },
) {
  const { db } = await managerContext(eventId);
  return repo.addAttendee(db, eventId, input);
}

export async function setParticipation(
  eventId: string,
  id: string,
  to: ParticipationStatus,
  reason?: string,
) {
  const { db } = await managerContext(eventId);
  const a = await attendeeInEvent(db, eventId, id);
  if (!PARTICIPATION_TRANSITIONS[a.participation_status].includes(to))
    throw new AppError(
      "invalid_transition",
      `Participation can't go from ${a.participation_status} to ${to}.`,
    );
  await repo.setParticipation(db, id, to, reason);
}

export async function setReview(eventId: string, id: string, to: ReviewStatus, reason?: string) {
  const { db } = await managerContext(eventId);
  const a = await attendeeInEvent(db, eventId, id);
  if (!REVIEW_TRANSITIONS[a.review_status].includes(to))
    throw new AppError(
      "invalid_transition",
      `The application can't go from ${a.review_status} to ${to}.`,
    );
  await repo.setReview(db, id, to, reason);
}

export async function withdraw(eventId: string, id: string, reason?: string) {
  const { db } = await managerContext(eventId);
  await attendeeInEvent(db, eventId, id);
  await repo.withdraw(db, id, reason);
}

export async function updateRegistrationSettings(
  eventId: string,
  s: { registrationOpen: boolean; requiresApplication: boolean; slug: string },
) {
  const { db } = await managerContext(eventId);
  await repo.updateRegistrationSettings(db, eventId, s);
}

/** Public (no session). The RPC validates slug, window, consent and capacity itself. */
export async function publicEvent(slug: string) {
  return repo.publicEvent(await createSupabaseServerClient(), slug);
}

export async function registerPublic(
  slug: string,
  input: { fullName: string; email: string; phone?: string; applicationNote?: string },
) {
  return repo.register(await createSupabaseServerClient(), slug, input);
}
