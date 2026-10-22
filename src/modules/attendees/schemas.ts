import { z } from "zod";
import { Email, optionalText, Phone } from "@/lib/schemas/common";

export const RegistrationStatus = z.enum(["invited", "registered", "withdrawn"]);
export type RegistrationStatus = z.infer<typeof RegistrationStatus>;
export const ReviewStatus = z.enum([
  "not_required",
  "pending",
  "needs_information",
  "approved",
  "rejected",
]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;
export const ParticipationStatus = z.enum([
  "pending",
  "accepted",
  "waitlisted",
  "rejected",
  "confirmed",
  "checked_in",
  "cancelled",
]);
export type ParticipationStatus = z.infer<typeof ParticipationStatus>;

const optionalPhone = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  Phone.optional(),
);

/** Public registration form: the minimum needed to take part. */
export const PublicRegistrationInput = z.object({
  fullName: z.string().trim().min(2, { message: "Enter your name." }).max(120),
  email: Email,
  phone: optionalPhone,
  applicationNote: optionalText(1000),
  consent: z.literal("yes", { message: "Please agree so we can process your registration." }),
});

export const AddAttendeeInput = z.object({
  fullName: z.string().trim().min(2, { message: "Enter a name." }).max(120),
  email: Email,
  phone: optionalPhone,
  registered: z.enum(["yes", "no"]).transform((v) => v === "yes"),
});

export const ParticipationInput = z.object({
  status: ParticipationStatus,
  reason: optionalText(500),
});
export const ReviewInput = z.object({ status: ReviewStatus, reason: optionalText(500) });
export const WithdrawInput = z.object({ reason: optionalText(500) });

export const RegistrationSettingsInput = z.object({
  registrationOpen: z.enum(["yes", "no"]).transform((v) => v === "yes"),
  requiresApplication: z.enum(["yes", "no"]).transform((v) => v === "yes"),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, { message: "Use lower-case letters, digits and dashes." })
    .max(80),
});
