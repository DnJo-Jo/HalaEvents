import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import { VendorCategorySchema } from "./schemas";

const Row = z.object({
  category: VendorCategorySchema,
  place_id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  note: z.string().nullable(),
});
const COLUMNS = Object.keys(Row.shape).join(", ");

export async function listShortlist(db: SupabaseServerClient, eventId: string) {
  const { data, error } = await db
    .from("event_vendor_shortlist")
    .select(COLUMNS)
    .eq("event_id", eventId)
    .order("created_at");
  if (error) throw fromDbError(error);
  return z.array(Row).parse(data ?? []);
}

async function rpc(db: SupabaseServerClient, fn: string, args: Record<string, unknown>) {
  const { error } = await db.rpc(fn, args);
  if (error) throw fromDbError(error);
}

export const saveServices = (db: SupabaseServerClient, eventId: string, services: string[]) =>
  rpc(db, "save_event_services", { p_event_id: eventId, p_services: services });

export const shortlistVendor = (
  db: SupabaseServerClient,
  eventId: string,
  v: {
    category: string;
    placeId: string;
    name: string;
    address?: string;
    phone?: string;
    website?: string;
    latitude: number;
    longitude: number;
  },
) =>
  rpc(db, "shortlist_vendor", {
    p_event_id: eventId,
    p_category: v.category,
    p_place_id: v.placeId,
    p_name: v.name,
    p_address: v.address || null,
    p_phone: v.phone || null,
    p_website: v.website || null,
    p_latitude: v.latitude,
    p_longitude: v.longitude,
  });

export const setVendorNote = (
  db: SupabaseServerClient,
  eventId: string,
  category: string,
  placeId: string,
  note: string,
) =>
  rpc(db, "set_vendor_note", {
    p_event_id: eventId,
    p_category: category,
    p_place_id: placeId,
    p_note: note,
  });

export const removeVendor = (
  db: SupabaseServerClient,
  eventId: string,
  category: string,
  placeId: string,
) =>
  rpc(db, "remove_shortlisted_vendor", {
    p_event_id: eventId,
    p_category: category,
    p_place_id: placeId,
  });
