import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import { ProviderCategory } from "@/modules/profiles/schemas";
import {
  InviteStatus,
  MessageSide,
  QuoteStatus,
  ServiceRequestStatus,
  type QuoteInput,
  type ServiceRequestInput,
} from "./schemas";

const money = z.union([z.null(), z.coerce.number()]);

export const RequestRow = z.object({
  id: z.string(),
  event_id: z.string(),
  event_name: z.string(),
  event_city: z.string().nullable(),
  timezone: z.string(),
  category: ProviderCategory,
  title: z.string(),
  requirements: z.string(),
  needed_from: z.string(),
  needed_to: z.string(),
  expected_attendance: z.number(),
  budget_max: money,
  currency: z.string(),
  respond_by: z.string().nullable(),
  status: ServiceRequestStatus,
  created_at: z.string(),
});
export type RequestRow = z.infer<typeof RequestRow>;
const REQUEST_COLUMNS = Object.keys(RequestRow.shape).join(", ");

export const InviteRow = z.object({
  request_id: z.string(),
  provider_id: z.string(),
  status: InviteStatus,
  decline_reason: z.string().nullable(),
  invited_at: z.string(),
  responded_at: z.string().nullable(),
  providers: z
    .object({ name: z.string(), category: ProviderCategory, is_demo: z.boolean() })
    .nullable(),
});
export type InviteRow = z.infer<typeof InviteRow>;

export const QuoteRow = z.object({
  id: z.string(),
  request_id: z.string(),
  provider_id: z.string(),
  amount: z.coerce.number(),
  currency: z.string(),
  inclusions: z.string(),
  exclusions: z.string().nullable(),
  conditions: z.string().nullable(),
  valid_until: z.string(),
  status: QuoteStatus,
  revision: z.number(),
  submitted_at: z.string().nullable(),
  decline_reason: z.string().nullable(),
  updated_at: z.string(),
});
export type QuoteRow = z.infer<typeof QuoteRow>;
const QUOTE_COLUMNS = Object.keys(QuoteRow.shape).join(", ");

export const MessageRow = z.object({
  id: z.string(),
  provider_id: z.string(),
  author_side: MessageSide,
  body: z.string(),
  created_at: z.string(),
});
export type MessageRow = z.infer<typeof MessageRow>;

const fail = (error: { code?: string; message?: string } | null) => {
  if (error) throw fromDbError(error);
};

export async function createRequest(
  db: SupabaseServerClient,
  r: ServiceRequestInput,
): Promise<string> {
  const { data, error } = await db.rpc("create_service_request", {
    p_event_id: r.eventId,
    p_category: r.category,
    p_title: r.title,
    p_requirements: r.requirements,
    p_needed_from: r.neededFrom,
    p_needed_to: r.neededTo,
    p_expected_attendance: r.expectedAttendance,
    p_budget_max: r.budgetMax ?? null,
    p_currency: r.currency,
    p_respond_by: r.respondBy ?? null,
    p_provider_ids: r.providerIds,
  });
  fail(error);
  return z.string().parse(data);
}

export async function getRequest(db: SupabaseServerClient, id: string): Promise<RequestRow | null> {
  const { data, error } = await db
    .from("service_requests")
    .select(REQUEST_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  fail(error);
  return data ? RequestRow.parse(data) : null;
}

export async function listRequestsForEvent(
  db: SupabaseServerClient,
  eventId: string,
): Promise<RequestRow[]> {
  const { data, error } = await db
    .from("service_requests")
    .select(REQUEST_COLUMNS)
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });
  fail(error);
  return z.array(RequestRow).parse(data);
}

export async function listInvites(
  db: SupabaseServerClient,
  requestIds: string[],
): Promise<InviteRow[]> {
  if (requestIds.length === 0) return [];
  const { data, error } = await db
    .from("service_request_invites")
    .select(
      "request_id, provider_id, status, decline_reason, invited_at, responded_at, providers (name, category, is_demo)",
    )
    .in("request_id", requestIds)
    .order("invited_at");
  fail(error);
  return z.array(InviteRow).parse(data);
}

