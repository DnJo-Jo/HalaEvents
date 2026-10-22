import { z } from "zod";
import { optionalText } from "@/lib/schemas/common";

export const CommunicationKind = z.enum([
  "invitation",
  "registration_confirmation",
  "acceptance",
  "waitlist",
  "reminder",
  "venue_update",
  "schedule_update",
  "cancellation",
  "recovery",
  "thank_you",
]);
export type CommunicationKind = z.infer<typeof CommunicationKind>;

export const Audience = z.enum([
  "invited",
  "registered",
  "accepted",
  "waitlisted",
  "confirmed",
  "checked_in",
  "all_places",
  "single",
]);
export type Audience = z.infer<typeof Audience>;

export const CommunicationStatus = z.enum([
  "draft",
  "awaiting_approval",
  "approved",
  "sending",
  "sent",
  "partially_failed",
  "failed",
  "cancelled",
]);
export type CommunicationStatus = z.infer<typeof CommunicationStatus>;

export const DeliveryStatus = z.enum(["simulated", "accepted", "failed", "delivered", "bounced"]);
export type DeliveryStatus = z.infer<typeof DeliveryStatus>;

export const ApprovalStatus = z.enum([
  "pending",
  "approved",
  "rejected",
  "superseded",
  "executing",
  "executed",
  "execution_failed",
]);
export type ApprovalStatus = z.infer<typeof ApprovalStatus>;
export const ApprovalAction = z.enum([
  "send_communication",
  "request_booking",
  "cancel_booking",
  "apply_recovery",
  "send_provider_inquiry",
]);
export type ApprovalAction = z.infer<typeof ApprovalAction>;

const blankToNull = (v: unknown) => (v === "" || v === undefined ? null : v);

export const DraftInput = z
  .object({
    kind: CommunicationKind,
    audience: Audience,
    attendeeId: z.preprocess(blankToNull, z.uuid().nullable()),
    subject: z.string().trim().min(3, { message: "Write a subject." }).max(200),
    body: z
      .string()
      .trim()
      .min(10, { message: "Write the message (at least 10 characters)." })
      .max(5000),
  })
  .refine((d) => (d.audience === "single") === (d.attendeeId !== null), {
    path: ["attendeeId"],
    message: "Choose one person for a single-recipient message (and only then).",
  });
export type DraftInput = z.infer<typeof DraftInput>;

export const AiDraftInput = z
  .object({
    kind: CommunicationKind,
    audience: Audience,
    attendeeId: z.preprocess(blankToNull, z.uuid().nullable()),
    instructions: optionalText(500),
  })
  .refine((d) => (d.audience === "single") === (d.attendeeId !== null), {
    path: ["attendeeId"],
    message: "Choose one person for a single-recipient message (and only then).",
  });

/** Model output for the draft_message pipeline (validated before anything is saved). */
export const MessageDraftOutput = z.object({
  subject: z.string().min(3).max(200),
  body: z.string().min(10).max(3000),
});
export type MessageDraftOutput = z.infer<typeof MessageDraftOutput>;

export const DecisionInput = z.object({
  decision: z.enum(["approve", "reject"]),
  note: optionalText(500),
});
