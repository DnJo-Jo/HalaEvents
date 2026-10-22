import "server-only";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";
import * as repo from "./providers-repo";
import { requiredRoleForProviderKind } from "./rules";
import type {
  DocumentInput,
  ProviderProfileInput,
  ServiceInput,
  VenueProfileInput,
} from "./schemas";
import { requireMember } from "./service";

/**
 * Provider onboarding and listing management. Every function resolves the member from the
 * verified session and checks provider membership before writing; RLS and the RPCs re-check.
 */

export async function listMyProviders() {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  return repo.listMyProviders(db, user.id);
}

/** Loads a provider the caller belongs to (any role), or 404 — never reveals other providers. */
export async function getManagedProvider(providerId: string) {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const role = await repo.getMemberRole(db, providerId, user.id);
  const provider = role ? await repo.getProvider(db, providerId) : null;
  if (!role || !provider) notFound();
  const [privateDetails, venue, services, documents] = await Promise.all([
    repo.getProviderPrivate(db, providerId),
    provider.kind === "venue" ? repo.getVenue(db, providerId) : Promise.resolve(null),
    repo.listServices(db, providerId),
    repo.listDocuments(db, providerId),
  ]);
  return { provider, role, privateDetails, venue, services, documents };
}

async function requireOwner(providerId: string) {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const role = await repo.getMemberRole(db, providerId, user.id);
  if (role !== "owner")
    throw new AppError("forbidden", "Only the provider's owner can change this.");
  return db;
}

export async function createProvider(input: ProviderProfileInput): Promise<string> {
  const { roles } = await requireMember();
  const needed = requiredRoleForProviderKind(input.kind);
  if (!roles.includes(needed)) {
    throw new AppError(
      "forbidden",
      input.kind === "venue"
        ? "Add the “Venue provider” role in Settings first."
        : "Add the “Service provider” role in Settings first.",
    );
  }
  const db = await createSupabaseServerClient();
  return repo.createProvider(db, input);
}

export async function updateProvider(providerId: string, input: ProviderProfileInput) {
  const db = await requireOwner(providerId);
  const current = await repo.getProvider(db, providerId);
  if (!current) throw new AppError("not_found", "Provider not found.");
  if (current.kind !== input.kind)
    throw new AppError("validation_failed", "The listing type can't be changed.");
  await repo.updateProvider(db, providerId, input);
}

export async function setListed(providerId: string, listed: boolean) {
  await repo.setListed(await requireOwner(providerId), providerId, listed);
}

export async function saveVenue(providerId: string, input: VenueProfileInput) {
  await repo.upsertVenue(await requireOwner(providerId), providerId, input);
}

export async function addService(providerId: string, input: ServiceInput) {
  await repo.createService(await requireOwner(providerId), providerId, input);
}

export async function setServiceActive(providerId: string, serviceId: string, active: boolean) {
  await repo.setServiceActive(await requireOwner(providerId), providerId, serviceId, active);
}

export async function deleteService(providerId: string, serviceId: string) {
  await repo.deleteService(await requireOwner(providerId), providerId, serviceId);
}

export async function addDocument(providerId: string, input: DocumentInput) {
  await repo.createDocument(await requireOwner(providerId), providerId, input);
}

export async function deleteDocument(providerId: string, documentId: string) {
  await repo.deleteDocument(await requireOwner(providerId), providerId, documentId);
}

export async function submitForVerification(providerId: string) {
  await repo.submitForVerification(await requireOwner(providerId), providerId);
}

// ---- Admin ------------------------------------------------------------------------------------

export async function requireAdmin() {
  const ctx = await requireMember();
  if (!ctx.isAdmin) notFound(); // don't reveal that admin pages exist
  return ctx;
}

export async function listForReview(filter: Parameters<typeof repo.listForReview>[1]) {
  await requireAdmin();
  return repo.listForReview(await createSupabaseServerClient(), filter);
}

export async function getProviderForAdmin(providerId: string) {
  await requireAdmin();
  const db = await createSupabaseServerClient();
  const provider = await repo.getProvider(db, providerId);
  if (!provider) notFound();
  const [privateDetails, venue, services, documents] = await Promise.all([
    repo.getProviderPrivate(db, providerId),
    provider.kind === "venue" ? repo.getVenue(db, providerId) : Promise.resolve(null),
    repo.listServices(db, providerId),
    repo.listDocuments(db, providerId),
  ]);
  return { provider, privateDetails, venue, services, documents };
}

export async function decideVerification(
  providerId: string,
  decision: "verified" | "rejected",
  note?: string,
) {
  await requireAdmin();
  await repo.setVerification(await createSupabaseServerClient(), providerId, decision, note);
}

export async function moderate(providerId: string, status: string, reason?: string) {
  await requireAdmin();
  await repo.setModeration(await createSupabaseServerClient(), providerId, status, reason);
}

export async function reviewDocument(
  documentId: string,
  decision: "accepted" | "rejected",
  note?: string,
) {
  await requireAdmin();
  await repo.reviewDocument(await createSupabaseServerClient(), documentId, decision, note);
}
