import { z } from "zod";

/** Review schemas (event.md §24), shared by client and server. */
export const ReviewDirection = z.enum(["organizer_to_provider", "provider_to_organizer"]);
export type ReviewDirection = z.infer<typeof ReviewDirection>;

export const ReportReason = z.enum([
  "inaccurate",
  "abusive",
  "spam",
  "conflict_of_interest",
  "other",
]);
export type ReportReason = z.infer<typeof ReportReason>;

export const ReviewInput = z.object({
  bookingId: z.uuid(),
  direction: ReviewDirection,
  rating: z.coerce
    .number({ message: "Choose a rating from 1 to 5." })
    .int({ message: "Choose a rating from 1 to 5." })
    .min(1, { message: "Choose a rating from 1 to 5." })
    .max(5, { message: "Choose a rating from 1 to 5." }),
  body: z
    .string()
    .trim()
    .min(10, { message: "Write at least 10 characters of feedback." })
    .max(2000, { message: "Keep the feedback under 2000 characters." }),
});
export type ReviewInput = z.infer<typeof ReviewInput>;

export const ResponseInput = z.object({
  body: z
    .string()
    .trim()
    .min(10, { message: "Write at least 10 characters." })
    .max(1500, { message: "Keep the response under 1500 characters." }),
});

export const ReportInput = z.object({
  kind: z.enum(["report", "dispute"]),
  reason: ReportReason,
  details: z
    .string()
    .trim()
    .min(5, { message: "Say what is wrong (at least 5 characters)." })
    .max(1000),
});

export const ModerateInput = z.object({
  status: z.enum(["published", "hidden"]),
  note: z.string().trim().min(5, { message: "Give a reason (at least 5 characters)." }).max(500),
});

export const ResolveInput = z.object({
  resolution: z.enum(["upheld", "dismissed"]),
  note: z.string().trim().min(5, { message: "Give a reason (at least 5 characters)." }).max(500),
  hide: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});

export const SettingInput = z.object({
  enabled: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
});
