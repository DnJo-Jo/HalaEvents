import "server-only";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/db/server";
import { parseServerEnv } from "@/lib/env.server";
import { AppError } from "@/lib/errors";
import {
  geocode,
  GeoapifyError,
  searchPlaces,
  type GeoPoint,
  type VendorCandidate,
} from "@/lib/integrations/geoapify";
import * as eventsRepo from "@/modules/events/repo";
import { interviewEditable } from "@/modules/events/interview-rules";
import { requireMember } from "@/modules/profiles/service";
import * as repo from "./repo";
import {
  SearchInput,
  ServicesInput,
  ShortlistInput,
  VendorNoteInput,
  VendorRefInput,
} from "./schemas";

type FieldErrors = { ok: false; fieldErrors: Record<string, string[]> };
const invalid = (e: z.ZodError): FieldErrors => ({
  ok: false,
  fieldErrors: z.flattenError(e).fieldErrors as Record<string, string[]>,
});

async function load(eventId: string, edit: boolean) {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const [event, role] = await Promise.all([
    eventsRepo.getEvent(db, eventId),
    eventsRepo.getRole(db, eventId, user.id),
  ]);
  if (!event || !role)
    throw new AppError("not_found", "That event doesn't exist or isn't visible to you.");
  const canManage = role === "owner" || role === "organizer";
  if (edit && !canManage)
    throw new AppError("forbidden", "Only the event's owner or organizers can do this.");
  return { db, event, canManage };
}

/** Event + shortlist for the services and vendors pages. */
export async function getVendorsView(eventId: string) {
  const { db, event, canManage } = await load(eventId, false);
  const shortlist = await repo.listShortlist(db, eventId);
  return { event, canManage, canEdit: canManage && interviewEditable(event.status), shortlist };
}

/** Saves which services the event needs. Makes no provider or AI request. */
export async function saveServices(
  eventId: string,
  raw: unknown,
): Promise<{ ok: true } | FieldErrors> {
  const parsed = ServicesInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const { db, event } = await load(eventId, true);
  if (!interviewEditable(event.status))
    throw new AppError(
      "conflict",
      `This event is ${event.status}, so its services can't be changed.`,
    );
  await repo.saveServices(db, eventId, parsed.data.services);
  return { ok: true };
}

export type SearchResult =
  | { ok: true; category: string; location: GeoPoint; vendors: VendorCandidate[] }
  | { ok: false; message: string }
  | FieldErrors;

const PROVIDER_MESSAGES: Record<string, string> = {
  not_configured: "Vendor search isn't set up yet.",
  auth_failed: "Vendor search isn't available right now.",
  rate_limited: "Vendor search is busy. Try again in a little while.",
  timeout: "The vendor search took too long. Try again.",
  failed: "The vendor search failed. Try again.",
};

/** Runs one Geoapify geocode + places search for a selected service. Only on an explicit click. */
export async function searchVendors(
  eventId: string,
  raw: unknown,
  fetchImpl: typeof fetch = fetch,
): Promise<SearchResult> {
  const parsed = SearchInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const { event } = await load(eventId, true);
  if (!event.services.includes(parsed.data.category))
    return { ok: false, message: "Select this service for the event first." };
  const key = parseServerEnv().GEOAPIFY_API_KEY;
  try {
    const where = await geocode(parsed.data.location, key, fetchImpl);
    if (!where) return { ok: false, message: "We couldn't find that location. Try a nearby city." };
    const vendors = await searchPlaces(
      parsed.data.category,
      where,
      parsed.data.radiusKm * 1000,
      key,
      fetchImpl,
    );
    return { ok: true, category: parsed.data.category, location: where, vendors };
  } catch (e) {
    if (e instanceof GeoapifyError) return { ok: false, message: PROVIDER_MESSAGES[e.code] };
    throw e;
  }
}

export async function shortlistVendor(eventId: string, raw: unknown) {
  const parsed = ShortlistInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const { db, event } = await load(eventId, true);
  if (!event.services.includes(parsed.data.category))
    throw new AppError("conflict", "Select this service for the event first.");
  await repo.shortlistVendor(db, eventId, parsed.data);
  return { ok: true as const };
}

export async function removeVendor(eventId: string, raw: unknown) {
  const parsed = VendorRefInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const { db } = await load(eventId, true);
  await repo.removeVendor(db, eventId, parsed.data.category, parsed.data.placeId);
  return { ok: true as const };
}

export async function saveVendorNote(eventId: string, raw: unknown) {
  const parsed = VendorNoteInput.safeParse(raw);
  if (!parsed.success) return invalid(parsed.error);
  const { db } = await load(eventId, true);
  await repo.setVendorNote(
    db,
    eventId,
    parsed.data.category,
    parsed.data.placeId,
    parsed.data.note,
  );
  return { ok: true as const };
}
