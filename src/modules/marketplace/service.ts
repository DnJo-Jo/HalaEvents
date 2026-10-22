import "server-only";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { requireEventManager } from "@/modules/events/service";
import * as providers from "@/modules/profiles/providers-repo";
import { requireMember } from "@/modules/profiles/service";
import * as repo from "./repo";
import type { DirectorySearchInput } from "./schemas";

export async function searchDirectory(filters: DirectorySearchInput) {
  await requireMember();
  return repo.search(await createSupabaseServerClient(), filters);
}

/**
 * A provider's public listing. RLS decides visibility (listed providers, plus your own and those
 * you invited); unlisted/unverified providers you can't see are a 404. Private details and
 * credentials are never loaded here.
 */
export async function getListing(providerId: string) {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const provider = await providers.getProvider(db, providerId);
  if (!provider) notFound();
  const [venue, services, memberRole, shortlistedIn] = await Promise.all([
    provider.kind === "venue" ? providers.getVenue(db, providerId) : Promise.resolve(null),
    providers.listServices(db, providerId),
    providers.getMemberRole(db, providerId, user.id),
    repo.shortlistedEventIds(db, providerId),
  ]);
  return {
    provider,
    venue,
    services: services.filter((s) => s.is_active),
    isOwnListing: memberRole !== null,
    shortlistedIn,
  };
}

export async function listShortlist(eventId: string) {
  await requireMember();
  return repo.listShortlist(await createSupabaseServerClient(), eventId);
}

export async function addToShortlist(eventId: string, providerId: string, note?: string) {
  await requireEventManager(eventId);
  await repo.addToShortlist(await createSupabaseServerClient(), eventId, providerId, note);
}

export async function removeFromShortlist(eventId: string, providerId: string) {
  await requireEventManager(eventId);
  await repo.removeFromShortlist(await createSupabaseServerClient(), eventId, providerId);
}
