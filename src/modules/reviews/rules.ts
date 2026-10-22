/** Review rules and wording (event.md §24). Pure. */
export const ELIGIBILITY_REASONS: Record<string, string> = {
  not_completed: "Only a completed booking can be reviewed.",
  duplicate: "You have already reviewed this booking.",
  disabled: "Providers can't review organizers on this platform yet.",
  conflict_of_interest: "You are on both sides of this booking.",
  not_authorized: "You can't review this booking.",
  not_found: "That booking doesn't exist.",
  unauthenticated: "Please sign in.",
  invalid_direction: "That kind of review doesn't exist.",
};

export const REASON_LABELS = {
  inaccurate: "Inaccurate",
  abusive: "Abusive or offensive",
  spam: "Spam",
  conflict_of_interest: "Conflict of interest",
  other: "Other",
} as const;

export interface RatingSummary {
  count: number;
  average: number | null;
  distribution: [number, number, number, number, number];
}

/** What to show for a summary: never "0.0 stars" for a history that is empty. */
export function describeRating(s: Pick<RatingSummary, "count" | "average">): string {
  if (s.count === 0 || s.average === null) return "No reviews yet";
  return `${s.average.toFixed(1)} out of 5 · ${s.count} review${s.count === 1 ? "" : "s"}`;
}

export function stars(rating: number): string {
  const n = Math.max(0, Math.min(5, Math.round(rating)));
  return "★".repeat(n) + "☆".repeat(5 - n);
}
