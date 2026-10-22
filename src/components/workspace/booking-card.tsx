import { Badge, type BadgeTone } from "@/components/ui/badge";
import { formatInZone } from "@/lib/dates";
import { BOOKING_LABELS, type BookingStatus } from "@/modules/bookings/booking-rules";
import type { BookingRow } from "@/modules/bookings/booking-repo";
import { formatMoney } from "@/modules/profiles/labels";

const TONE: Record<BookingStatus, BadgeTone> = {
  proposed: "neutral",
  awaiting_organizer_approval: "accent",
  awaiting_provider: "info",
  confirmed: "success",
  declined_by_provider: "neutral",
  cancelled: "neutral",
  completed: "success",
  disputed: "danger",
};

export function BookingStatusBadge({ status }: { status: BookingStatus }) {
  return <Badge tone={TONE[status]}>{BOOKING_LABELS[status]}</Badge>;
}

/** The booked terms (a snapshot of the quote at proposal time). */
export function BookingTerms({ b, timeZone }: { b: BookingRow; timeZone: string }) {
  return (
    <dl className="grid gap-2 text-sm sm:grid-cols-3">
      <div>
        <dt className="text-xs text-ink-muted">Amount (quote rev. {b.quote_revision})</dt>
        <dd>{formatMoney(b.amount, b.currency)}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-muted">Service period</dt>
        <dd>
          {formatInZone(b.service_from, timeZone, { zoneLabel: false })} →{" "}
          {formatInZone(b.service_to, timeZone)}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-ink-muted">Includes</dt>
        <dd className="whitespace-pre-wrap">{b.inclusions}</dd>
      </div>
      {b.conditions && (
        <div className="sm:col-span-3">
          <dt className="text-xs text-ink-muted">Conditions</dt>
          <dd className="whitespace-pre-wrap">{b.conditions}</dd>
        </div>
      )}
      {b.status_reason && (
        <div className="sm:col-span-3">
          <dt className="text-xs text-ink-muted">Last reason</dt>
          <dd>{b.status_reason}</dd>
        </div>
      )}
    </dl>
  );
}
