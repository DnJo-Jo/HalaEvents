import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import {
  DocumentKind,
  DocumentReviewStatus,
  PricingModel,
  ProviderCategory,
  ProviderKind,
  ProviderMemberRole,
  ProviderModerationStatus,
  ProviderVerificationStatus,
  VenueSetting,
  type DocumentInput,
  type ProviderProfileInput,
  type ServiceInput,
  type VenueProfileInput,
} from "./schemas";

const numOrNull = z.union([z.null(), z.coerce.number()]);

export const ProviderRow = z.object({
  id: z.string(),
  kind: ProviderKind,
  category: ProviderCategory,
  name: z.string(),
  description: z.string().nullable(),
  city: z.string().nullable(),
  country: z.string(),
  service_area: z.array(z.string()),
  min_capacity: z.number().nullable(),
  max_capacity: z.number().nullable(),
  price_min: numOrNull,
  price_max: numOrNull,
  currency: z.string(),
  pricing_model: PricingModel,
  capabilities: z.array(z.string()),
  availability_note: z.string().nullable(),
  website: z.string().nullable(),
  is_listed: z.boolean(),
  verification_status: ProviderVerificationStatus,
  verification_note: z.string().nullable(),
  verified_at: z.string().nullable(),
  submitted_at: z.string().nullable(),
  moderation_status: ProviderModerationStatus,
  moderation_reason: z.string().nullable(),
  is_demo: z.boolean(),
  created_at: z.string(),
});
export type ProviderRow = z.infer<typeof ProviderRow>;
export const PROVIDER_COLUMNS = Object.keys(ProviderRow.shape).join(", ");

export const ProviderPrivateRow = z.object({
  legal_name: z.string().nullable(),
  trade_license_number: z.string().nullable(),
  contact_email: z.string().nullable(),
  contact_phone: z.string().nullable(),
});
export type ProviderPrivateRow = z.infer<typeof ProviderPrivateRow>;

export const VenueRow = z.object({
  setting: VenueSetting,
  seated_capacity: z.number().nullable(),
  standing_capacity: z.number().nullable(),
  address_text: z.string().nullable(),
  area: z.string().nullable(),
  access_conditions: z.string().nullable(),
  accessibility: z.array(z.string()),
  suitability: z.array(z.string()),
});
export type VenueRow = z.infer<typeof VenueRow>;

export const ServiceRow = z.object({
  id: z.string(),
  provider_id: z.string(),
  category: ProviderCategory,
  title: z.string(),
  description: z.string().nullable(),
  pricing_model: PricingModel,
  price_from: numOrNull,
  price_to: numOrNull,
  currency: z.string(),
  min_quantity: z.number().nullable(),
  max_quantity: z.number().nullable(),
  inclusions: z.array(z.string()),
  is_active: z.boolean(),
});
export type ServiceRow = z.infer<typeof ServiceRow>;

export const DocumentRow = z.object({
  id: z.string(),
  kind: DocumentKind,
  title: z.string(),
  reference_number: z.string().nullable(),
  issued_by: z.string().nullable(),
  expires_on: z.string().nullable(),
  review_status: DocumentReviewStatus,
  review_note: z.string().nullable(),
  reviewed_at: z.string().nullable(),
});
export type DocumentRow = z.infer<typeof DocumentRow>;

const fail = (error: { code?: string; message?: string } | null) => {
  if (error) throw fromDbError(error);
};

