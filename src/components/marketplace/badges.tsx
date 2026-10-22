import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/dates";
import { indicativePrice } from "@/modules/profiles/labels";
import type { ProviderRow } from "@/modules/profiles/providers-repo";

type ListingState = Pick<
  ProviderRow,
  "verification_status" | "moderation_status" | "is_listed" | "is_demo" | "verified_at"
>;

/** Verification label. "Verified" means a platform admin reviewed the business — nothing more. */
export function VerificationBadge({ p }: { p: ListingState }) {
  switch (p.verification_status) {
    case "verified":
      return (
        <Badge tone="success" title="Business details reviewed by the HalaEvents team">
          Verified{p.verified_at ? ` · ${formatDate(p.verified_at)}` : ""}
        </Badge>
      );
    case "submitted":
      return <Badge tone="info">Awaiting review</Badge>;
    case "rejected":
      return <Badge tone="danger">Not approved</Badge>;
    default:
      return <Badge tone="neutral">Draft — not submitted</Badge>;
  }
}

export function ListingBadges({
  p,
  showVerification = true,
}: {
  p: ListingState;
  showVerification?: boolean;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {showVerification && <VerificationBadge p={p} />}
      {p.is_demo && (
        <Badge tone="accent" title="Fictional sample listing for local development">
          Demo listing
        </Badge>
      )}
      {p.moderation_status === "hidden" && <Badge tone="warning">Hidden by moderators</Badge>}
      {p.moderation_status === "suspended" && <Badge tone="danger">Suspended</Badge>}
      {!p.is_listed && <Badge tone="neutral">Paused by owner</Badge>}
    </span>
  );
}

export function PriceLabel({
  model,
  min,
  max,
  currency,
}: {
  model: ProviderRow["pricing_model"];
  min: number | null;
  max: number | null;
  currency: string;
}) {
  return (
    <span
      className="text-sm text-ink"
      title="Indicative only. The actual price comes from a quote."
    >
      {indicativePrice(model, min, max, currency)}
    </span>
  );
}

export function CapacityLabel({ min, max }: { min: number | null; max: number | null }) {
  if (min === null && max === null) return null;
  const text =
    min !== null && max !== null
      ? `${min}–${max} guests`
      : min !== null
        ? `from ${min} guests`
        : `up to ${max} guests`;
  return <span className="text-sm text-ink-muted">{text}</span>;
}
