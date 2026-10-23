/** Application error codes (event.md §10.1). Route handlers map them to HTTP status codes. */
export type AppErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation_failed"
  | "invalid_transition"
  | "conflict"
  | "capacity_full"
  | "rate_limited"
  | "not_configured"
  | "ai_unavailable"
  | "internal";

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const HTTP_STATUS: Record<AppErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  validation_failed: 400,
  invalid_transition: 409,
  conflict: 409,
  capacity_full: 409,
  rate_limited: 429,
  not_configured: 503,
  ai_unavailable: 503,
  internal: 500,
};

/** Business rules raised by the workspace/compliance functions (migrations 0007–0008), by message prefix. */
const KNOWN_RULES: Record<string, [AppErrorCode, string]> = {
  task_blocked: [
    "invalid_transition",
    "This task is blocked: finish or cancel the tasks it depends on first.",
  ],
  dependency_cycle: ["validation_failed", "That dependency would create a loop between tasks."],
  cross_event_dependency: [
    "validation_failed",
    "Tasks can only depend on tasks of the same event.",
  ],
  owner_not_event_manager: [
    "validation_failed",
    "Task owners must be the event's owner or one of its organizers.",
  ],
  event_locked: ["conflict", "This event is finished or cancelled, so it can't be changed."],
  nothing_to_accept: ["conflict", "There are no open proposals left to accept."],
  source_not_verified: [
    "invalid_transition",
    "“Source-supported” needs a referenced source that a person has verified.",
  ],
  reviewer_required: ["invalid_transition", "Assign a reviewer before starting the review."],
  reviewer_not_event_manager: [
    "validation_failed",
    "Reviewers must be the event's owner or one of its organizers.",
  ],
  reviewer_only: [
    "forbidden",
    "Only the assigned reviewer or a platform admin can make this decision.",
  ],
  evidence_required: [
    "invalid_transition",
    "Record real evidence (not a simulation) before clearing this check.",
  ],
  submission_required: [
    "invalid_transition",
    "Record the submission reference before marking it as awaiting a response.",
  ],
  reason_required: ["validation_failed", "Give a short reason for this decision."],
  note_required: ["validation_failed", "Say what you checked on the source page."],
  // Attendees (migration 0009)
  capacity_full: ["capacity_full", "The event is full. Waitlist this person instead."],
  review_not_approved: ["invalid_transition", "Approve the application before accepting."],
  not_registered: ["invalid_transition", "This person hasn't registered yet."],
  consent_required: ["validation_failed", "Please agree to the data processing notice."],
  registration_closed: ["conflict", "Registration for this event is closed."],
  duplicate_registration: ["conflict", "This email is already registered for the event."],
  // Approvals and communications (0010)
  no_recipients: ["validation_failed", "Nobody matches this audience yet."],
  too_many_recipients: ["validation_failed", "Too many recipients for one message (max 500)."],
  approval_already_open: ["conflict", "An approval for this is already open."],
  already_executed: ["conflict", "This approval was already used. Nothing was sent twice."],
  not_approved: ["invalid_transition", "This needs an approved approval first."],
  invalid_results: ["internal", "The delivery results didn't match the approved message."],
  run_not_usable: ["validation_failed", "That draft can't be used."],
  // Bookings (0011)
  quote_not_bookable: [
    "conflict",
    "Only submitted, unexpired quotes from active providers can be booked.",
  ],
  booking_exists: ["conflict", "This request already has a booking in progress."],
  approval_required: ["invalid_transition", "Cancelling a confirmed booking needs an approval."],
  not_finished: ["invalid_transition", "The service period hasn't ended yet."],
  provider_conflict: [
    "conflict",
    "This venue already has a confirmed booking at that time, so it can't be confirmed.",
  ],
  // Recovery workflow (0008_recovery)
  invalid_key: ["validation_failed", "The request key was missing or invalid. Reload the page."],
  idempotency_conflict: [
    "conflict",
    "That request key was already used for another booking. Reload the page.",
  ],
  not_a_venue_booking: ["validation_failed", "Only a venue booking can be simulated as cancelled."],
  booking_not_simulatable: [
    "conflict",
    "The venue booking must be sent to the venue or confirmed before a cancellation can be simulated.",
  ],
  invalid_plan: [
    "validation_failed",
    "The recovery plan referenced something that isn't part of this incident, so it was discarded.",
  ],
  run_already_used: ["conflict", "That result was already saved as a plan."],
  nothing_selected: ["validation_failed", "Select at least one change to apply."],
  plan_not_applied: ["invalid_transition", "Apply an approved recovery plan before resolving."],
  // Reviews (0009_reviews)
  not_eligible: ["invalid_transition", "You can't review this booking yet."],
  conflict_of_interest: [
    "forbidden",
    "You are on both sides of this booking, so you can't review it.",
  ],
  duplicate_review: ["conflict", "This booking already has a review from you or your team."],
  duplicate_response: ["conflict", "This review already has a response."],
  duplicate_report: ["conflict", "You already reported this review."],
  invalid_rating: ["validation_failed", "Choose a rating from 1 to 5."],
  simulated_only: ["conflict", "Messages of a practice recovery are never sent for real."],
};

interface PgLikeError {
  code?: string;
  message?: string;
}

/**
 * Maps a PostgREST/Postgres error to an AppError. The raw message is kept server-side in `details`
 * and never shown to users. SQLSTATEs match the RAISE statements in supabase/migrations.
 */
export function fromDbError(error: PgLikeError): AppError {
  const msg = error.message ?? "";
  const known = Object.entries(KNOWN_RULES).find(([prefix]) => msg.startsWith(prefix));
  if (known) return new AppError(known[1][0], known[1][1], msg);
  switch (error.code) {
    case "28000":
      return new AppError("unauthenticated", "Please sign in again.", msg);
    case "42501":
      return new AppError("forbidden", "You don't have permission to do that.", msg);
    case "P0002":
    case "PGRST116":
      return new AppError("not_found", "That item doesn't exist or isn't visible to you.", msg);
    case "22023":
    case "22P02":
      return new AppError("validation_failed", "Some of the information isn't valid.", msg);
    case "23505":
      return new AppError("conflict", "That already exists.", msg);
    case "53400":
      return new AppError("rate_limited", "Too many requests. Please wait and try again.", msg);
    case "23514":
      return msg.startsWith("invalid_transition")
        ? new AppError("invalid_transition", "That status change isn't allowed.", msg)
        : new AppError("validation_failed", "Some of the information isn't valid.", msg);
    default:
      return new AppError("internal", "Something went wrong. Please try again.", msg);
  }
}
