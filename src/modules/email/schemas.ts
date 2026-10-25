import { z } from "zod";
import { VendorCategorySchema, type VendorCategory } from "@/modules/vendors/schemas";

export type { VendorCategory };

/** What the organizer picked: a service category, optionally one shortlisted vendor in it. */
export const DraftRequestInput = z.object({
  category: VendorCategorySchema,
  placeId: z
    .string()
    .trim()
    .max(400)
    .optional()
    .transform((v) => v || undefined),
});
export type DraftRequestInput = z.infer<typeof DraftRequestInput>;

/** The model writes only the middle of the email; greeting, sign-off and subject come from code. */
export const AiEmailBody = z.object({ body: z.string().min(40).max(1800) });
export type AiEmailBody = z.infer<typeof AiEmailBody>;

export type DraftSource = "custom" | "template";

export interface EmailDraft {
  /** Always empty: vendor contact details are never guessed. The organizer may type one. */
  to: string;
  subject: string;
  body: string;
  source: DraftSource;
  /** Stable, non-sensitive tag also present in the subject (for matching replies later). */
  reference: string;
  vendorName: string | null;
  category: VendorCategory;
  /** Set when a custom draft was requested but the template was used instead. */
  notice?: string;
}

export type DraftResult =
  | { ok: true; draft: EmailDraft }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };
