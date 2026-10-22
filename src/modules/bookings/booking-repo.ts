import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import { BOOKING_STATUSES } from "./booking-rules";

export const BookingRow = z.object({
  id: z.string(),
  event_id: z.string(),
  request_id: z.string(),
  quote_id: z.string(),
  provider_id: z.string(),
  provider_name: z.string(),
  quote_revision: z.number(),
  amount: z.coerce.number(),
  currency: z.string(),
  inclusions: z.string(),
  conditions: z.string().nullable(),
  service_from: z.string(),
  service_to: z.string(),
  organizer_note: z.string().nullable(),
  status: z.enum(BOOKING_STATUSES),
  status_reason: z.string().nullable(),
  pending_cancellation_reason: z.string().nullable(),
  confirmed_at: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type BookingRow = z.infer<typeof BookingRow>;
const COLUMNS = Object.keys(BookingRow.shape).join(", ");

async function rpc(db: SupabaseServerClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw fromDbError(error);
  return data as unknown;
}

const sorted = (rows: unknown) =>
  z
    .array(BookingRow)
    .parse(rows)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

export async function listForEvent(db: SupabaseServerClient, eventId: string) {
  const { data, error } = await db.from("bookings").select(COLUMNS).eq("event_id", eventId);
  if (error) throw fromDbError(error);
  return sorted(data);
}

/** RLS limits these to providers the caller is a member of. */
export async function listForProviders(db: SupabaseServerClient, providerIds: string[]) {
  if (providerIds.length === 0) return [];
  const { data, error } = await db.from("bookings").select(COLUMNS).in("provider_id", providerIds);
  if (error) throw fromDbError(error);
  return sorted(data);
}

export async function listByStatus(db: SupabaseServerClient, status: string) {
  const { data, error } = await db.from("bookings").select(COLUMNS).eq("status", status);
  if (error) throw fromDbError(error);
  return sorted(data);
}

export async function getBooking(db: SupabaseServerClient, id: string) {
  const { data, error } = await db.from("bookings").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw fromDbError(error);
  return data ? BookingRow.parse(data) : null;
}

export const propose = (db: SupabaseServerClient, quoteId: string, note?: string) =>
  rpc(db, "propose_booking", { p_quote_id: quoteId, p_note: note ?? null }).then((d) =>
    z.string().parse(d),
  );
export const requestApproval = (db: SupabaseServerClient, id: string) =>
  rpc(db, "request_booking_approval", { p_booking_id: id }).then((d) => z.string().parse(d));
export const requestCancellation = (db: SupabaseServerClient, id: string, reason: string) =>
  rpc(db, "request_booking_cancellation", { p_booking_id: id, p_reason: reason }).then((d) =>
    z.string().parse(d),
  );
export const executeApproval = (db: SupabaseServerClient, approvalId: string) =>
  rpc(db, "execute_booking_approval", { p_approval_id: approvalId }).then((d) =>
    z.enum(["executed", "superseded"]).parse(d),
  );
export const organizerAction = (
  db: SupabaseServerClient,
  id: string,
  to: string,
  reason?: string,
) => rpc(db, "organizer_booking_action", { p_booking_id: id, p_to: to, p_reason: reason ?? null });
export const providerAction = (db: SupabaseServerClient, id: string, to: string, reason?: string) =>
  rpc(db, "provider_booking_action", { p_booking_id: id, p_to: to, p_reason: reason ?? null });
export const resolveDispute = (db: SupabaseServerClient, id: string, to: string, reason: string) =>
  rpc(db, "resolve_booking_dispute", { p_booking_id: id, p_to: to, p_reason: reason });
