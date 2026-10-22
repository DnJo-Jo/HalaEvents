import "server-only";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";
import { listApprovals } from "@/modules/comms/repo";
import * as eventsRepo from "@/modules/events/repo";
import { getEventForMember } from "@/modules/events/service";
import * as providers from "@/modules/profiles/providers-repo";
import { requireMember } from "@/modules/profiles/service";
import * as repo from "./booking-repo";
import { directActions, type BookingStatus } from "./booking-rules";

/**
 * Bookings (event.md §22). Organizer actions are checked here and in SQL; confirmation is only
 * possible for a member of the booked provider; disputes are resolved by platform admins.
 * There are no payments.
 */

async function organizerContext(eventId: string) {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const role = await eventsRepo.getRole(db, eventId, user.id);
  if (role !== "owner" && role !== "organizer")
    throw new AppError("forbidden", "Only the event's owner or organizers can manage bookings.");
  return db;
}

async function bookingInEvent(
  db: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  eventId: string,
  id: string,
) {
  const b = await repo.getBooking(db, id);
  if (!b || b.event_id !== eventId)
    throw new AppError("not_found", "That booking isn't part of this event.");
  return b;
}

export async function getEventBookings(eventId: string) {
  const { event, canManage } = await getEventForMember(eventId);
  if (!canManage) return { event, canManage, bookings: [], approvals: [] };
  const db = await createSupabaseServerClient();
  const [bookings, approvals] = await Promise.all([
    repo.listForEvent(db, eventId),
    listApprovals(db, eventId),
  ]);
  return {
    event,
    canManage,
    bookings: bookings.map((b) => ({
      ...b,
      organizerActions: directActions(b.status, "organizer"),
      approval: approvals.find(
        (a) => a.target_id === b.id && ["pending", "approved", "executing"].includes(a.status),
      ),
    })),
    approvals: approvals.filter((a) => a.action_type !== "send_communication"),
  };
}

/** Organizer proposes a booking from a submitted quote (the request page). */
export async function proposeBooking(
  quoteId: string,
  note?: string,
): Promise<{ eventId: string; id: string }> {
  await requireMember();
  const db = await createSupabaseServerClient();
  const id = await repo.propose(db, quoteId, note);
  const b = await repo.getBooking(db, id);
  return { eventId: b!.event_id, id };
}

export async function requestBookingApproval(eventId: string, id: string) {
  const db = await organizerContext(eventId);
  const b = await bookingInEvent(db, eventId, id);
  if (b.status !== "proposed")
    throw new AppError(
      "invalid_transition",
      "Only proposed bookings can be submitted for approval.",
    );
  return repo.requestApproval(db, id);
}

export async function requestCancellation(eventId: string, id: string, reason: string) {
  const db = await organizerContext(eventId);
  const b = await bookingInEvent(db, eventId, id);
  if (b.status !== "confirmed")
    throw new AppError(
      "invalid_transition",
      "Only confirmed bookings need a cancellation approval.",
    );
  return repo.requestCancellation(db, id, reason);
}

export async function executeApproval(eventId: string, approvalId: string) {
  const db = await organizerContext(eventId);
  return repo.executeApproval(db, approvalId);
}

export async function organizerAction(
  eventId: string,
  id: string,
  to: BookingStatus,
  reason?: string,
) {
  const db = await organizerContext(eventId);
  const b = await bookingInEvent(db, eventId, id);
  if (!directActions(b.status, "organizer").includes(to)) {
    throw new AppError(
      "invalid_transition",
      b.status === "confirmed" && to === "cancelled"
        ? "Cancelling a confirmed booking needs an approval."
        : `A ${b.status.replace(/_/g, " ")} booking can't be set to ${to.replace(/_/g, " ")} by the organizer.`,
    );
  }
  await repo.organizerAction(db, id, to, reason);
}

export async function providerBookings() {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const mine = await providers.listMyProviders(db, user.id);
  const bookings = await repo.listForProviders(
    db,
    mine.map((p) => p.id),
  );
  return bookings.map((b) => ({ ...b, providerActions: directActions(b.status, "provider") }));
}

export async function providerAction(id: string, to: BookingStatus, reason?: string) {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const b = await repo.getBooking(db, id);
  if (!b) throw new AppError("not_found", "That booking doesn't exist or isn't yours.");
  if (!(await providers.getMemberRole(db, b.provider_id, user.id)))
    throw new AppError("forbidden", "Only the booked provider can do this.");
  if (!directActions(b.status, "provider").includes(to))
    throw new AppError(
      "invalid_transition",
      `A ${b.status.replace(/_/g, " ")} booking can't be set to ${to.replace(/_/g, " ")}.`,
    );
  await repo.providerAction(db, id, to, reason);
}

export async function disputedBookings() {
  const { isAdmin } = await requireMember();
  if (!isAdmin) notFound();
  return repo.listByStatus(await createSupabaseServerClient(), "disputed");
}

export async function resolveDispute(id: string, to: BookingStatus, reason: string) {
  const { isAdmin } = await requireMember();
  if (!isAdmin) throw new AppError("forbidden", "Only platform admins resolve disputes.");
  await repo.resolveDispute(await createSupabaseServerClient(), id, to, reason);
}
