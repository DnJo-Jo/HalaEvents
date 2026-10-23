import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import { AnswerValue, type Answers } from "./interview-rules";
import { TimelineEntry } from "./timeline";
import { EventMemberRole, EventStatus, VenueType, type EventFormInput } from "./schemas";

export const EventRow = z.object({
  id: z.string(),
  owner_id: z.string(),
  name: z.string(),
  event_type: z.string(),
  status: EventStatus,
  venue_type: VenueType.nullable(),
  location_text: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string(),
  timezone: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  capacity: z.number(),
  budget_amount: z.union([z.null(), z.coerce.number()]),
  currency: z.string(),
});
export type EventRow = z.infer<typeof EventRow>;
const COLUMNS = Object.keys(EventRow.shape).join(", ");

export async function listMyEvents(
  db: SupabaseServerClient,
  userId: string,
): Promise<(EventRow & { member_role: EventMemberRole })[]> {
  const { data, error } = await db
    .from("event_members")
    .select(`role, events (${COLUMNS})`)
    .eq("user_id", userId);
  if (error) throw fromDbError(error);
  return z
    .array(z.object({ role: EventMemberRole, events: EventRow }))
    .parse(data)
    .map((r) => ({ ...r.events, member_role: r.role }))
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));
}

export async function getEvent(db: SupabaseServerClient, id: string): Promise<EventRow | null> {
  const { data, error } = await db.from("events").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw fromDbError(error);
  return data ? EventRow.parse(data) : null;
}

export async function getRole(
  db: SupabaseServerClient,
  eventId: string,
  userId: string,
): Promise<EventMemberRole | null> {
  const { data, error } = await db
    .from("event_members")
    .select("role")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data ? EventMemberRole.parse(data.role) : null;
}

export async function createEvent(
  db: SupabaseServerClient,
  ownerId: string,
  e: EventFormInput,
): Promise<string> {
  const { data, error } = await db
    .from("events")
    .insert({
      owner_id: ownerId,
      name: e.name,
      event_type: e.eventType,
      venue_type: e.venueType ?? null,
      location_text: e.locationText ?? null,
      city: e.city ?? null,
      timezone: e.timezone,
      starts_at: e.startsAt,
      ends_at: e.endsAt,
      capacity: e.capacity,
      budget_amount: e.budgetAmount ?? null,
      currency: e.currency,
    })
    .select("id")
    .single();
  if (error) throw fromDbError(error);
  return z.object({ id: z.string() }).parse(data).id;
}

const InterviewAnswerRow = z.object({ question_key: z.string(), answer: AnswerValue });

export async function listInterviewAnswers(
  db: SupabaseServerClient,
  eventId: string,
): Promise<Answers> {
  const { data, error } = await db
    .from("interview_answers")
    .select("question_key, answer")
    .eq("event_id", eventId);
  if (error) throw fromDbError(error);
  return Object.fromEntries(
    z
      .array(InterviewAnswerRow)
      .parse(data)
      .map((r) => [r.question_key, r.answer]),
  );
}

export async function saveInterviewAnswers(
  db: SupabaseServerClient,
  eventId: string,
  playbook: { id: string; version: number },
  answers: Answers,
  removeKeys: string[],
): Promise<void> {
  const { error } = await db.rpc("save_interview_answers", {
    p_event_id: eventId,
    p_playbook_id: playbook.id,
    p_playbook_version: playbook.version,
    p_answers: answers,
    p_remove_keys: removeKeys,
  });
  if (error) throw fromDbError(error);
}

export async function updateEvent(
  db: SupabaseServerClient,
  id: string,
  e: EventFormInput,
): Promise<void> {
  const { error } = await db
    .from("events")
    .update({
      name: e.name,
      venue_type: e.venueType ?? null,
      location_text: e.locationText ?? null,
      city: e.city ?? null,
      timezone: e.timezone,
      starts_at: e.startsAt,
      ends_at: e.endsAt,
      capacity: e.capacity,
      budget_amount: e.budgetAmount ?? null,
      currency: e.currency,
    })
    .eq("id", id);
  if (error) throw fromDbError(error);
}

export async function setEventStatus(
  db: SupabaseServerClient,
  id: string,
  status: EventStatus,
): Promise<void> {
  const { error } = await db.from("events").update({ status }).eq("id", id);
  if (error) throw fromDbError(error);
}

export async function listTimeline(
  db: SupabaseServerClient,
  eventId: string,
  limit = 30,
): Promise<TimelineEntry[]> {
  const { data, error } = await db.rpc("event_timeline", { p_event_id: eventId, p_limit: limit });
  if (error) throw fromDbError(error);
  return z.array(TimelineEntry).parse(data ?? []);
}
