import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import { ProviderRow } from "@/modules/profiles/providers-repo";
import type { DirectorySearchInput } from "./schemas";

export const PAGE_SIZE = 12;

export async function search(db: SupabaseServerClient, f: DirectorySearchInput) {
  const page = f.page ?? 1;
  const { data, error } = await db.rpc("search_providers", {
    p_query: f.q ?? null,
    p_category: f.category ?? null,
    p_city: f.city ?? null,
    p_attendance: f.attendance ?? null,
    p_budget: f.budget ?? null,
    p_limit: PAGE_SIZE + 1, // one extra row tells us whether there is a next page
    p_offset: (page - 1) * PAGE_SIZE,
  });
  if (error) throw fromDbError(error);
  const rows = z.array(ProviderRow).parse(data);
  return { providers: rows.slice(0, PAGE_SIZE), hasNext: rows.length > PAGE_SIZE, page };
}

export const ShortlistRow = z.object({
  provider_id: z.string(),
  note: z.string().nullable(),
  created_at: z.string(),
  providers: z
    .object({
      name: z.string(),
      category: z.string(),
      is_demo: z.boolean(),
      city: z.string().nullable(),
    })
    .nullable(),
});
export type ShortlistRow = z.infer<typeof ShortlistRow>;

export async function listShortlist(
  db: SupabaseServerClient,
  eventId: string,
): Promise<ShortlistRow[]> {
  const { data, error } = await db
    .from("event_shortlists")
    .select("provider_id, note, created_at, providers (name, category, is_demo, city)")
    .eq("event_id", eventId)
    .order("created_at");
  if (error) throw fromDbError(error);
  return z.array(ShortlistRow).parse(data);
}

export async function shortlistedEventIds(
  db: SupabaseServerClient,
  providerId: string,
): Promise<string[]> {
  const { data, error } = await db
    .from("event_shortlists")
    .select("event_id")
    .eq("provider_id", providerId);
  if (error) throw fromDbError(error);
  return z
    .array(z.object({ event_id: z.string() }))
    .parse(data)
    .map((r) => r.event_id);
}

export async function addToShortlist(
  db: SupabaseServerClient,
  eventId: string,
  providerId: string,
  note?: string,
) {
  const { error } = await db
    .from("event_shortlists")
    .upsert(
      { event_id: eventId, provider_id: providerId, note: note ?? null },
      { onConflict: "event_id,provider_id" },
    );
  if (error) throw fromDbError(error);
}

export async function removeFromShortlist(
  db: SupabaseServerClient,
  eventId: string,
  providerId: string,
) {
  const { error } = await db
    .from("event_shortlists")
    .delete()
    .eq("event_id", eventId)
    .eq("provider_id", providerId);
  if (error) throw fromDbError(error);
}
