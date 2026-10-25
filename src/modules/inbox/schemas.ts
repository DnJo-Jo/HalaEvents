import { z } from "zod";
import { VendorCategorySchema, type VendorCategory } from "@/modules/vendors/schemas";

export type { VendorCategory };

const Text = (max: number) => z.string().trim().max(max);

/** What the model extracts from one vendor reply. null / empty = the email doesn't say. */
export const ReplyAnalysis = z.object({
  price: Text(160).nullable(),
  availability: Text(300).nullable(),
  serviceDetails: z.array(Text(200)).max(8),
  conditions: z.array(Text(200)).max(8),
});
export type ReplyAnalysis = z.infer<typeof ReplyAnalysis>;

export const ReplyRow = z.object({
  id: z.string(),
  category: VendorCategorySchema,
  place_id: z.string().nullable(),
  reference: z.string(),
  from_email: z.string(),
  from_name: z.string().nullable(),
  subject: z.string(),
  body: z.string(),
  received_at: z.string(),
  analysis: ReplyAnalysis.nullable(),
  analyzed_at: z.string().nullable(),
});
export type ReplyRow = z.infer<typeof ReplyRow>;
