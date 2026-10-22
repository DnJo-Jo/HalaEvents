/**
 * Booking lifecycle (event.md §22). Mirrors booking_transition_allowed() in migration
 * 20261022000007_bookings.sql; tests/db/bookings.test.ts checks every (from, to, actor).
 * A quote is never a booking, and only a provider member can confirm one.
 */
export const BOOKING_STATUSES = [
  "proposed",
  "awaiting_organizer_approval",
  "awaiting_provider",
  "confirmed",
  "declined_by_provider",
  "cancelled",
  "completed",
  "disputed",
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** approval = applied when an approval is requested, rejected/superseded or executed. */
export const BOOKING_ACTORS = ["organizer", "provider", "approval", "admin"] as const;
export type BookingActor = (typeof BOOKING_ACTORS)[number];

export const BOOKING_TRANSITIONS: Record<
  BookingStatus,
  readonly { to: BookingStatus; actor: BookingActor }[]
> = {
  proposed: [
    { to: "awaiting_organizer_approval", actor: "approval" },
    { to: "cancelled", actor: "organizer" },
  ],
  awaiting_organizer_approval: [
    { to: "proposed", actor: "approval" },
    { to: "awaiting_provider", actor: "approval" },
  ],
  awaiting_provider: [
    { to: "confirmed", actor: "provider" },
    { to: "declined_by_provider", actor: "provider" },
    { to: "cancelled", actor: "organizer" },
  ],
  confirmed: [
    { to: "cancelled", actor: "approval" },
    { to: "cancelled", actor: "provider" },
    { to: "completed", actor: "organizer" },
    { to: "disputed", actor: "organizer" },
    { to: "disputed", actor: "provider" },
  ],
  declined_by_provider: [],
  cancelled: [],
  completed: [
    { to: "disputed", actor: "organizer" },
    { to: "disputed", actor: "provider" },
  ],
  disputed: [
    { to: "confirmed", actor: "admin" },
    { to: "completed", actor: "admin" },
    { to: "cancelled", actor: "admin" },
  ],
};

export function canBookingTransition(from: BookingStatus, to: BookingStatus, actor: BookingActor) {
  return BOOKING_TRANSITIONS[from].some((t) => t.to === to && t.actor === actor);
}

export const BOOKING_LABELS: Record<BookingStatus, string> = {
  proposed: "Proposed (not sent)",
  awaiting_organizer_approval: "Awaiting organizer approval",
  awaiting_provider: "Awaiting provider confirmation",
  confirmed: "Confirmed by provider",
  declined_by_provider: "Declined by provider",
  cancelled: "Cancelled",
  completed: "Completed",
  disputed: "Disputed",
};

/** Next steps an actor may take directly (approval-driven moves are separate buttons). */
export function directActions(
  status: BookingStatus,
  actor: "organizer" | "provider",
): BookingStatus[] {
  return BOOKING_TRANSITIONS[status].filter((t) => t.actor === actor).map((t) => t.to);
}