export async function listMyProviders(
  db: SupabaseServerClient,
  userId: string,
): Promise<(ProviderRow & { member_role: z.infer<typeof ProviderMemberRole> })[]> {
  const { data, error } = await db
    .from("provider_members")
    .select(`role, providers (${PROVIDER_COLUMNS})`)
    .eq("user_id", userId);
  fail(error);
  return z
    .array(z.object({ role: ProviderMemberRole, providers: ProviderRow }))
    .parse(data)
    .map((r) => ({ ...r.providers, member_role: r.role }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getMemberRole(
  db: SupabaseServerClient,
  providerId: string,
  userId: string,
): Promise<"owner" | "staff" | null> {
  const { data, error } = await db
    .from("provider_members")
    .select("role")
    .eq("provider_id", providerId)
    .eq("user_id", userId)
    .maybeSingle();
  fail(error);
  return data ? ProviderMemberRole.parse(data.role) : null;
}

export async function getProvider(
  db: SupabaseServerClient,
  id: string,
): Promise<ProviderRow | null> {
  const { data, error } = await db
    .from("providers")
    .select(PROVIDER_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  fail(error);
  return data ? ProviderRow.parse(data) : null;
}

export async function getProviderPrivate(
  db: SupabaseServerClient,
  id: string,
): Promise<ProviderPrivateRow | null> {
  const { data, error } = await db
    .from("provider_private")
    .select("legal_name, trade_license_number, contact_email, contact_phone")
    .eq("provider_id", id)
    .maybeSingle();
  fail(error);
  return data ? ProviderPrivateRow.parse(data) : null;
}

export async function getVenue(db: SupabaseServerClient, id: string): Promise<VenueRow | null> {
  const { data, error } = await db
    .from("venue_profiles")
    .select(
      "setting, seated_capacity, standing_capacity, address_text, area, access_conditions, accessibility, suitability",
    )
    .eq("provider_id", id)
    .maybeSingle();
  fail(error);
  return data ? VenueRow.parse(data) : null;
}

export async function listServices(
  db: SupabaseServerClient,
  providerId: string,
): Promise<ServiceRow[]> {
  const { data, error } = await db
    .from("provider_services")
    .select(Object.keys(ServiceRow.shape).join(", "))
    .eq("provider_id", providerId)
    .order("is_active", { ascending: false })
    .order("title");
  fail(error);
  return z.array(ServiceRow).parse(data);
}

export async function listDocuments(
  db: SupabaseServerClient,
  providerId: string,
): Promise<DocumentRow[]> {
  const { data, error } = await db
    .from("provider_documents")
    .select(Object.keys(DocumentRow.shape).join(", "))
    .eq("provider_id", providerId)
    .order("created_at");
  fail(error);
  return z.array(DocumentRow).parse(data);
}

export async function createProvider(
  db: SupabaseServerClient,
  p: ProviderProfileInput,
): Promise<string> {
  const { data, error } = await db.rpc("create_provider", {
    p_kind: p.kind,
    p_category: p.category,
    p_name: p.name,
    p_description: p.description ?? null,
    p_city: p.city ?? null,
    p_service_area: p.serviceArea,
    p_min_capacity: p.minCapacity ?? null,
    p_max_capacity: p.maxCapacity ?? null,
    p_price_min: p.priceMin ?? null,
    p_price_max: p.priceMax ?? null,
    p_currency: p.currency,
    p_contact_email: p.contactEmail ?? null,
    p_contact_phone: p.contactPhone ?? null,
  });
  fail(error);
  const id = z.string().parse(data);
  await updateProviderExtras(db, id, p);
  return id;
}

async function updateProviderExtras(db: SupabaseServerClient, id: string, p: ProviderProfileInput) {
  const { error } = await db
    .from("providers")
    .update({
      pricing_model: p.pricingModel,
      capabilities: p.capabilities,
      availability_note: p.availabilityNote ?? null,
      website: p.website ?? null,
    })
    .eq("id", id);
  fail(error);
}

/** Updates editable profile fields. `kind` is fixed after creation and ignored here. */
export async function updateProvider(
  db: SupabaseServerClient,
  id: string,
  p: ProviderProfileInput,
): Promise<void> {
  const { data, error } = await db
    .from("providers")
    .update({
      category: p.category,
      name: p.name,
      description: p.description ?? null,
      city: p.city ?? null,
      service_area: p.serviceArea,
      min_capacity: p.minCapacity ?? null,
      max_capacity: p.maxCapacity ?? null,
      price_min: p.priceMin ?? null,
      price_max: p.priceMax ?? null,
      currency: p.currency,
      pricing_model: p.pricingModel,
      capabilities: p.capabilities,
      availability_note: p.availabilityNote ?? null,
      website: p.website ?? null,
    })
    .eq("id", id)
    .select("id");
  fail(error);
  if (!data?.length) throw fromDbError({ code: "42501" });
  const priv = await db
    .from("provider_private")
    .update({ contact_email: p.contactEmail ?? null, contact_phone: p.contactPhone ?? null })
    .eq("provider_id", id);
  fail(priv.error);
}

export async function setListed(
  db: SupabaseServerClient,
  id: string,
  listed: boolean,
): Promise<void> {
  const { data, error } = await db
    .from("providers")
    .update({ is_listed: listed })
    .eq("id", id)
    .select("id");
  fail(error);
  if (!data?.length) throw fromDbError({ code: "42501" });
}

export async function upsertVenue(
  db: SupabaseServerClient,
  id: string,
  v: VenueProfileInput,
): Promise<void> {
  const { error } = await db.from("venue_profiles").upsert(
    {
      provider_id: id,
      setting: v.setting,
      seated_capacity: v.seatedCapacity ?? null,
      standing_capacity: v.standingCapacity ?? null,
      address_text: v.addressText ?? null,
      area: v.area ?? null,
      access_conditions: v.accessConditions ?? null,
      accessibility: v.accessibility,
      suitability: v.suitability,
    },
    { onConflict: "provider_id" },
  );
  fail(error);
}

const serviceValues = (s: ServiceInput) => ({
  category: s.category,
  title: s.title,
  description: s.description ?? null,
  pricing_model: s.pricingModel,
  price_from: s.priceFrom ?? null,
  price_to: s.priceTo ?? null,
  currency: s.currency,
  min_quantity: s.minQuantity ?? null,
  max_quantity: s.maxQuantity ?? null,
  inclusions: s.inclusions,
  is_active: s.isActive,
});

export async function createService(
  db: SupabaseServerClient,
  providerId: string,
  s: ServiceInput,
): Promise<void> {
  const { error } = await db
    .from("provider_services")
    .insert({ provider_id: providerId, ...serviceValues(s) });
  fail(error);
}

export async function setServiceActive(
  db: SupabaseServerClient,
  providerId: string,
  serviceId: string,
  active: boolean,
): Promise<void> {
  const { data, error } = await db
    .from("provider_services")
    .update({ is_active: active })
    .eq("id", serviceId)
    .eq("provider_id", providerId)
    .select("id");
  fail(error);
  if (!data?.length) throw fromDbError({ code: "42501" });
}

export async function deleteService(
  db: SupabaseServerClient,
  providerId: string,
  serviceId: string,
): Promise<void> {
  const { data, error } = await db
    .from("provider_services")
    .delete()
    .eq("id", serviceId)
    .eq("provider_id", providerId)
    .select("id");
  fail(error);
  if (!data?.length) throw fromDbError({ code: "42501" });
}

export async function createDocument(
  db: SupabaseServerClient,
  providerId: string,
  d: DocumentInput,
): Promise<void> {
  const { error } = await db.from("provider_documents").insert({
    provider_id: providerId,
    kind: d.kind,
    title: d.title,
    reference_number: d.referenceNumber ?? null,
    issued_by: d.issuedBy ?? null,
    expires_on: d.expiresOn ?? null,
  });
  fail(error);
}

export async function deleteDocument(
  db: SupabaseServerClient,
  providerId: string,
  docId: string,
): Promise<void> {
  const { data, error } = await db
    .from("provider_documents")
    .delete()
    .eq("id", docId)
    .eq("provider_id", providerId)
    .select("id");
  fail(error);
  if (!data?.length) throw fromDbError({ code: "42501" });
}

export async function submitForVerification(db: SupabaseServerClient, id: string): Promise<void> {
  const { error } = await db.rpc("submit_provider_for_verification", { p_provider_id: id });
  fail(error);
}

// ---- Admin ------------------------------------------------------------------------------------

export async function listForReview(
  db: SupabaseServerClient,
  filter: "submitted" | "verified" | "rejected" | "draft" | "moderated" | "all",
): Promise<ProviderRow[]> {
  let q = db.from("providers").select(PROVIDER_COLUMNS);
  if (filter === "moderated") q = q.neq("moderation_status", "active");
  else if (filter !== "all") q = q.eq("verification_status", filter);
  const { data, error } = await q
    .order("submitted_at", { ascending: true, nullsFirst: false })
    .limit(200);
  fail(error);
  return z.array(ProviderRow).parse(data);
}

export async function setVerification(
  db: SupabaseServerClient,
  id: string,
  status: string,
  note?: string,
) {
  const { error } = await db.rpc("set_provider_verification", {
    p_provider_id: id,
    p_status: status,
    p_note: note ?? null,
  });
  fail(error);
}

export async function setModeration(
  db: SupabaseServerClient,
  id: string,
  status: string,
  reason?: string,
) {
  const { error } = await db.rpc("set_provider_moderation", {
    p_provider_id: id,
    p_status: status,
    p_reason: reason ?? null,
  });
  fail(error);
}

export async function reviewDocument(
  db: SupabaseServerClient,
  docId: string,
  status: string,
  note?: string,
) {
  const { error } = await db.rpc("review_provider_document", {
    p_document_id: docId,
    p_status: status,
    p_note: note ?? null,
  });
  fail(error);
}
