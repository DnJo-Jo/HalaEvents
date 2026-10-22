import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import { ParticipationStatus, RegistrationStatus, ReviewStatus } from "./schemas";

export const AttendeeRow = z.object({
  id: z.string(),
  event_id: z.string(),
  full_name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  application_note: z.string().nullable(),
  source: z.enum(["public_form", "organizer"]),
  registration_status: RegistrationStatus,
  review_status: ReviewStatus,
  participation_status: ParticipationStatus,
  decision_reason: z.string().nullable(),
  registered_at: z.string().nullable(),
  confirmed_at: z.string().nullable(),
  checked_in_at: z.string().nullable(),
  created_at: z.string(),
});
export type AttendeeRow = z.infer<typeof AttendeeRow>;
const COLUMNS = Object.keys(AttendeeRow.shape).join(", ");

export const Summary = z.object({
  capacity: z.number(),
  taken: z.number(),
  waitlisted: z.number(),
  pending: z.number(),
  checked_in: z.number(),
});
export type Summary = z.infer<typeof Summary>;

export const PublicEvent = z.object({
  name: z.string(),
  starts_at: z.string(),
  ends_at: z.string(),
  timezone: z.string(),
  city: z.string().nullable(),
  venue_type: z.string().nullable(),
  requires_application: z.boolean(),
  places_left: z.number(),
});
export type PublicEvent = z.infer<typeof PublicEvent>;

async function rpc(db: SupabaseServerClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw fromDbError(error);
  return data as unknown;
}

export async function listAttendees(db: SupabaseServerClient, eventId: string) {
  const { data, error } = await db.from("attendees").select(COLUMNS).eq("event_id", eventId);
  if (error) throw fromDbError(error);
  return z
    .array(AttendeeRow)
    .parse(data)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function getAttendee(db: SupabaseServerClient, id: string) {
  const { data, error } = await db.from("attendees").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw fromDbError(error);
  return data ? AttendeeRow.parse(data) : null;
}

export const summary = (db: SupabaseServerClient, eventId: string) =>
  rpc(db, "event_attendance_summary", { p_event_id: eventId }).then((d) => {
    const rows = z.array(Summary).parse(d ?? []);
    return rows[0] ?? null;
  });

export const publicEvent = (db: SupabaseServerClient, slug: string) =>
  rpc(db, "public_event_by_slug", { p_slug: slug }).then(
    (d) => z.array(PublicEvent).parse(d ?? [])[0] ?? null,
  );

export const register = (
  db: SupabaseServerClient,
  slug: string,
  r: { fullName: string; email: string; phone?: string; applicationNote?: string },
) =>
  rpc(db, "register_attendee", {
    p_slug: slug,
    p_full_name: r.fullName,
    p_email: r.email,
    p_phone: r.phone ?? null,
    p_application_note: r.applicationNote ?? null,
    p_consent: true,
  }).then((d) =>
    z.enum(["accepted", "waitlisted", "pending", "registered", "already_registered"]).parse(d),
  );

export const addAttendee = (
  db: SupabaseServerClient,
  eventId: string,
  a: { fullName: string; email: string; phone?: string; registered: boolean },
) =>
  rpc(db, "add_attendee", {
    p_event_id: eventId,
    p_full_name: a.fullName,
    p_email: a.email,
    p_phone: a.phone ?? null,
    p_registered: a.registered,
  }).then((d) => z.string().parse(d));

export const setReview = (db: SupabaseServerClient, id: string, status: string, reason?: string) =>
  rpc(db, "set_attendee_review", { p_attendee_id: id, p_status: status, p_reason: reason ?? null });

export const setParticipation = (
  db: SupabaseServerClient,
  id: string,
  status: string,
  reason?: string,
) =>
  rpc(db, "set_attendee_participation", {
    p_attendee_id: id,
    p_status: status,
    p_reason: reason ?? null,
  });

export const withdraw = (db: SupabaseServerClient, id: string, reason?: string) =>
  rpc(db, "withdraw_attendee", { p_attendee_id: id, p_reason: reason ?? null });

export async function updateRegistrationSettings(
  db: SupabaseServerClient,
  eventId: string,
  s: { registrationOpen: boolean; requiresApplication: boolean; slug: string },
) {
  const { error } = await db
    .from("events")
    .update({
      registration_open: s.registrationOpen,
      requires_application: s.requiresApplication,
      published_slug: s.slug,
    })
    .eq("id", eventId);
  if (error) throw fromDbError(error);
}

export async function registrationSettings(db: SupabaseServerClient, eventId: string) {
  const { data, error } = await db
    .from("events")
    .select("registration_open, requires_application, published_slug")
    .eq("id", eventId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  return z
    .object({
      registration_open: z.boolean(),
      requires_application: z.boolean(),
      published_slug: z.string().nullable(),
    })
    .parse(data ?? { registration_open: false, requires_application: false, published_slug: null });
}
