import type { ParticipationStatus, ReviewStatus } from "./schemas";

/**
 * Attendee rules (event.md §20). Registration, application review and participation are separate
 * columns; communication delivery is recorded per message (§21) and never changes these.
 * Both tables mirror the SQL functions in migration 20261022000005_attendees.sql (parity-tested).
 */
export const PARTICIPATION_TRANSITIONS: Record<
  ParticipationStatus,
  readonly ParticipationStatus[]
> = {
  pending: ["accepted", "waitlisted", "rejected"],
  waitlisted: ["accepted", "rejected", "cancelled"],
  accepted: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "cancelled"],
  checked_in: [],
  rejected: ["pending"],
  cancelled: [],
};

export const REVIEW_TRANSITIONS: Record<ReviewStatus, readonly ReviewStatus[]> = {
  not_required: [],
  pending: ["approved", "rejected", "needs_information"],
  needs_information: ["pending", "approved", "rejected"],
  approved: ["pending"],
  rejected: ["pending"],
};

export const PARTICIPATION_LABELS: Record<ParticipationStatus, string> = {
  pending: "Awaiting decision",
  accepted: "Accepted",
  waitlisted: "Waitlisted",
  rejected: "Not accepted",
  confirmed: "Confirmed attendance",
  checked_in: "Checked in",
  cancelled: "Cancelled",
};
export const REVIEW_LABELS: Record<ReviewStatus, string> = {
  not_required: "No application",
  pending: "Application pending",
  needs_information: "Needs information",
  approved: "Application approved",
  rejected: "Application rejected",
};

export const PLACE_HOLDING: readonly ParticipationStatus[] = [
  "accepted",
  "confirmed",
  "checked_in",
];

/** Statuses offered to an organizer, with reasons the database would refuse (empty = allowed). */
export function participationOptions(a: {
  participation: ParticipationStatus;
  review: ReviewStatus;
  registered: boolean;
  placesLeft: number;
}): { to: ParticipationStatus; blockers: string[] }[] {
  return PARTICIPATION_TRANSITIONS[a.participation].map((to) => {
    const blockers: string[] = [];
    if ((to === "accepted" || to === "waitlisted") && !a.registered)
      blockers.push("They haven't registered yet.");
    if (to === "accepted" && a.review !== "not_required" && a.review !== "approved")
      blockers.push("Approve the application first.");
    if (to === "accepted" && a.placesLeft <= 0)
      blockers.push("The event is full: waitlist instead.");
    return { to, blockers };
  });
}
