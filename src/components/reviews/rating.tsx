import { Badge } from "@/components/ui/badge";
import { describeRating, stars, type RatingSummary } from "@/modules/reviews/rules";

/** Average and distribution. An empty history says so instead of showing a zero rating. */
export function RatingSummaryView({ summary }: { summary: RatingSummary }) {
  if (summary.count === 0 || summary.average === null) {
    return <p className="text-sm text-ink-muted">No reviews yet</p>;
  }
  return (
    <div className="space-y-1 text-sm">
      <p className="font-medium">
        <span aria-hidden="true">{stars(summary.average)}</span>{" "}
        <span>{describeRating(summary)}</span>
      </p>
      <ul className="text-xs text-ink-muted">
        {[5, 4, 3, 2, 1].map((n) => (
          <li key={n}>
            {n} star{n === 1 ? "" : "s"}: {summary.distribution[n - 1]}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Stars({ rating }: { rating: number }) {
  return (
    <span aria-label={`${rating} out of 5`} role="img">
      {stars(rating)}
    </span>
  );
}

export function VerifiedBadge() {
  return (
    <Badge
      tone="success"
      title="Based on a completed booking recorded on HalaEvents between this organizer and provider"
    >
      Verified booking
    </Badge>
  );
}
