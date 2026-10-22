import { z } from "zod";
import { CurrencyCode, optionalNumber, optionalText, zonedDateTime } from "@/lib/schemas/common";
import { ProviderCategory } from "@/modules/profiles/schemas";

export const ServiceRequestStatus = z.enum(["open", "closed", "cancelled"]);
export type ServiceRequestStatus = z.infer<typeof ServiceRequestStatus>;
export const InviteStatus = z.enum(["invited", "declined"]);
export type InviteStatus = z.infer<typeof InviteStatus>;
export const QuoteStatus = z.enum(["draft", "submitted", "withdrawn", "declined"]);
export type QuoteStatus = z.infer<typeof QuoteStatus>;
export const MessageSide = z.enum(["organizer", "provider"]);

/** Datetime fields are wall-clock times in the event's timezone (passed in by the service). */
export function serviceRequestInput(timeZone: string) {
  return z
    .object({
      eventId: z.uuid(),
      category: ProviderCategory,
      title: z.string().trim().min(3, { message: "Use at least 3 characters." }).max(120),
      requirements: z
        .string()
        .trim()
        .min(10, { message: "Describe what you need (at least 10 characters)." })
        .max(4000),
      neededFrom: zonedDateTime(timeZone),
      neededTo: zonedDateTime(timeZone),
      expectedAttendance: z.coerce.number().int().min(1).max(100000),
      budgetMax: optionalNumber(z.number().nonnegative().max(10_000_000)),
      currency: CurrencyCode.default("AED"),
      respondBy: z.preprocess(
        (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
        zonedDateTime(timeZone).optional(),
      ),
      providerIds: z
        .array(z.uuid())
        .min(1, { message: "Choose at least one provider." })
        .max(10, { message: "Invite at most 10 providers per request." })
        .transform((ids) => [...new Set(ids)]),
    })
    .refine((r) => Date.parse(r.neededTo) > Date.parse(r.neededFrom), {
      path: ["neededTo"],
      message: "The end must be after the start.",
    })
    .refine((r) => !r.respondBy || Date.parse(r.respondBy) > Date.now(), {
      path: ["respondBy"],
      message: "The response deadline must be in the future.",
    });
}
export type ServiceRequestInput = z.infer<ReturnType<typeof serviceRequestInput>>;

export function quoteInput(timeZone: string) {
  return z
    .object({
      requestId: z.uuid(),
      providerId: z.uuid(),
      amount: z.coerce.number({ message: "Enter an amount." }).nonnegative().max(10_000_000),
      currency: CurrencyCode.default("AED"),
      inclusions: z.string().trim().min(1, { message: "List what the price includes." }).max(4000),
      exclusions: optionalText(4000),
      conditions: optionalText(4000),
      validUntil: zonedDateTime(timeZone),
      intent: z.enum(["draft", "submit"]),
    })
    .refine((q) => Date.parse(q.validUntil) > Date.now(), {
      path: ["validUntil"],
      message: "The quote must be valid until a future date.",
    });
}
export type QuoteInput = z.infer<ReturnType<typeof quoteInput>>;

export const MessageInput = z.object({
  requestId: z.uuid(),
  providerId: z.uuid(),
  side: MessageSide,
  body: z.string().trim().min(1, { message: "Write a message." }).max(2000),
});

export const DeclineRequestInput = z.object({
  requestId: z.uuid(),
  providerId: z.uuid(),
  reason: optionalText(1000),
});

export const DeclineQuoteInput = z.object({ quoteId: z.uuid(), reason: optionalText(1000) });
