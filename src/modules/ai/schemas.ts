import { z } from "zod";
import { Question, TaskCategory, TaskPriority } from "./playbook";

/**
 * Model output schemas (event.md §10.1, §17.4). Kept flat (no unions) so they convert cleanly to
 * Gemini's JSON-schema subset; business rules the schema can't express (dates, dependency graph,
 * evidence ids, URLs) are checked in rules.ts and trigger the client's repair retry.
 * There is deliberately no URL/source field: the model can only cite evidence ids we supplied.
 */

export const TempId = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,39}$/, { message: "Use a lower-case id." });

export const ProposalDue = z.object({
  /** "relative": anchor + offsetDays. "date": a calendar date (YYYY-MM-DD) in the event's timezone. */
  type: z.enum(["relative", "date"]),
  anchor: z.enum(["event_start", "event_end"]),
  offsetDays: z.number().int().min(-365).max(60),
  date: z.string().max(10),
});

export const TaskProposal = z.object({
  tempId: TempId,
  title: z.string().min(3).max(120),
  description: z.string().min(3).max(600),
  category: TaskCategory,
  priority: TaskPriority,
  due: ProposalDue,
  /** A role ("Venue lead"), never a person or user id: people are assigned by organizers (P4). */
  proposedOwner: z.string().min(2).max(60),
  dependsOn: z.array(TempId).max(10),
  requiredInfo: z.array(z.string().min(2).max(200)).max(5),
  evidenceIds: z.array(z.string().min(3).max(80)).max(6),
  confidence: z.enum(["high", "medium", "low"]),
  /** What the proposal is unsure about; empty when nothing. */
  uncertainty: z.string().max(300),
  nextAction: z.string().min(3).max(200),
});
export type TaskProposal = z.infer<typeof TaskProposal>;

const Line = z.string().min(3).max(200);

/** The non-task parts of a proposal. Everything here is a suggestion; amounts are unverified estimates. */
export const PlanOverview = z.object({
  summary: z.string().min(10).max(600),
  requirements: z.array(Line).max(10),
  missingInformation: z.array(Line).max(10),
  budgetCategories: z
    .array(
      z.object({
        name: z.string().min(2).max(60),
        /** An estimate in the event's currency; 0 when the model can't estimate. */
        estimatedAmount: z.number().min(0).max(100_000_000),
        note: z.string().max(200),
      }),
    )
    .max(12),
  risks: z
    .array(
      z.object({
        title: z.string().min(3).max(100),
        mitigation: z.string().min(3).max(200),
        likelihood: z.enum(["high", "medium", "low"]),
      }),
    )
    .max(10),
});
export type PlanOverview = z.infer<typeof PlanOverview>;

export const PlanOutput = z
  .object({
    tasks: z.array(TaskProposal).min(1).max(40),
    assumptions: z.array(z.string().min(3).max(200)).max(8),
  })
  .extend(PlanOverview.shape);
export type PlanOutput = z.infer<typeof PlanOutput>;

export const TaskRevisionOutput = z.object({
  task: TaskProposal,
  changeSummary: z.string().min(3).max(200),
});
export type TaskRevisionOutput = z.infer<typeof TaskRevisionOutput>;

/** A task proposal after deterministic resolution: what ai_suggestions.payload holds. */
export const StoredTask = TaskProposal.extend({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  warnings: z.array(z.string().max(200)).max(10),
  changeSummary: z.string().max(200).optional(),
});
export type StoredTask = z.infer<typeof StoredTask>;

export const FollowUpOutput = z.object({
  questions: z
    .array(
      z.object({
        key: z
          .string()
          .regex(/^custom\.[a-z][a-z0-9_]{2,40}$/, { message: "Use custom.<snake_case>." }),
        text: z.string().min(10).max(200),
        why: z.string().min(5).max(300),
        type: z.enum(["text", "boolean", "single_choice"]),
        /** Answer labels for single_choice; empty otherwise. */
        options: z.array(z.string().min(1).max(60)).max(6),
      }),
    )
    .max(3),
  enoughInformation: z.boolean(),
});
export type FollowUpOutput = z.infer<typeof FollowUpOutput>;

/** ai_suggestions.payload for kind = 'question' is a playbook-style Question. */
export const StoredFollowUp = Question;

export const ReviseTaskInput = z.object({
  note: z.string().trim().min(5, { message: "Describe the change in a few words." }).max(300),
});

export const PlanSource = z.enum(["ai", "playbook"]);
export const SuggestionStatus = z.enum(["proposed", "accepted", "rejected", "superseded"]);
export const AiRunStatus = z.enum([
  "running",
  "succeeded",
  "invalid_output",
  "failed",
  "rate_limited",
  "timeout",
  "model_unavailable",
]);
