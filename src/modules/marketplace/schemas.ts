import { z } from "zod";
import { optionalInt, optionalNumber, optionalText } from "@/lib/schemas/common";
import { ProviderCategory } from "@/modules/profiles/schemas";

/** Directory filters from the query string. Everything optional; bad values are dropped. */
export const DirectorySearchInput = z.object({
  q: optionalText(80).catch(undefined),
  category: ProviderCategory.optional().catch(undefined),
  city: optionalText(80).catch(undefined),
  attendance: optionalInt(1, 100000).catch(undefined),
  budget: optionalNumber(z.number().nonnegative().max(10_000_000)).catch(undefined),
  page: optionalInt(1, 100).catch(undefined),
});
export type DirectorySearchInput = z.infer<typeof DirectorySearchInput>;

export const ShortlistInput = z.object({
  eventId: z.uuid(),
  providerId: z.uuid(),
  note: optionalText(500),
});
