import { z } from "zod";
import { Question, TaskCategory, TaskPriority } from "./playbook";

/**
 * Plan schemas (event.md §10.1, §17.4). The planning engine produces a `PlanOutput`; it is
 * validated by rules.ts (dates, dependency graph, evidence ids, URLs) before anything is stored.
 * There is deliberately no URL/source field: a plan can only cite evidence ids the engine supplied.
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
  /** What the plan is unsure about (usually an unanswered question); empty when nothing. */
  uncertainty: z.string().max(300),
  nextAction: z.string().min(3).max(200),
});
export type TaskProposal = z.infer<typeof TaskProposal>;

const Line = z.string().min(3).max(300);

/** The non-task parts of a plan. Everything here is a suggestion; amounts are unverified estimates. */
export const PlanOverview = z.object({
  summary: z.string().min(10).max(800),
  goals: z.array(Line).max(12).default([]),
  requirements: z.array(Line).max(20),
  missingInformation: z.array(Line).max(10),
  /** Decisions the organizers still have to make. */
  decisions: z.array(Line).max(20).default([]),
  /** The few unanswered questions that would change the plan the most. */
  followUpQuestions: z
    .array(z.object({ question: z.string().min(3).max(200), why: z.string().max(300) }))
    .max(8)
    .default([]),
  budgetCategories: z
    .array(
      z.object({
        name: z.string().min(2).max(60),
        /** An illustrative allowance in the event's currency; 0 when none can be given. */
        estimatedAmount: z.number().min(0).max(100_000_000),
        note: z.string().max(300),
      }),
    )
    .max(20),
  /** How the illustrative amounts were made and how they compare with the event budget. */
  budgetSummary: z.string().max(600).default(""),
  risks: z
    .array(
      z.object({
        title: z.string().min(3).max(100),
        mitigation: z.string().min(3).max(200),
        likelihood: z.enum(["high", "medium", "low"]),
        /** The fallback if the risk happens anyway. */
        contingency: z.string().max(200).default(""),
      }),
    )
    .max(20),
  /** Where the organizer's additional details contradict the structured facts (custom drafts). */
  conflicts: z.array(Line).max(5).default([]),
  /** Event-day timetable in the event's timezone. */
  schedule: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        start: z.string().regex(/^\d{2}:\d{2}$/),
        end: z.string().regex(/^\d{2}:\d{2}$/),
        title: z.string().min(3).max(100),
        note: z.string().max(200).default(""),
      }),
    )
    .max(60)
    .default([]),
});
export type PlanOverview = z.infer<typeof PlanOverview>;

export const PlanOutput = z
  .object({
    tasks: z.array(TaskProposal).min(1).max(40),
    assumptions: z.array(z.string().min(3).max(300)).max(20),
  })
  .extend(PlanOverview.shape);
export type PlanOutput = z.infer<typeof PlanOutput>;

/** A task proposal after deterministic resolution: what ai_suggestions.payload holds. */
export const StoredTask = TaskProposal.extend({
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  warnings: z.array(z.string().max(200)).max(10),
  changeSummary: z.string().max(200).optional(),
});
export type StoredTask = z.infer<typeof StoredTask>;

/** ai_suggestions.payload for kind = 'question' is a playbook-style Question. */
export const StoredFollowUp = Question;

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
export type AiRunStatus = z.infer<typeof AiRunStatus>;

/**
 * What the drafting model returns (event.md §17.7): a compact plan without budget amounts or a
 * timetable, which deterministic code adds. `agent.ts` turns it into a PlanOutput, then the same
 * validatePlan/resolvePlan checks as for template plans apply.
 */
export const AiPlanDraft = z.object({
  summary: z.string().min(10).max(400),
  goals: z.array(Line).max(5),
  tasks: z
    .array(
      z.object({
        id: TempId,
        title: z.string().min(3).max(120),
        description: z.string().min(3).max(200),
        category: TaskCategory,
        priority: TaskPriority,
        /** Days relative to the event's first ("start") or last ("end") day; negative = before. */
        anchor: z.enum(["start", "end"]),
        offsetDays: z.number().int().min(-365).max(60),
        owner: z.string().min(2).max(60),
        dependsOn: z.array(TempId).max(6),
        evidence: z.array(z.string().min(3).max(80)).max(4),
        confidence: z.enum(["high", "medium", "low"]),
        nextAction: z.string().min(3).max(120),
      }),
    )
    .min(3)
    .max(20),
  assumptions: z.array(Line).max(8),
  risks: z
    .array(
      z.object({
        title: z.string().min(3).max(100),
        likelihood: z.enum(["high", "medium", "low"]),
        mitigation: z.string().min(3).max(200),
        contingency: z.string().max(200),
      }),
    )
    .max(8),
  decisions: z.array(Line).max(6),
  followUpQuestions: z
    .array(z.object({ question: z.string().min(3).max(200), why: z.string().max(300) }))
    .max(5),
  /** Contradictions between the additional details and the event facts/answers; empty if none. */
  conflicts: z.array(Line).max(5),
});
export type AiPlanDraft = z.infer<typeof AiPlanDraft>;

/**
 * Full custom draft (AI_PLAN_STRATEGY=full, event.md §17.8): the model also writes the overview
 * parts the hybrid draft takes from the playbook engine — requirements, missing information,
 * budget lines (illustrative, in the event currency) and the event-day schedule. Code still
 * validates everything (validatePlan + fullPlanErrors) before anything is stored.
 */
export const AiFullPlanDraft = AiPlanDraft.extend({
  tasks: AiPlanDraft.shape.tasks.max(16),
  requirements: z.array(Line).max(8),
  missingInformation: z.array(Line).max(6),
  budgetCategories: z
    .array(
      z.object({
        name: z.string().min(2).max(60),
        estimatedAmount: z.number().min(0).max(100_000_000),
        note: z.string().max(160),
      }),
    )
    .max(10),
  budgetSummary: z.string().max(400),
  schedule: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        start: z.string().regex(/^\d{2}:\d{2}$/),
        end: z.string().regex(/^\d{2}:\d{2}$/),
        title: z.string().min(3).max(100),
        note: z.string().max(120),
      }),
    )
    .max(16),
});
export type AiFullPlanDraft = z.infer<typeof AiFullPlanDraft>;