/** RLS limits this to the caller's own quotes (provider) or non-draft quotes (organizer). */
export async function listQuotes(
  db: SupabaseServerClient,
  requestIds: string[],
  providerId?: string,
): Promise<QuoteRow[]> {
  if (requestIds.length === 0) return [];
  let q = db.from("quotes").select(QUOTE_COLUMNS).in("request_id", requestIds);
  if (providerId) q = q.eq("provider_id", providerId);
  const { data, error } = await q;
  fail(error);
  return z.array(QuoteRow).parse(data);
}

export async function listMessages(
  db: SupabaseServerClient,
  requestId: string,
  providerId?: string,
): Promise<MessageRow[]> {
  let q = db
    .from("service_request_messages")
    .select("id, provider_id, author_side, body, created_at")
    .eq("request_id", requestId);
  if (providerId) q = q.eq("provider_id", providerId);
  const { data, error } = await q.order("created_at");
  fail(error);
  return z.array(MessageRow).parse(data);
}

export const InboxRow = InviteRow.extend({ service_requests: RequestRow });
export type InboxRow = z.infer<typeof InboxRow>;

export async function inbox(db: SupabaseServerClient, providerIds: string[]): Promise<InboxRow[]> {
  if (providerIds.length === 0) return [];
  const { data, error } = await db
    .from("service_request_invites")
    .select(
      `request_id, provider_id, status, decline_reason, invited_at, responded_at,
       providers (name, category, is_demo), service_requests (${REQUEST_COLUMNS})`,
    )
    .in("provider_id", providerIds)
    .order("invited_at", { ascending: false });
  fail(error);
  return z.array(InboxRow).parse(data);
}

export async function postMessage(
  db: SupabaseServerClient,
  requestId: string,
  providerId: string,
  side: string,
  body: string,
) {
  const { error } = await db.rpc("post_request_message", {
    p_request_id: requestId,
    p_provider_id: providerId,
    p_side: side,
    p_body: body,
  });
  fail(error);
}

export async function declineRequest(
  db: SupabaseServerClient,
  requestId: string,
  providerId: string,
  reason?: string,
) {
  const { error } = await db.rpc("decline_service_request", {
    p_request_id: requestId,
    p_provider_id: providerId,
    p_reason: reason ?? null,
  });
  fail(error);
}

export async function saveQuote(db: SupabaseServerClient, q: QuoteInput) {
  const { error } = await db.rpc("save_quote", {
    p_request_id: q.requestId,
    p_provider_id: q.providerId,
    p_amount: q.amount,
    p_currency: q.currency,
    p_inclusions: q.inclusions,
    p_exclusions: q.exclusions ?? null,
    p_conditions: q.conditions ?? null,
    p_valid_until: q.validUntil,
    p_submit: q.intent === "submit",
  });
  fail(error);
}

export async function withdrawQuote(db: SupabaseServerClient, quoteId: string) {
  const { error } = await db.rpc("withdraw_quote", { p_quote_id: quoteId });
  fail(error);
}

export async function declineQuote(db: SupabaseServerClient, quoteId: string, reason?: string) {
  const { error } = await db.rpc("decline_quote", {
    p_quote_id: quoteId,
    p_reason: reason ?? null,
  });
  fail(error);
}

export async function setRequestStatus(
  db: SupabaseServerClient,
  requestId: string,
  status: string,
) {
  const { error } = await db.rpc("set_service_request_status", {
    p_request_id: requestId,
    p_status: status,
  });
  fail(error);
}

export async function getQuote(
  db: SupabaseServerClient,
  quoteId: string,
): Promise<QuoteRow | null> {
  const { data, error } = await db
    .from("quotes")
    .select(QUOTE_COLUMNS)
    .eq("id", quoteId)
    .maybeSingle();
  fail(error);
  return data ? QuoteRow.parse(data) : null;
}
