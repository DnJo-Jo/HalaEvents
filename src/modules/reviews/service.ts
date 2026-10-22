import "server-only";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";
import { requireMember } from "@/modules/profiles/service";
import * as repo from "./repo";
import type { ReviewInput } from "./schemas";

/**
 * Reviews (event.md §24). Eligibility, ownership, duplicates and verification are decided in the
 * database from recorded bookings; this layer only authenticates the caller and maps results.
 * Public ratings come from SQL functions that count published reviews of still-completed bookings.
 */

export async function getReviewsHub() {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const [candidates, reviews, providerReviewsEnabled] = await Promise.all([
    repo.candidates(db),
    repo.myReviews(db),
    repo.providerReviewsEnabled(db),
  ]);
  const organizerRating = await repo.organizerSummary(db, user.id);
  return { candidates, reviews, providerReviewsEnabled, organizerRating };
}

export async function submitReview(input: ReviewInput) {
  await requireMember();
  const db = await createSupabaseServerClient();
  await repo.createReview(db, input);
}

export async function respondToReview(reviewId: string, body: string) {
  await requireMember();
  await repo.respond(await createSupabaseServerClient(), reviewId, body);
}

export async function reportReview(
  reviewId: string,
  input: { kind: "report" | "dispute"; reason: string; details: string },
) {
  await requireMember();
  await repo.report(await createSupabaseServerClient(), { id: reviewId, ...input });
}

/** Public rating + reviews of a provider; `null` when the caller may not see this provider's reviews. */
export async function getProviderRatings(providerId: string) {
  await requireMember();
  const db = await createSupabaseServerClient();
  const [summary, reviews] = await Promise.all([
    repo.providerSummary(db, providerId),
    repo.providerReviews(db, providerId),
  ]);
  return summary ? { summary, reviews } : null;
}

async function requireAdmin() {
  const { isAdmin } = await requireMember();
  if (!isAdmin) throw new AppError("forbidden", "Only platform admins can moderate reviews.");
}

export async function getModerationView() {
  await requireAdmin();
  const db = await createSupabaseServerClient();
  const [reports, recent, enabled] = await Promise.all([
    repo.openReports(db),
    repo.recentReviews(db),
    repo.providerReviewsEnabled(db),
  ]);
  const reported = await repo.reviewsByIds(db, [...new Set(reports.map((r) => r.review_id))]);
  return { reports, reported: new Map(reported.map((r) => [r.id, r])), recent, enabled };
}

export async function moderateReview(
  reviewId: string,
  status: "published" | "hidden",
  note: string,
) {
  await requireAdmin();
  await repo.moderate(await createSupabaseServerClient(), reviewId, status, note);
}

export async function resolveReviewReport(
  reportId: string,
  input: { resolution: "upheld" | "dismissed"; note: string; hide: boolean },
) {
  await requireAdmin();
  await repo.resolveReport(await createSupabaseServerClient(), { id: reportId, ...input });
}

export async function setProviderReviews(enabled: boolean) {
  await requireAdmin();
  await repo.setProviderReviewsEnabled(await createSupabaseServerClient(), enabled);
}
