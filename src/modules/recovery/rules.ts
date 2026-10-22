import type { RecoveryGuidance } from "@/modules/ai/playbook";
import { unknownPlaceholders } from "@/modules/comms/rules";
import type { Impact, PlannedChange, RecoveryProposal } from "./schemas";

/**
 * Deterministic recovery rules (event.md §23). Pure. The model proposes; this file decides what is
 * acceptable, which items are flagged, and which numbers may be shown. Nothing here can cancel,
 * rebook or confirm a booking: the only change kinds are reschedule_task, add_task and flag_review.
 */

const DAY_MS = 86_400_000;
const REPLACEMENT = "replacement_venue_availability" as const;
const REOPEN_STATUSES = ["todo", "in_progress"] as const;

/** YYYY-MM-DD of an instant in an IANA timezone. */
export function dateInZone(iso: string | number | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function clampDate(date: string, min: string, max: string): string {
  return date < min ? min : date > max ? max : date;
}

/** Dates the plan may use: from today until the day the event starts (event timezone). */
export function planningWindow(impact: Impact, today: string) {
  return { first: today, last: dateInZone(impact.event.starts_at, impact.event.timezone) };
}

// ------------------------------------------------------------------------------------------------
// Claims the text must not make
// ------------------------------------------------------------------------------------------------

const URL_LIKE = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\./i;
const CLAIMS: { re: RegExp; what: string }[] = [
  {
    re: /\b(venue|hall|space|room|location|booking|caterer|provider|supplier|vendor)s?\b[^.]{0,60}\b(is|are|was|has been|have been)\s+(now\s+|already\s+)?(available|free|confirmed|booked|secured|guaranteed|approved)\b/i,
    what: "that a venue, booking or provider is available or confirmed",
  },
  {
    re: /\b(permit|licen[cs]e|clearance|approval|permission)s?\b[^.]{0,60}\b(approved|granted|issued|obtained|valid|cleared|carr(?:y|ies) over|transfers?)\b/i,
    what: "that a permit or clearance is granted or carries over",
  },
  {
    re: /\b(has|have|had)\s+(already\s+)?(agreed|consented|accepted|confirmed|approved)\b|\bagreed to\b/i,
    what: "that a provider agreed, consented or confirmed",
  },
];
const HEDGE = /\b(whether|if|once|until|unless|pending|should|could|might|may|can you|please)\b/i;
const CURRENCY = "AED|USD|EUR|GBP|SAR|Dhs?";
const AMOUNT_RES = [
  new RegExp(`(\\d[\\d,]*(?:\\.\\d+)?)\\s*(?:${CURRENCY})\\b`, "gi"),
  new RegExp(`\\b(?:${CURRENCY})\\s*(\\d[\\d,]*(?:\\.\\d+)?)`, "gi"),
];

/** Sentences that state something (questions and hedged requests are fine). */
function statements(text: string): string[] {
  return text
    .split(/(?<=[.!\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s && !s.includes("?") && !HEDGE.test(s));
}

/** Every amount the data contains, so the model can only repeat known prices. */
export function knownAmounts(impact: Impact): Set<number> {
  const out = new Set<number>();
  const add = (n: number | null | undefined) => {
    if (typeof n === "number" && Number.isFinite(n)) out.add(n);
  };
  add(impact.event.budget_amount);
  add(impact.venue.amount);
  impact.services.forEach((s) => add(s.amount));
  impact.candidates.forEach((c) => {
    add(c.price_min);
    add(c.price_max);
    add(c.quote?.amount);
  });
  return out;
}

function textErrors(label: string, text: string, impact: Impact): string[] {
  const errors: string[] = [];
  if (URL_LIKE.test(text)) errors.push(`${label}: don't include links or web addresses.`);
  const sentences = statements(text);
  for (const claim of CLAIMS) {
    if (sentences.some((s) => claim.re.test(s)))
      errors.push(`${label}: don't state ${claim.what}; nobody has said so.`);
  }
  const known = knownAmounts(impact);
  for (const re of AMOUNT_RES) {
    for (const m of text.matchAll(re)) {
      const n = Number(m[1].replaceAll(",", ""));
      if (!known.has(n))
        errors.push(
          `${label}: the amount ${m[0].trim()} isn't in the data. Prices come only from quotes on record.`,
        );
    }
  }
  return errors;
}

// ------------------------------------------------------------------------------------------------
// Validation of the model's proposal
// ------------------------------------------------------------------------------------------------

/**
 * Business-rule checks after the Zod schema. The returned messages go back to the model for one
 * repair turn; if they still fail, the proposal is discarded. The database repeats the checks that
 * protect organizer data (ids belong to this incident) in save_recovery_plan().
 */
export function validateProposal(p: RecoveryProposal, impact: Impact, today: string): string[] {
  const errors: string[] = [];
  const { first, last } = planningWindow(impact, today);
  if (last < first) return ["The event has already started, so no recovery dates are possible."];
  const inWindow = (d: string) => d >= first && d <= last;

  const optionKeys = new Set<string>();
  const candidateIds = new Set(impact.candidates.map((c) => c.provider_id));
  const usedCandidates = new Set<string>();
  for (const o of p.options) {
    if (optionKeys.has(o.key)) errors.push(`Option key "${o.key}" is used twice.`);
    optionKeys.add(o.key);
    if (o.candidateProviderId) {
      if (!candidateIds.has(o.candidateProviderId))
        errors.push(
          `Option "${o.key}" names a venue that isn't in the candidate list. Use one of: ${[...candidateIds].join(", ") || "(none; leave it empty)"}.`,
        );
      if (usedCandidates.has(o.candidateProviderId))
        errors.push(`Two options use the same candidate venue ${o.candidateProviderId}.`);
      usedCandidates.add(o.candidateProviderId);
    }
  }
  if (!optionKeys.has(p.recommendedOptionKey))
    errors.push(`recommendedOptionKey "${p.recommendedOptionKey}" doesn't match any option key.`);

  const affected = new Map(impact.affected_tasks.map((t) => [t.id, t]));
  const seenTasks = new Set<string>();
  for (const c of p.taskChanges) {
    const t = affected.get(c.taskId);
    if (!t) errors.push(`taskId ${c.taskId} isn't one of the affected tasks.`);
    else if (!(REOPEN_STATUSES as readonly string[]).includes(t.status))
      errors.push(`Task "${t.title}" is ${t.status} and can't be rescheduled.`);
    if (seenTasks.has(c.taskId)) errors.push(`Task ${c.taskId} is changed twice.`);
    seenTasks.add(c.taskId);
    if (!inWindow(c.newDueDate))
      errors.push(`newDueDate ${c.newDueDate} must be between ${first} and ${last}.`);
  }

  const titles = new Set(impact.plan_tasks.map((t) => t.title.trim().toLowerCase()));
  for (const t of p.newTasks) {
    const key = t.title.trim().toLowerCase();
    if (titles.has(key)) errors.push(`New task "${t.title}" already exists in the plan.`);
    titles.add(key);
    if (!inWindow(t.dueDate))
      errors.push(
        `New task "${t.title}": dueDate ${t.dueDate} must be between ${first} and ${last}.`,
      );
  }

  for (const e of p.timeline) {
    if (!inWindow(e.date))
      errors.push(
        `Timeline entry "${e.label}": date ${e.date} must be between ${first} and ${last}.`,
      );
  }

  const reviewable = {
    task: new Set(impact.affected_tasks.map((t) => t.id)),
    booking: new Set(impact.services.map((s) => s.booking_id)),
    compliance_check: new Set(impact.compliance.map((c) => c.id)),
  };
  const seenReview = new Set<string>();
  for (const n of p.reviewNotes) {
    if (!reviewable[n.entityType].has(n.entityId))
      errors.push(`reviewNotes: ${n.entityType} ${n.entityId} isn't part of this incident.`);
    const key = `${n.entityType}:${n.entityId}`;
    if (seenReview.has(key)) errors.push(`reviewNotes: ${key} appears twice.`);
    seenReview.add(key);
  }

  const venueProvider = impact.venue.provider_id;
  const serviceBookings = new Map(impact.services.map((s) => [s.booking_id, s]));
  const seenInquiry = new Set<string>();
  for (const q of p.providerInquiries) {
    const label = `Inquiry "${q.subject}"`;
    if (q.purpose === "venue_cancellation_terms") {
      if (q.providerId !== venueProvider)
        errors.push(`${label}: terms questions go to the original venue only.`);
    } else if (q.purpose === REPLACEMENT) {
      if (!candidateIds.has(q.providerId))
        errors.push(`${label}: availability questions go to a venue from the candidate list only.`);
    } else {
      const s = serviceBookings.get(q.bookingId);
      if (!s || s.provider_id !== q.providerId)
        errors.push(
          `${label}: reconfirmation needs the provider and booking id of one affected service.`,
        );
    }
    const key = `${q.providerId}:${q.purpose}:${q.bookingId}`;
    if (seenInquiry.has(key)) errors.push(`${label}: a duplicate of another inquiry.`);
    seenInquiry.add(key);
  }

  // Honesty rules over everything a person will read.
  const texts: [string, string][] = [
    ["summary", p.summary],
    ...p.options.flatMap((o) => [
      [`option ${o.key}`, `${o.description} ${o.pros.join(" ")}`] as [string, string],
    ]),
    ...p.timeline.map((e) => [`timeline "${e.label}"`, e.note] as [string, string]),
    ...p.providerInquiries.map(
      (q) => [`inquiry "${q.subject}"`, `${q.subject}\n${q.body}`] as [string, string],
    ),
    ["attendee update", `${p.attendeeUpdate.subject}\n${p.attendeeUpdate.body}`],
    ...p.risks.map((r) => ["risk", r] as [string, string]),
  ];
  for (const [label, text] of texts) errors.push(...textErrors(label, text, impact));

  const attendeeText = `${p.attendeeUpdate.subject}\n${p.attendeeUpdate.body}`.toLowerCase();
  for (const c of impact.candidates) {
    if (attendeeText.includes(c.name.toLowerCase()))
      errors.push(
        `The attendee update names "${c.name}", but no venue has agreed. Don't name a candidate venue to attendees.`,
      );
  }
  const unknown = unknownPlaceholders(attendeeText.replace(/\{\{\s*name\s*\}\}/g, ""));
  if (unknown.length)
    errors.push(
      `The attendee update uses unknown placeholders (${unknown.join(", ")}). Use only {{name}}, {{event_name}}, {{event_date}}, {{event_city}}.`,
    );

  return [...new Set(errors)];
}

// ------------------------------------------------------------------------------------------------
// From a validated proposal to stored changes
// ------------------------------------------------------------------------------------------------

export interface InquiryDraft {
  provider_id: string;
  booking_id: string;
  purpose: RecoveryProposal["providerInquiries"][number]["purpose"];
  subject: string;
  body: string;
}

const DEFAULT_REASON = {
  reconfirm: "The venue changed. Ask this provider to reconfirm; its own terms apply.",
  reassess: "Was assessed for the original venue. Reassess it for the replacement.",
  review: "Depends on the venue. Review it.",
} as const;

/**
 * Changes to store. Which services and compliance checks are flagged is decided here, not by the
 * model: every affected service booking is marked for reconfirmation and every affected compliance
 * check for reassessment. The model only supplies the reason text.
 */
export function buildChanges(p: RecoveryProposal, impact: Impact): PlannedChange[] {
  const out: PlannedChange[] = [];
  for (const c of p.taskChanges) {
    out.push({
      kind: "reschedule_task",
      entity_type: "task",
      entity_id: c.taskId,
      payload: { due_date: c.newDueDate, reason: c.reason },
    });
  }
  for (const t of p.newTasks) {
    out.push({
      kind: "add_task",
      entity_type: null,
      entity_id: null,
      payload: {
        title: t.title.trim(),
        description: t.description,
        category: t.category,
        priority: t.priority,
        due_date: t.dueDate,
      },
    });
  }
  const notes = new Map(p.reviewNotes.map((n) => [`${n.entityType}:${n.entityId}`, n.reason]));
  for (const s of impact.services) {
    out.push({
      kind: "flag_review",
      entity_type: "booking",
      entity_id: s.booking_id,
      payload: {
        action: "reconfirm",
        reason: notes.get(`booking:${s.booking_id}`) ?? DEFAULT_REASON.reconfirm,
      },
    });
  }
  for (const c of impact.compliance) {
    out.push({
      kind: "flag_review",
      entity_type: "compliance_check",
      entity_id: c.id,
      payload: {
        action: "reassess",
        reason: notes.get(`compliance_check:${c.id}`) ?? DEFAULT_REASON.reassess,
      },
    });
  }
  const moved = new Set(p.taskChanges.map((c) => c.taskId));
  for (const n of p.reviewNotes) {
    if (n.entityType === "task" && !moved.has(n.entityId)) {
      out.push({
        kind: "flag_review",
        entity_type: "task",
        entity_id: n.entityId,
        payload: { action: "review", reason: n.reason },
      });
    }
  }
  return out;
}

/** Model inquiries plus a templated reconfirmation for every affected service the model skipped. */
export function buildInquiries(
  p: RecoveryProposal,
  impact: Impact,
  guidance?: RecoveryGuidance["venueCancellation"],
): InquiryDraft[] {
  const out: InquiryDraft[] = p.providerInquiries.map((q) => ({
    provider_id: q.providerId,
    booking_id: q.bookingId,
    purpose: q.purpose,
    subject: q.subject,
    body: q.body,
  }));
  const covered = new Set(
    out.filter((q) => q.purpose === "service_reconfirmation").map((q) => q.booking_id),
  );
  for (const s of impact.services) {
    if (covered.has(s.booking_id)) continue;
    const ask = guidance?.reconfirm.find((r) => r.category === s.category)?.ask ?? [
      "Does anything about your arrangement depend on the original venue?",
      "What are your terms for a change of location or date?",
    ];
    out.push({
      provider_id: s.provider_id,
      booking_id: s.booking_id,
      purpose: "service_reconfirmation",
      subject: `Please review our booking for ${impact.event.name}`,
      body: `Hello ${s.provider_name},\n\nThe venue for ${impact.event.name} may change. Your booking is not cancelled by this. Could you tell us:\n${ask.map((a) => `- ${a}`).join("\n")}\n\nThe organizing team`,
    });
  }
  return out.slice(0, 12);
}

// ------------------------------------------------------------------------------------------------
// Budget implications from recorded quotes only
// ------------------------------------------------------------------------------------------------

export interface BudgetView {
  originalVenue: { name: string; amount: number; currency: string };
  eventBudget: { amount: number; currency: string } | null;
  candidates: {
    providerId: string;
    name: string;
    quoteAmount: number | null;
    currency: string | null;
    /** quote − original venue amount, only when both are in the same currency. */
    difference: number | null;
    validUntil: string | null;
  }[];
}

export function budgetView(impact: Impact): BudgetView {
  const v = impact.venue;
  return {
    originalVenue: { name: v.provider_name, amount: v.amount, currency: v.currency },
    eventBudget:
      impact.event.budget_amount === null
        ? null
        : { amount: impact.event.budget_amount, currency: impact.event.currency },
    candidates: impact.candidates.map((c) => ({
      providerId: c.provider_id,
      name: c.name,
      quoteAmount: c.quote?.amount ?? null,
      currency: c.quote?.currency ?? null,
      difference:
        c.quote && c.quote.currency === v.currency
          ? Math.round((c.quote.amount - v.amount) * 100) / 100
          : null,
      validUntil: c.quote?.valid_until ?? null,
    })),
  };
}

// ------------------------------------------------------------------------------------------------
// Offline proposal (mock provider)
// ------------------------------------------------------------------------------------------------

/** What the mock "model" returns: deterministic, built from the snapshot only. */
export function deterministicProposal(
  impact: Impact,
  today: string,
  guidance?: RecoveryGuidance["venueCancellation"],
): RecoveryProposal {
  const { first, last } = planningWindow(impact, today);
  const at = (days: number) => clampDate(addDays(today, days), first, last);
  const soon = addDays(today, 7);
  const taskChanges = impact.affected_tasks
    .filter(
      (t) =>
        (REOPEN_STATUSES as readonly string[]).includes(t.status) &&
        t.due_date &&
        t.due_date < soon,
    )
    .slice(0, 30)
    .map((t) => ({
      taskId: t.id,
      newDueDate: at(7),
      reason: "Venue work can't finish until a venue is chosen.",
    }))
    .filter((c) => {
      const t = impact.affected_tasks.find((x) => x.id === c.taskId);
      return t?.due_date !== c.newDueDate;
    });

  const existing = new Set(impact.plan_tasks.map((t) => t.title.trim().toLowerCase()));
  const newTasks = [
    {
      title: "Secure a replacement venue",
      description:
        "Shortlist venues, ask for availability and terms, and get a written answer before deciding.",
      category: "venue" as const,
      priority: "critical" as const,
      dueDate: at(3),
    },
    {
      title: "Reassess permits and access for the new venue",
      description: "Check whether permissions, access and safety arrangements name the old venue.",
      category: "compliance" as const,
      priority: "high" as const,
      dueDate: at(5),
    },
  ].filter((t) => !existing.has(t.title.toLowerCase()));

  const top = impact.candidates.slice(0, 2);
  const options: RecoveryProposal["options"] = top.map((c, i) => ({
    key: `replacement_${i + 1}`,
    title: `Ask ${c.name} about the dates`,
    description: `${c.name} is a verified venue in the area with a suitable capacity. Its availability for the event dates is unknown until it answers.`,
    candidateProviderId: c.provider_id,
    pros: [
      "Verified on HalaEvents",
      c.quote ? "A current quote is on record" : "Matches the capacity range",
    ],
    cons: ["Availability is not known", c.quote ? "Terms must be checked" : "No quote on record"],
  }));
  options.push({
    key: "hold_and_ask",
    title: "Hold the plan and ask the original venue",
    description:
      "Ask the original venue about its terms and whether the date can be kept, while looking for alternatives.",
    candidateProviderId: "",
    pros: ["No new commitments yet"],
    cons: ["Time is limited", "Outcome depends on the venue's answer"],
  });

  const inquiries: RecoveryProposal["providerInquiries"] = [
    {
      providerId: impact.venue.provider_id,
      bookingId: impact.venue.booking_id,
      purpose: "venue_cancellation_terms",
      subject: `Our booking for ${impact.event.name}`,
      body: `Hello ${impact.venue.provider_name},\n\nWe understand the booking for ${impact.event.name} may be cancelled. Could you tell us what your terms say about this, and whether any refund or alternative date applies?\n\nThe organizing team`,
    },
    ...top.slice(0, 1).map((c) => ({
      providerId: c.provider_id,
      bookingId: "",
      purpose: "replacement_venue_availability" as const,
      subject: `Availability for ${impact.event.name}`,
      body: `Hello ${c.name},\n\nWe are looking for a venue for ${impact.event.name} for about ${impact.event.capacity} people. Could you tell us:\n${(guidance?.questionsForReplacementVenue ?? ["Are the event dates free?", "What are your terms?"]).map((q) => `- ${q}`).join("\n")}\n\nThe organizing team`,
    })),
  ];

  const timeline = [
    {
      label: "Decide how to proceed",
      date: at(3),
      note: "Review the options and the replies received.",
    },
    { label: "Providers reconfirm", date: at(7), note: "Services respond under their own terms." },
    {
      label: "Send confirmed venue details to attendees",
      date: at(10),
      note: "Only after the new venue answers in writing.",
    },
  ];

  return {
    summary: `The venue booking with ${impact.venue.provider_name} is treated as cancelled in this practice scenario. ${impact.affected_tasks.length} task(s) and ${impact.services.length} service arrangement(s) may be affected. Nothing has been changed yet.`,
    options,
    recommendedOptionKey: options[0].key,
    timeline,
    taskChanges,
    newTasks,
    reviewNotes: [],
    providerInquiries: inquiries,
    attendeeUpdate: {
      subject: "An update about {{event_name}}",
      body: "Hello {{name}},\n\nWe are looking at our venue arrangements for {{event_name}} and may need to change the location. We will tell you the confirmed details as soon as we have them. You don't need to do anything right now.\n\nThe organizing team",
    },
    unresolvedQuestions: [
      "Is any replacement venue free on the event dates? This is unknown until it answers.",
      "Do the service providers' terms allow a change of location?",
      "Do permits and access arrangements carry over to a different venue?",
    ],
    risks: [
      "No replacement venue may be available for the event dates.",
      "Costs may change; only recorded quotes are known.",
    ],
  };
}

// ------------------------------------------------------------------------------------------------
// Labels
// ------------------------------------------------------------------------------------------------

export const INCIDENT_LABELS = {
  reported: "Reported",
  assessing: "Assessing",
  replan_proposed: "Recovery proposed",
  resolved: "Resolved",
  dismissed: "Dismissed",
} as const;
export const PLAN_LABELS = {
  proposed: "Proposed",
  approved: "Applied",
  partially_approved: "Partly applied",
  rejected: "Rejected",
  superseded: "Replaced",
} as const;
export const INQUIRY_LABELS = {
  draft: "Draft",
  awaiting_approval: "Awaiting approval",
  approved: "Approved, not recorded yet",
  sent_simulated: "Recorded as sent (simulated, nobody contacted)",
  cancelled: "Cancelled",
} as const;
export const PURPOSE_LABELS = {
  venue_cancellation_terms: "Terms of the cancelled venue",
  replacement_venue_availability: "Replacement venue availability",
  service_reconfirmation: "Service reconfirmation",
} as const;
export const CHANGE_LABELS = {
  reschedule_task: "Move a task's due date",
  add_task: "Add a task",
  flag_review: "Mark for review",
} as const;
export const FLAG_LABELS = {
  review: "Review",
  reconfirm: "Reconfirm with the provider",
  reassess: "Reassess",
} as const;
