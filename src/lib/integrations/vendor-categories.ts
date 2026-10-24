import { z } from "zod";

/** The services HalaEvents can search vendors for. Client-safe: no provider code or secrets. */
export const VENDOR_CATEGORIES = ["venue", "catering", "transport"] as const;
export type VendorCategory = (typeof VENDOR_CATEGORIES)[number];
export const VendorCategorySchema = z.enum(VENDOR_CATEGORIES);
