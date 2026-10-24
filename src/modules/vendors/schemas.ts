import { z } from "zod";
import { VendorCategorySchema, type VendorCategory } from "@/lib/integrations/vendor-categories";

export { VendorCategorySchema };
export type { VendorCategory };

export const SERVICE_LABELS: Record<VendorCategory, string> = {
  venue: "Venue",
  catering: "Catering",
  transport: "Transportation",
};
export const SERVICE_HINTS: Record<VendorCategory, string> = {
  venue: "Candidate event venues and halls.",
  catering: "Restaurants that could be approached about catering.",
  transport: "Car rental businesses that could be approached about transport.",
};

/** Checkboxes: absent = none selected. */
export const ServicesInput = z.object({
  services: z.preprocess(
    (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]),
    z.array(VendorCategorySchema).max(3),
  ),
});

export const RADIUS_OPTIONS_KM = [5, 15, 30, 50] as const;
export const SearchInput = z.object({
  category: VendorCategorySchema,
  location: z.string().trim().min(2, "Enter a city or address.").max(200),
  radiusKm: z.coerce
    .number()
    .refine((n) => (RADIUS_OPTIONS_KM as readonly number[]).includes(n), "Pick a listed radius."),
});

/** What the shortlist form posts: a snapshot of one search result. */
export const ShortlistInput = z.object({
  category: VendorCategorySchema,
  placeId: z.string().trim().min(1).max(400),
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(400).optional(),
  phone: z.string().trim().max(60).optional(),
  website: z
    .string()
    .trim()
    .max(500)
    .regex(/^https?:\/\//)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});
export const VendorRefInput = z.object({
  category: VendorCategorySchema,
  placeId: z.string().trim().min(1).max(400),
});
export const VendorNoteInput = VendorRefInput.extend({ note: z.string().trim().max(500) });

export interface ShortlistedVendor {
  category: VendorCategory;
  place_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  latitude: number;
  longitude: number;
  note: string | null;
}
