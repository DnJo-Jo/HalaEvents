import { z } from "zod";
import {
  CurrencyCode,
  IanaTimezone,
  optionalNumber,
  optionalText,
  zonedDateTime,
} from "@/lib/schemas/common";

export const EventStatus = z.enum([
  "draft",
  "planning",
  "ready",
  "live",
  "completed",
  "archived",
  "cancelled",
]);
export type EventStatus = z.infer<typeof EventStatus>;

export const EventType = z.enum(["university_hackathon", "conference", "workshop"]);
export type EventType = z.infer<typeof EventType>;
export const EVENT_TYPE_LABELS: Record<EventType, string> = {
  university_hackathon: "University hackathon",
  conference: "Conference or seminar",
  workshop: "Workshop or training session",
};
export const VenueType = z.enum(["indoor", "outdoor", "hybrid", "online"]);
export const EventMemberRole = z.enum(["owner", "organizer", "viewer"]);
export type EventMemberRole = z.infer<typeof EventMemberRole>;

/** Event creation (UI arrives in P2). Dates are ISO strings with offset, stored as timestamptz. */
export const CreateEventInput = z
  .object({
    name: z.string().trim().min(3).max(120),
    eventType: EventType.default("university_hackathon"),
    venueType: VenueType.optional(),
    locationText: z.string().trim().max(200).optional(),
    city: z.string().trim().max(80).optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .default("AE"),
    timezone: IanaTimezone.default("Asia/Dubai"),
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    capacity: z.number().int().min(1).max(100000),
    budgetAmount: z.number().nonnegative().optional(),
    currency: CurrencyCode.default("AED"),
  })
  .refine((e) => Date.parse(e.endsAt) > Date.parse(e.startsAt), {
    path: ["endsAt"],
    message: "The event must end after it starts.",
  });
export type CreateEventInput = z.infer<typeof CreateEventInput>;

/** Form version: datetime-local values are wall-clock times in the chosen timezone. */
export function eventFormInput(timeZone: string) {
  return z
    .object({
      name: z.string().trim().min(3, { message: "Use at least 3 characters." }).max(120),
      eventType: EventType.default("university_hackathon"),
      venueType: z.preprocess((v) => (v === "" ? undefined : v), VenueType.optional()),
      locationText: optionalText(200),
      city: optionalText(80),
      timezone: IanaTimezone,
      startsAt: zonedDateTime(timeZone),
      endsAt: zonedDateTime(timeZone),
      capacity: z.coerce.number().int().min(1).max(100000),
      budgetAmount: optionalNumber(z.number().nonnegative().max(100_000_000)),
      currency: CurrencyCode.default("AED"),
    })
    .refine((e) => Date.parse(e.endsAt) > Date.parse(e.startsAt), {
      path: ["endsAt"],
      message: "The event must end after it starts.",
    });
}
export type EventFormInput = z.infer<ReturnType<typeof eventFormInput>>;

export const ChangeEventStatusInput = z.object({ status: EventStatus });
