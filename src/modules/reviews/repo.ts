import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import type { RatingSummary } from "./rules";
import { ReportReason, ReviewDirection } from "./schemas";

export const Candidate = z.object({
  booking_id: z.string(),
  event_id: z.string(),
  event_name: z.string(),
  provider_id: z.string(),
  provider_name: z.string(),
  side: z.enum(["organizer", "provider"]),
  service_to: z.string(),
  eligible: z.boolean(),
  reason: z.string().nullable(),
  review_id: z.string().nullable(),
});
export type Candidate = z.infer<typeof Candidate>;

export const MyReview = z.object({
  id: z.string(),
  booking_id: z.string(),
  event_id: z.string(),
  event_name: z.string(),
  provider_id: z.string(),
  provider_name: z.string(),
  direction: ReviewDirection,
  rating: z.number(),
  body: z.string(),
  status: z.enum(["published", "hidden"]),
  moderation_note: z.string().nullable(),
  created_at: z.string(),
  side: z.enum(["reviewer", "reviewee"]),
  response_body: z.string().nullable(),
  response_at: z.string().nullable(),
  my_report_kinds: z.array(z.enum(["report", "dispute"])),
});
export type MyReview = z.infer<typeof MyReview>;

export const PublicReview = z.object({
  id: z.string(),
  rating: z.number(),
  body: z.string(),
  created_at: z.string(),
  reviewer_name: z.string(),
  verified: z.boolean(),
  response_body: z.string().nullable(),
  response_at: z.string().nullable(),
});
export type PublicReview = z.infer<typeof PublicReview>;

export const OrganizerReview = z.object({
  id: z.string(),
  rating: z.number(),
  body: z.string(),
  created_at: z.string(),
  provider_name: z.string(),
  verified: z.boolean(),
});
export type OrganizerReview = z.infer<typeof OrganizerReview>;

export const ReportRow = z.object({
  id: z.string(),
  review_id: z.string(),
  kind: z.enum(["report", "dispute"]),
  reason: ReportReason,
  details: z.string(),
  status: z.enum(["open", "upheld", "dismissed"]),
  created_at: z.string(),
});
export type ReportRow = z.infer<typeof ReportRow>;

export const AdminReview = z.object({
  id: z.string(),
  provider_id: z.string(),
  direction: ReviewDirection,
  rating: z.number(),
  body: z.string(),
  status: z.enum(["published", "hidden"]),
  moderation_note: z.string().nullable(),
  created_at: z.string(),
});
export type AdminReview = z.infer<typeof AdminReview>;

async function rpc(db: SupabaseServerClient, fn: string, args: Record<string, unknown> = {}) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw fromDbError(error);
  return data as unknown;
}

export const candidates = (db: SupabaseServerClient) =>
  rpc(db, "review_candidates").then((d) => z.array(Candidate).parse(d ?? []));
export const myReviews = (db: SupabaseServerClient) =>
  rpc(db, "my_reviews").then((d) => z.array(MyReview).parse(d ?? []));

const SummaryRow = z.object({
  review_count: z.number(),
  average: z.union([z.null(), z.coerce.number()]),
  stars_1: z.number().optional(),
  stars_2: z.number().optional(),
  stars_3: z.number().optional(),
  stars_4: z.number().optional(),
  stars_5: z.number().optional(),
});
/** `null` = the caller may not see this rating at all (different from "no reviews yet"). */
function toSummary(d: unknown): RatingSummary | null {
  const rows = z.array(SummaryRow).parse(d ?? []);
  const r = rows[0];
  if (!r) return null;
  return {
    count: r.review_count,
    average: r.review_count === 0 ? null : r.average,
    distribution: [r.stars_1 ?? 0, r.stars_2 ?? 0, r.stars_3 ?? 0, r.stars_4 ?? 0, r.stars_5 ?? 0],
  };
}
export const providerSummary = (db: SupabaseServerClient, id: string) =>
  rpc(db, "provider_rating_summary", { p_provider_id: id }).then(toSummary);
export const organizerSummary = (db: SupabaseServerClient, id: string) =>
  rpc(db, "organizer_rating_summary", { p_user_id: id }).then(toSummary);
export const providerReviews = (db: SupabaseServerClient, id: string) =>
  rpc(db, "provider_reviews", { p_provider_id: id }).then((d) =>
    z.array(PublicReview).parse(d ?? []),
  );
export const organizerReviews = (db: SupabaseServerClient, id: string) =>
  rpc(db, "organizer_reviews", { p_user_id: id }).then((d) =>
    z.array(OrganizerReview).parse(d ?? []),
  );

export const createReview = (
  db: SupabaseServerClient,
  p: { bookingId: string; direction: string; rating: number; body: string },
) =>
  rpc(db, "create_review", {
    p_booking_id: p.bookingId,
    p_direction: p.direction,
    p_rating: p.rating,
    p_body: p.body,
  }).then((d) => z.string().parse(d));
export const respond = (db: SupabaseServerClient, id: string, body: string) =>
  rpc(db, "respond_to_review", { p_review_id: id, p_body: body });
export const report = (
  db: SupabaseServerClient,
  p: { id: string; kind: string; reason: string; details: string },
) =>
  rpc(db, "report_review", {
    p_review_id: p.id,
    p_kind: p.kind,
    p_reason: p.reason,
    p_details: p.details,
  });
export const moderate = (db: SupabaseServerClient, id: string, status: string, note: string) =>
  rpc(db, "moderate_review", { p_review_id: id, p_status: status, p_note: note });
export const resolveReport = (
  db: SupabaseServerClient,
  p: { id: string; resolution: string; note: string; hide: boolean },
) =>
  rpc(db, "resolve_review_report", {
    p_report_id: p.id,
    p_resolution: p.resolution,
    p_note: p.note,
    p_hide: p.hide,
  });
export const setProviderReviewsEnabled = (db: SupabaseServerClient, enabled: boolean) =>
  rpc(db, "set_platform_setting", { p_key: "provider_reviews_of_organizers", p_enabled: enabled });

export async function providerReviewsEnabled(db: SupabaseServerClient): Promise<boolean> {
  const { data, error } = await db
    .from("platform_settings")
    .select("enabled")
    .eq("key", "provider_reviews_of_organizers")
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data?.enabled === true;
}

export async function openReports(db: SupabaseServerClient) {
  const { data, error } = await db
    .from("review_reports")
    .select("id, review_id, kind, reason, details, status, created_at")
    .eq("status", "open");
  if (error) throw fromDbError(error);
  return z
    .array(ReportRow)
    .parse(data)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function reviewsByIds(db: SupabaseServerClient, ids: string[]) {
  if (ids.length === 0) return [];
  const { data, error } = await db
    .from("reviews")
    .select("id, provider_id, direction, rating, body, status, moderation_note, created_at")
    .in("id", ids);
  if (error) throw fromDbError(error);
  return z.array(AdminReview).parse(data);
}

export async function recentReviews(db: SupabaseServerClient) {
  const { data, error } = await db
    .from("reviews")
    .select("id, provider_id, direction, rating, body, status, moderation_note, created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw fromDbError(error);
  return z.array(AdminReview).parse(data);
}
