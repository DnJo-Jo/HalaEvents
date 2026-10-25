import { createHash } from "node:crypto";
import type { VendorCategory } from "@/modules/vendors/schemas";

/**
 * Pure rules for vendor quotation emails. Facts come from the event; nothing here invents a
 * price, availability, contact detail or confirmation.
 */

export interface EmailFacts {
  eventName: string;
  eventTypeLabel: string;
  /** "12 Nov 2026" or "12–13 Nov 2026"; always set (events have dates). */
  dateText: string;
  timeZone: string;
  /** City the organizer entered, or null. */
  city: string | null;
  attendees: number;
  /** Answered interview questions relevant to this category, as "label: answer". */
  requirements: string[];
  /** Plan requirements that mention this category. */
  planNotes: string[];
  additionalDetails: string | null;
  category: VendorCategory;
  vendorName: string | null;
  /** Vendor's address as found by the search, if any. */
  vendorAddress: string | null;
  organizerName: string | null;
  reference: string;
}

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/**
 * `HE-` + 8 hex characters derived from the event and vendor/category. Stable (so replies can be
 * matched later by recomputing it), but it doesn't reveal the event id or anything else.
 */
export function emailReference(
  eventId: string,
  category: VendorCategory,
  placeId?: string,
): string {
  const h = createHash("sha256")
    .update(`halaevents:${eventId}:${category}:${placeId ?? ""}`)
    .digest("hex");
  return `HE-${h.slice(0, 8).toUpperCase()}`;
}

const SUBJECT_TOPIC: Record<VendorCategory, string> = {
  venue: "Venue enquiry",
  catering: "Catering quotation request",
  transport: "Transportation quotation request",
};

export function emailSubject(f: Pick<EmailFacts, "eventName" | "category" | "reference">): string {
  return `${SUBJECT_TOPIC[f.category]}: ${clip(oneLine(f.eventName), 80)} [${f.reference}]`;
}

/** Keywords that make an interview question or plan requirement relevant to a service. */
export const CATEGORY_KEYWORDS: Record<VendorCategory, RegExp> = {
  venue:
    /venue|space|room|hall|stage|av\b|audio|projector|power|wifi|accessib|seating|parking|facilit|equipment|load.?in/i,
  catering:
    /cater|food|meal|drink|diet|allerg|halal|vegetarian|vegan|menu|refreshment|coffee|snack|lunch|dinner/i,
  transport: /transport|shuttle|bus|coach|vehicle|pickup|pick-up|parking|travel|airport|route/i,
};

const ASKS: Record<VendorCategory, string[]> = {
  catering: [
    "availability on the event date",
    "menu options and any set packages",
    "dietary accommodations (for example halal, vegetarian, allergies)",
    "delivery or on-site service arrangements and staffing",
    "an estimated price, including what it covers",
  ],
  venue: [
    "availability on the event date",
    "capacity for our expected number of attendees",
    "facilities and equipment included (AV, seating, power, accessibility)",
    "rental cost and what it covers, including any deposit or additional fees",
  ],
  transport: [
    "vehicle availability on the event date",
    "passenger capacity and how many vehicles our group would need",
    "routes and pickup/drop-off arrangements",
    "pricing and what it covers",
  ],
};

const SERVICE_NOUN: Record<VendorCategory, string> = {
  venue: "venue",
  catering: "catering",
  transport: "transportation",
};

export function greeting(f: Pick<EmailFacts, "vendorName">): string {
  return f.vendorName ? `Hello ${clip(oneLine(f.vendorName), 80)} team,` : "Hello,";
}

export function signOff(f: Pick<EmailFacts, "organizerName" | "eventName">): string {
  const name = f.organizerName ? oneLine(f.organizerName) : "[Your name]";
  return `Kind regards,\n${name}\n${clip(oneLine(f.eventName), 80)}`;
}

/** The facts the email states, one per line; unknown ones are left out, never guessed. */
export function factLines(f: EmailFacts): string[] {
  return [
    `Event: ${f.eventName} (${f.eventTypeLabel})`,
    `Date: ${f.dateText} (${f.timeZone})`,
    f.city ? `Location: ${f.city}` : null,
    `Expected attendees: ${f.attendees}`,
    ...f.requirements.map((r) => `- ${r}`),
  ].filter((l): l is string => l !== null);
}

/** Deterministic quotation request; used directly for "template" and as the failure fallback. */
export function templateBody(f: EmailFacts): string {
  const noun = SERVICE_NOUN[f.category];
  const intro = f.vendorName
    ? `I'm organising ${f.eventName} and I'd like to ask about ${noun} services from ${f.vendorName}. Could you please send a quotation?`
    : `I'm organising ${f.eventName} and I'm looking for ${noun} services. Could you please send a quotation?`;
  const asks = ASKS[f.category].map((a) => `- ${a}`).join("\n");
  return [
    intro,
    "",
    "Event details:",
    ...factLines(f).map((l) => (l.startsWith("- ") ? `  ${l}` : l)),
    "",
    "Could you let us know:",
    asks,
    "",
    "Thank you, and I look forward to your reply.",
  ].join("\n");
}

/** Whole email text: greeting + body + sign-off. */
export function assembleBody(f: EmailFacts, middle: string): string {
  return [greeting(f), "", middle.trim(), "", signOff(f)].join("\n");
}

const URL_LIKE = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\./i;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const PHONE_LIKE = /(?:\d[\s().-]*){9,}/; // 9+ digits: ISO dates (8) and ranges like “120 – 150” pass
const CONFIRMED =
  /\b(confirm(ed|ing)? (the |our )?(booking|reservation)|we have booked|payment (has been|was) made|deposit (has been|was) paid)\b/i;

/**
 * Problems with a model-written body; any problem rejects it (the template is used instead).
 * The email may only contain facts we gave it, so contact details and invented commitments fail.
 */
export function bodyProblems(body: string, f: Pick<EmailFacts, "vendorName">): string[] {
  const out: string[] = [];
  if (URL_LIKE.test(body)) out.push("url");
  if (EMAIL_LIKE.test(body)) out.push("email");
  if (PHONE_LIKE.test(body)) out.push("phone");
  if (CONFIRMED.test(body)) out.push("confirmation");
  if (/[{}<>]|\[[^\]]*\]/.test(body)) out.push("placeholder");
  if (f.vendorName === null && /^\s*(hello|dear|hi)\b/i.test(body)) out.push("greeting");
  return out;
}
