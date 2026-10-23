import { z } from "zod";
import { TaskCategory, TaskPriority } from "@/modules/planning/playbook";
import { optionalText } from "@/lib/schemas/common";

/**
 * Recovery workflow schemas (event.md §23), shared by client and server.
 *  - `Impact`: the deterministic SQL snapshot (recovery_impact) stored on the incident.
 *  - `RecoveryProposal`: what the model may return. Flat (no unions) for Gemini's schema subset.
 *    There is deliberately no field that cancels, rebooks or confirms anything.
 */

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Use YYYY-MM-DD." });
const nullableNumber = z.coerce.number().nullable();

export const ImpactTask = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  status: z.enum(["todo", "in_progress", "done", "cancelled"]),
  priority: z.string(),
  due_date: z.string().nullable(),
  reason: z.string().optional(),
});
export type ImpactTask = z.infer<typeof ImpactTask>;

export const ImpactService = z.object({
  booking_id: z.string(),
  provider_id: z.string(),
  provider_name: z.string(),
  category: z.string(),
  status: z.string(),
  amount: z.coerce.number(),
  currency: z.string(),
  conditions: z.string().nullable(),
  service_from: z.string(),
  service_to: z.string(),
});
export type ImpactService = z.infer<typeof ImpactService>;

export const ImpactCheck = z.object({
  id: z.string(),
  title: z.string(),
  category: z.string(),
  status: z.string(),
  topic_key: z.string(),
  reason: z.string(),
});
export type ImpactCheck = z.infer<typeof ImpactCheck>;

export const ImpactCandidate = z.object({
  provider_id: z.string(),
  name: z.string(),
  city: z.string().nullable(),
  min_capacity: z.number().nullable(),
  max_capacity: z.number().nullable(),
  price_min: nullableNumber,
  price_max: nullableNumber,
  currency: z.string(),
  quote: z
    .object({
      quote_id: z.string(),
      amount: z.coerce.number(),
      currency: z.string(),
      valid_until: z.string(),
      conditions: z.string().nullable(),
    })
    .nullable(),
  /** Never "available": only a recorded conflict, or unknown. */
  availability: z.enum(["conflict_recorded", "unknown"]),
});
export type ImpactCandidate = z.infer<typeof ImpactCandidate>;

export const Impact = z.object({
  version: z.literal(1),
  event: z.object({
    name: z.string(),
    status: z.string(),
    starts_at: z.string(),
    ends_at: z.string(),
    timezone: z.string(),
    city: z.string().nullable(),
    capacity: z.number(),
    budget_amount: nullableNumber,
    currency: z.string(),
  }),
  venue: z.object({
    booking_id: z.string(),
    provider_id: z.string(),
    provider_name: z.string(),
    status: z.string(),
    amount: z.coerce.number(),
    currency: z.string(),
    conditions: z.string().nullable(),
    service_from: z.string(),
    service_to: z.string(),
    confirmed_at: z.string().nullable(),
  }),
  plan_tasks: z.array(ImpactTask.omit({ reason: true })),
  affected_tasks: z.array(ImpactTask),
  services: z.array(ImpactService),
  compliance: z.array(ImpactCheck),
  candidates: z.array(ImpactCandidate),
});
export type Impact = z.infer<typeof Impact>;

// ------------------------------------------------------------------------------------------------
// Model output
// ------------------------------------------------------------------------------------------------

const TempKey = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, { message: "Use a lower_snake_case key." });
export const InquiryPurpose = z.enum([
  "venue_cancellation_terms",
  "replacement_venue_availability",
  "service_reconfirmation",
]);
export type InquiryPurpose = z.infer<typeof InquiryPurpose>;
export const ReviewEntity = z.enum(["task", "booking", "compliance_check"]);
export type ReviewEntity = z.infer<typeof ReviewEntity>;

export const RecoveryProposal = z.object({
  summary: z.string().min(20).max(600),
  options: z
    .array(
      z.object({
        key: TempKey,
        title: z.string().min(3).max(100),
        description: z.string().min(10).max(400),
        /** A provider id from the candidate list, or "" when the option is not a replacement venue. */
        candidateProviderId: z.string().max(40),
        pros: z.array(z.string().min(3).max(160)).max(4),
        cons: z.array(z.string().min(3).max(160)).max(4),
      }),
    )
    .min(1)
    .max(3),
  recommendedOptionKey: TempKey,
  timeline: z
    .array(
      z.object({
        label: z.string().min(3).max(100),
        date: IsoDate,
        note: z.string().max(200),
      }),
    )
    .max(12),
  taskChanges: z
    .array(
      z.object({
        taskId: z.string().max(40),
        newDueDate: IsoDate,
        reason: z.string().min(5).max(200),
      }),
    )
    .max(30),
  newTasks: z
    .array(
      z.object({
        title: z.string().min(3).max(120),
        description: z.string().min(5).max(400),
        category: TaskCategory,
        priority: TaskPriority,
        dueDate: IsoDate,
      }),
    )
    .max(6),
  /** Reasons for items that must be re-checked. Which items are flagged is decided by code, not here. */
  reviewNotes: z
    .array(
      z.object({
        entityType: ReviewEntity,
        entityId: z.string().max(40),
        reason: z.string().min(5).max(200),
      }),
    )
    .max(60),
  providerInquiries: z
    .array(
      z.object({
        providerId: z.string().max(40),
        /** The booking the inquiry is about, or "" for a candidate venue. */
        bookingId: z.string().max(40),
        purpose: InquiryPurpose,
        subject: z.string().min(3).max(120),
        body: z.string().min(20).max(1200),
      }),
    )
    .max(10),
  attendeeUpdate: z.object({
    subject: z.string().min(3).max(120),
    body: z.string().min(30).max(1500),
  }),
  unresolvedQuestions: z.array(z.string().min(5).max(200)).max(8),
  risks: z.array(z.string().min(5).max(200)).max(8),
});
export type RecoveryProposal = z.infer<typeof RecoveryProposal>;

// ------------------------------------------------------------------------------------------------
// Stored changes (what recovery_changes.payload holds) and form inputs
// ------------------------------------------------------------------------------------------------

export type ChangeKind = "reschedule_task" | "add_task" | "flag_review";
export interface PlannedChange {
  kind: ChangeKind;
  entity_type: ReviewEntity | null;
  entity_id: string | null;
  payload: Record<string, unknown>;
}

export const SimulateInput = z.object({
  bookingId: z.uuid(),
  note: optionalText(500),
});
export const ReasonInput = z.object({
  reason: z.string().trim().min(5, { message: "Give a reason (at least 5 characters)." }).max(500),
});
export const CloseInput = z.object({
  outcome: z.enum(["resolved", "dismissed"]),
  reason: ReasonInput.shape.reason,
});
export const InquiryEditInput = z.object({
  subject: z.string().trim().min(3, { message: "Write a subject." }).max(200),
  body: z
    .string()
    .trim()
    .min(10, { message: "Write the message (at least 10 characters)." })
    .max(3000),
});

export const PlanStatus = z.enum([
  "proposed",
  "approved",
  "partially_approved",
  "rejected",
  "superseded",
]);
export type PlanStatus = z.infer<typeof PlanStatus>;
export const IncidentStatus = z.enum([
  "reported",
  "assessing",
  "replan_proposed",
  "resolved",
  "dismissed",
]);
export type IncidentStatus = z.infer<typeof IncidentStatus>;
export const InquiryStatus = z.enum([
  "draft",
  "awaiting_approval",
  "approved",
  "sent_simulated",
  "cancelled",
]);
export type InquiryStatus = z.infer<typeof InquiryStatus>;
