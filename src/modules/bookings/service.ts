import "server-only";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";
import { requireEventManager } from "@/modules/events/service";
import * as events from "@/modules/events/repo";
import * as providers from "@/modules/profiles/providers-repo";
import { requireMember } from "@/modules/profiles/service";
import * as repo from "./repo";
import { sortForComparison } from "./rules";
import type { QuoteInput, ServiceRequestInput, ServiceRequestStatus } from "./schemas";

/**
 * Service requests and quotes. Two sides, each checked from the verified session:
 *  - organizer side: owner/organizer of the request's event (viewers excluded);
 *  - provider side: a member of the invited provider.
 * The RPCs and RLS policies enforce the same rules again (event.md §15).
 */

async function requireProviderMember(providerId: string) {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const role = await providers.getMemberRole(db, providerId, user.id);
  if (!role) throw new AppError("forbidden", "You're not a member of this provider.");
  return db;
}

export async function eventTimezone(eventId: string): Promise<string> {
  await requireEventManager(eventId);
  const event = await events.getEvent(await createSupabaseServerClient(), eventId);
  if (!event) throw new AppError("not_found", "Event not found.");
  return event.timezone;
}

export async function requestTimezone(requestId: string): Promise<string> {
  await requireMember();
  const request = await repo.getRequest(await createSupabaseServerClient(), requestId);
  if (!request) throw new AppError("not_found", "Request not found.");
  return request.timezone;
}

export async function createRequest(input: ServiceRequestInput): Promise<string> {
  await requireEventManager(input.eventId);
  return repo.createRequest(await createSupabaseServerClient(), input);
}

/** Requests of an event with invite and quote counts (managers only; viewers get an empty list). */
export async function listRequestsForEvent(eventId: string) {
  await requireMember();
  const db = await createSupabaseServerClient();
  const requests = await repo.listRequestsForEvent(db, eventId);
  const ids = requests.map((r) => r.id);
  const [invites, quotes] = await Promise.all([
    repo.listInvites(db, ids),
    repo.listQuotes(db, ids),
  ]);
  return requests.map((r) => ({
    ...r,
    invited: invites.filter((i) => i.request_id === r.id).length,
    quotes: quotes.filter((q) => q.request_id === r.id && q.status === "submitted").length,
  }));
}

/** Organizer view: request, invited providers, received (non-draft) quotes, all threads. */
export async function getRequestForOrganizer(requestId: string) {
  await requireMember();
  const db = await createSupabaseServerClient();
  const request = await repo.getRequest(db, requestId);
  if (!request) notFound();
  try {
    await requireEventManager(request.event_id);
  } catch {
    notFound(); // invited providers can read the request row but must use their own view
  }
  const [invites, quotes, messages] = await Promise.all([
    repo.listInvites(db, [requestId]),
    repo.listQuotes(db, [requestId]),
    repo.listMessages(db, requestId),
  ]);
  return { request, invites, quotes: sortForComparison(quotes), messages };
}

/** Requests addressed to any provider the caller belongs to. */
export async function inboxForProvider() {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const mine = await providers.listMyProviders(db, user.id);
  const rows = await repo.inbox(
    db,
    mine.map((p) => p.id),
  );
  const quotes = await repo.listQuotes(
    db,
    rows.map((r) => r.request_id),
  );
  return rows.map((r) => ({
    ...r,
    quote:
      quotes.find((q) => q.request_id === r.request_id && q.provider_id === r.provider_id) ?? null,
  }));
}

/** Provider view of one request: only this provider's invite, quote and thread. */
export async function getRequestForProvider(requestId: string, providerId: string) {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const role = await providers.getMemberRole(db, providerId, user.id);
  if (!role) notFound();
  const [request, invites, quotes, messages, provider] = await Promise.all([
    repo.getRequest(db, requestId),
    repo.listInvites(db, [requestId]),
    repo.listQuotes(db, [requestId], providerId),
    repo.listMessages(db, requestId, providerId),
    providers.getProvider(db, providerId),
  ]);
  const invite = invites.find((i) => i.provider_id === providerId);
  if (!request || !invite || !provider) notFound();
  return { request, invite, quote: quotes[0] ?? null, messages, provider };
}

export async function postMessage(
  requestId: string,
  providerId: string,
  side: "organizer" | "provider",
  body: string,
) {
  if (side === "provider") {
    await requireProviderMember(providerId);
  } else {
    const request = await repo.getRequest(await createSupabaseServerClient(), requestId);
    if (!request) throw new AppError("not_found", "Request not found.");
    await requireEventManager(request.event_id);
  }
  await repo.postMessage(await createSupabaseServerClient(), requestId, providerId, side, body);
}

export async function declineRequest(requestId: string, providerId: string, reason?: string) {
  await repo.declineRequest(await requireProviderMember(providerId), requestId, providerId, reason);
}

export async function saveQuote(input: QuoteInput) {
  await repo.saveQuote(await requireProviderMember(input.providerId), input);
}

export async function withdrawQuote(quoteId: string) {
  await requireMember();
  const db = await createSupabaseServerClient();
  const quote = await repo.getQuote(db, quoteId);
  if (!quote) throw new AppError("not_found", "Quote not found.");
  await requireProviderMember(quote.provider_id);
  await repo.withdrawQuote(db, quoteId);
}

export async function declineQuote(quoteId: string, reason?: string) {
  await requireMember();
  const db = await createSupabaseServerClient();
  const quote = await repo.getQuote(db, quoteId);
  const request = quote ? await repo.getRequest(db, quote.request_id) : null;
  if (!quote || !request) throw new AppError("not_found", "Quote not found.");
  await requireEventManager(request.event_id);
  await repo.declineQuote(db, quoteId, reason);
}

export async function setRequestStatus(requestId: string, status: ServiceRequestStatus) {
  const db = await createSupabaseServerClient();
  const request = await repo.getRequest(db, requestId);
  if (!request) throw new AppError("not_found", "Request not found.");
  await requireEventManager(request.event_id);
  await repo.setRequestStatus(db, requestId, status);
}
