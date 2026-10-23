import type {
  ApprovalStatus,
  Audience,
  CommunicationKind,
  CommunicationStatus,
  DeliveryStatus,
  MessageDraft,
} from "./schemas";

/**
 * Communication rules (event.md §21). Pure. Recipients come from attendee statuses (SQL), never
 * from a model; personalization fills a fixed set of placeholders in code.
 */
export const PLACEHOLDERS = ["name", "event_name", "event_date", "event_city"] as const;
export type Placeholder = (typeof PLACEHOLDERS)[number];
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_]+)\s*\}\}/g;

export function unknownPlaceholders(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)]
    .map((m) => m[1])
    .filter((p) => !(PLACEHOLDERS as readonly string[]).includes(p));
}

export function personalize(text: string, vars: Record<Placeholder, string>): string {
  return text.replace(PLACEHOLDER_RE, (all, key: string) =>
    (PLACEHOLDERS as readonly string[]).includes(key) ? vars[key as Placeholder] : all,
  );
}

const URL_LIKE = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\./i;
/** Claims a message must never make on its own (event.md §1 honesty rules). */
const FORBIDDEN_CLAIMS = [
  /\b(permit|licen[cs]e|approval)s?\b[^.]{0,40}\b(approved|granted|issued|obtained)\b/i,
  /\b(venue|booking|caterer|provider)\b[^.]{0,40}\b(is|has been|are)\s+(confirmed|booked|guaranteed)\b/i,
];

/** Business checks on a drafted message before it is saved. */
export function draftErrors(d: MessageDraft): string[] {
  const errors: string[] = [];
  const text = `${d.subject}\n${d.body}`;
  const unknown = unknownPlaceholders(text);
  if (unknown.length)
    errors.push(
      `Unknown placeholders: ${unknown.join(", ")}. Use only ${PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}.`,
    );
  if (URL_LIKE.test(text))
    errors.push("Don't include links or web addresses; the organizer adds them.");
  if (FORBIDDEN_CLAIMS.some((re) => re.test(text)))
    errors.push("Don't state that permits, venues or bookings are approved or confirmed.");
  return errors;
}

export const KIND_LABELS: Record<CommunicationKind, string> = {
  invitation: "Invitation",
  registration_confirmation: "Registration confirmation",
  acceptance: "Acceptance notice",
  waitlist: "Waitlist notice",
  reminder: "Event reminder",
  venue_update: "Venue update",
  schedule_update: "Schedule update",
  cancellation: "Cancellation notice",
  recovery: "Recovery / replacement plan",
  thank_you: "Post-event thank-you",
};

export const DEFAULT_AUDIENCE: Record<CommunicationKind, Audience> = {
  invitation: "invited",
  registration_confirmation: "registered",
  acceptance: "accepted",
  waitlist: "waitlisted",
  reminder: "all_places",
  venue_update: "all_places",
  schedule_update: "all_places",
  cancellation: "registered",
  recovery: "all_places",
  thank_you: "checked_in",
};

export const AUDIENCE_LABELS: Record<Audience, string> = {
  invited: "Invited (not registered yet)",
  registered: "Everyone registered",
  accepted: "Accepted",
  waitlisted: "Waitlisted",
  confirmed: "Confirmed attendance",
  checked_in: "Checked in",
  all_places: "Everyone holding a place (accepted, confirmed, checked in)",
  single: "One person",
};

export const COMM_STATUS_LABELS: Record<CommunicationStatus, string> = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  approved: "Approved, not sent",
  sending: "Sending (check before retrying)",
  sent: "Sent",
  partially_failed: "Partly failed",
  failed: "Failed",
  cancelled: "Cancelled",
};

/** Delivery labels never overstate: acceptance by an API is not delivery, and mock is not sent. */
export const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  simulated: "Test delivery — not sent",
  accepted: "Accepted by the email provider — delivery not confirmed",
  failed: "Failed",
  delivered: "Delivered (reported by provider)",
  bounced: "Bounced (reported by provider)",
};

export const APPROVAL_LABELS: Record<ApprovalStatus, string> = {
  pending: "Waiting for a decision",
  approved: "Approved, not executed",
  rejected: "Rejected",
  superseded: "Superseded (content changed; needs a new approval)",
  executing: "Executing — check before retrying",
  executed: "Executed",
  execution_failed: "Execution failed",
};

/** A message may be edited until it starts sending (editing invalidates its approval). */
export const EDITABLE: readonly CommunicationStatus[] = [
  "draft",
  "awaiting_approval",
  "approved",
  "failed",
];
