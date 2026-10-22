import { Badge, type BadgeTone } from "@/components/ui/badge";
import type { QuoteDisplayStatus } from "@/modules/bookings/rules";
import type { InviteStatus, ServiceRequestStatus } from "@/modules/bookings/schemas";
import type { EventStatus } from "@/modules/events/schemas";

const EVENT: Record<EventStatus, [string, BadgeTone]> = {
  draft: ["Draft", "neutral"],
  planning: ["Planning", "info"],
  ready: ["Ready", "primary"],
  live: ["Live", "success"],
  completed: ["Completed", "neutral"],
  archived: ["Archived", "neutral"],
  cancelled: ["Cancelled", "danger"],
};
export function EventStatusBadge({ status }: { status: EventStatus }) {
  const [label, tone] = EVENT[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const REQUEST: Record<ServiceRequestStatus, [string, BadgeTone]> = {
  open: ["Open for quotes", "success"],
  closed: ["Closed to new quotes", "neutral"],
  cancelled: ["Cancelled", "danger"],
};
export function RequestStatusBadge({ status }: { status: ServiceRequestStatus }) {
  const [label, tone] = REQUEST[status];
  return <Badge tone={tone}>{label}</Badge>;
}

const QUOTE: Record<QuoteDisplayStatus, [string, BadgeTone]> = {
  draft: ["Draft (not sent)", "neutral"],
  submitted: ["Quote received", "primary"],
  withdrawn: ["Withdrawn", "neutral"],
  declined: ["Declined", "danger"],
  expired: ["Expired", "warning"],
};
export function QuoteStatusBadge({ status }: { status: QuoteDisplayStatus }) {
  const [label, tone] = QUOTE[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export function InviteStatusBadge({ status, quoted }: { status: InviteStatus; quoted?: boolean }) {
  if (status === "declined") return <Badge tone="danger">Declined</Badge>;
  return quoted ? (
    <Badge tone="primary">Quoted</Badge>
  ) : (
    <Badge tone="neutral">Awaiting response</Badge>
  );
}
