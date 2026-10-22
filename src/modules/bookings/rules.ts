import type { QuoteStatus, ServiceRequestStatus } from "./schemas";

/** Mirrors service_request_transition_allowed() (migration 0004); parity tested in tests/db. */
export const SERVICE_REQUEST_TRANSITIONS: Record<
  ServiceRequestStatus,
  readonly ServiceRequestStatus[]
> = {
  open: ["closed", "cancelled"],
  closed: ["open", "cancelled"],
  cancelled: [],
};

export function canTransitionRequest(
  from: ServiceRequestStatus,
  to: ServiceRequestStatus,
): boolean {
  return SERVICE_REQUEST_TRANSITIONS[from].includes(to);
}

/**
 * Quote transitions by actor (mirrors quote_transition_allowed()). Self-transitions on draft and
 * submitted are revisions. There is no "accepted": a quote is not a booking (P10).
 */
export const QUOTE_TRANSITIONS: Record<
  "provider" | "organizer",
  Record<QuoteStatus, readonly QuoteStatus[]>
> = {
  provider: {
    draft: ["draft", "submitted", "withdrawn"],
    submitted: ["submitted", "withdrawn"],
    withdrawn: ["draft", "submitted"],
    declined: [],
  },
  organizer: {
    draft: [],
    submitted: ["declined"],
    withdrawn: [],
    declined: [],
  },
};

export function canTransitionQuote(
  from: QuoteStatus,
  to: QuoteStatus,
  actor: "provider" | "organizer",
): boolean {
  return QUOTE_TRANSITIONS[actor][from].includes(to);
}

/** Expiry is derived from valid_until, never stored, so it can't drift. */
export function isQuoteExpired(validUntil: string, now: Date = new Date()): boolean {
  return Date.parse(validUntil) <= now.getTime();
}

export type QuoteDisplayStatus = QuoteStatus | "expired";

export function quoteDisplayStatus(
  q: { status: QuoteStatus; valid_until: string },
  now: Date = new Date(),
): QuoteDisplayStatus {
  return q.status === "submitted" && isQuoteExpired(q.valid_until, now) ? "expired" : q.status;
}

export interface ComparableQuote {
  id: string;
  amount: number;
  currency: string;
  status: QuoteStatus;
  valid_until: string;
}

/**
 * Orders quotes for the organizer's comparison view: live (submitted, unexpired) first, cheapest
 * first within the same currency; others after. Purely presentational — no quote is chosen.
 */
export function sortForComparison<T extends ComparableQuote>(
  quotes: T[],
  now: Date = new Date(),
): T[] {
  const live = (q: T) => quoteDisplayStatus(q, now) === "submitted";
  return [...quotes].sort((a, b) => {
    if (live(a) !== live(b)) return live(a) ? -1 : 1;
    if (a.currency !== b.currency) return a.currency.localeCompare(b.currency);
    return a.amount - b.amount || a.id.localeCompare(b.id);
  });
}

/** Defaults for the quote form: keep a still-valid date, otherwise propose two weeks from now. */
export function defaultValidUntil(
  currentValidUntil: string | undefined,
  now: Date = new Date(),
): string {
  if (currentValidUntil && Date.parse(currentValidUntil) > now.getTime()) return currentValidUntil;
  return new Date(now.getTime() + 14 * 86_400_000).toISOString();
}
