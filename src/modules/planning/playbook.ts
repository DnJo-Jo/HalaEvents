import { z } from "zod";
import { EventType } from "@/modules/events/schemas";
import { ProviderCategory } from "@/modules/profiles/schemas";

/**
 * Curated playbooks (event.md §6.4): versioned TypeScript data, validated here at import time so a
 * malformed playbook fails tests and the build instead of reaching users. Questions drive the
 * deterministic interview (P2); task templates, risks, missing-information checks, compliance topics
 * and provider categories feed plan generation (P3). Playbooks are JSON files in /playbooks.
 *
 * Besides tasks, a playbook carries the decision tables the planning engine (engine.ts) evaluates
 * against the organizer's answers: goals, requirements, assumptions, open decisions, budget lines,
 * event-day schedule blocks and per-task adjustments. Text may use `{{question.key}}` /
 * `{{event.capacity}}` placeholders, checked here so a typo fails the build, not a user's plan.
 */

/** "audience.level", "custom.parking" — dotted, lower-case. Matches the interview_answers CHECK. */
export const QuestionKey = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, { message: "Use a dotted lower-case key." });

/** Facts derived from the event row that conditions may reference (see eventContext()). */
export const EVENT_CONTEXT_KEYS = [
  "event.venue_type",
  "event.capacity",
  "event.duration_hours",
  "event.city",
  "event.budget_amount",
] as const;

/** Extra, read-only placeholders the engine fills in text (not usable in conditions). */
export const TEXT_ONLY_KEYS = ["event.name", "event.dates"] as const;
const PLACEHOLDER = /\{\{\s*([a-z0-9_.]+)\s*\}\}/g;
export const placeholdersIn = (text: string): string[] =>
  [...text.matchAll(PLACEHOLDER)].map((m) => m[1]);

const Scalar = z.union([z.string(), z.number(), z.boolean()]);
const ConditionKey = z.union([z.enum(EVENT_CONTEXT_KEYS), QuestionKey]);

export const Condition = z.discriminatedUnion("op", [
  z.object({ key: ConditionKey, op: z.literal("equals"), value: Scalar }),
  z.object({ key: ConditionKey, op: z.literal("in"), values: z.array(Scalar).min(1).max(20) }),
  z.object({ key: ConditionKey, op: z.literal("not_in"), values: z.array(Scalar).min(1).max(20) }),
  /** A multi-choice answer contains the value. */
  z.object({ key: ConditionKey, op: z.literal("includes"), value: z.string() }),
  z.object({ key: ConditionKey, op: z.literal("gte"), value: z.number() }),
]);
export type Condition = z.infer<typeof Condition>;

const Option = z.object({
  value: z.string().regex(/^[a-z0-9_]{1,40}$/),
  label: z.string().min(1).max(80),
});

const questionBase = {
  key: QuestionKey,
  text: z.string().min(5).max(200),
  /** Shown as the hint: why the answer matters for the plan. */
  why: z.string().min(5).max(300),
  required: z.boolean(),
  /** All conditions must hold. They may reference only event facts or *earlier* questions. */
  when: z.array(Condition).max(5).default([]),
};

export const Question = z.discriminatedUnion("type", [
  z.object({
    ...questionBase,
    type: z.literal("single_choice"),
    options: z.array(Option).min(2).max(12),
  }),
  z.object({
    ...questionBase,
    type: z.literal("multi_choice"),
    options: z.array(Option).min(2).max(12),
  }),
  z.object({ ...questionBase, type: z.literal("boolean") }),
  z.object({
    ...questionBase,
    type: z.literal("number"),
    min: z.number().int(),
    max: z.number().int(),
    unit: z.string().max(20).optional(),
  }),
  z.object({
    ...questionBase,
    type: z.literal("text"),
    maxLength: z.number().int().min(1).max(500),
  }),
]);
export type Question = z.infer<typeof Question>;

/** Task areas used by templates and AI proposals (tasks module, P4, will reuse them). */
export const TaskCategory = z.enum([
  "venue",
  "logistics",
  "catering",
  "safety",
  "compliance",
  "registration",
  "communications",
  "sponsorship",
  "finance",
  "technology",
  "judging",
  "staffing",
  "closeout",
]);
export type TaskCategory = z.infer<typeof TaskCategory>;
export const TaskPriority = z.enum(["low", "medium", "high", "critical"]);
export type TaskPriority = z.infer<typeof TaskPriority>;

/** Days relative to the event's first or last day, resolved in the event's timezone. */
export const RelativeDue = z.object({
  anchor: z.enum(["event_start", "event_end"]),
  offsetDays: z.number().int().min(-365).max(60),
});
export type RelativeDue = z.infer<typeof RelativeDue>;

const ItemKey = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, { message: "Use a lower-case key." });

export const TaskTemplate = z.object({
  key: ItemKey,
  title: z.string().min(3).max(120),
  description: z.string().min(3).max(600),
  category: TaskCategory,
  priority: TaskPriority,
  due: RelativeDue,
  ownerRole: z.string().min(2).max(60),
  dependsOn: z.array(ItemKey).max(10).default([]),
  when: z.array(Condition).max(5).default([]),
  /** Question keys whose answers this task needs. */
  requiredInfo: z.array(QuestionKey).max(5).default([]),
  risks: z.array(ItemKey).max(5).default([]),
  providerCategory: ProviderCategory.optional(),
  nextAction: z.string().min(3).max(200),
  /**
   * Decision table: every row whose conditions hold changes the task. Rows apply in order; the
   * last priority wins, day shifts add up (negative = earlier), notes are appended to the description.
   */
  adjustments: z
    .array(
      z.object({
        when: z.array(Condition).min(1).max(5),
        priority: TaskPriority.optional(),
        shiftDays: z.number().int().min(-120).max(120).optional(),
        note: z.string().min(3).max(300).optional(),
      }),
    )
    .max(8)
    .default([]),
});
export type TaskTemplate = z.infer<typeof TaskTemplate>;

export const RiskCategory = z.object({
  key: ItemKey,
  label: z.string().min(3).max(80),
  description: z.string().min(3).max(300),
  when: z.array(Condition).max(5).default([]),
  /** What to do to reduce the risk, and the fallback if it happens anyway. */
  mitigation: z.string().min(3).max(200).default("Review the related tasks in this plan."),
  contingency: z.string().max(200).default(""),
  likelihood: z.enum(["high", "medium", "low"]).default("medium"),
  /** Conditions that raise the likelihood to "high". */
  elevatedWhen: z.array(Condition).max(5).default([]),
});

/** Information the plan needs. Missing (unanswered, skipped or unset) items block generation. */
export const RequiredInfo = z.object({
  key: z.union([z.enum(EVENT_CONTEXT_KEYS), QuestionKey]),
  label: z.string().min(3).max(120),
  when: z.array(Condition).max(5).default([]),
});

/**
 * A topic that may need a permit, policy or official check. Playbooks can't claim
 * `verified_source`: that needs a verified knowledge source (P5), never a hard-coded label.
 */
export const ComplianceTopic = z.object({
  key: ItemKey,
  title: z.string().min(3).max(120),
  description: z.string().min(3).max(400),
  confidence: z.enum(["conditional", "recommended"]),
  sourceRequirement: z.enum([
    "official_source_required",
    "institution_policy",
    "organizer_decision",
  ]),
  when: z.array(Condition).max(5).default([]),
});

const Text300 = z.string().min(3).max(300);

/** A line of overview text that applies when its conditions hold. */
export const TextRule = z.object({ text: Text300, when: z.array(Condition).max(5).default([]) });

/** An assumption the plan makes while `ifMissing` (a question or event fact) is unanswered. */
export const AssumptionRule = z.object({
  text: Text300,
  when: z.array(Condition).max(5).default([]),
  ifMissing: z.union([z.enum(EVENT_CONTEXT_KEYS), QuestionKey]).optional(),
});

/** A decision still open: shown while `ifMissing` is unanswered or `when` holds (e.g. "not decided"). */
export const DecisionRule = AssumptionRule;

/**
 * An illustrative budget line. Amounts are planning allowances in `referenceCurrency`, never
 * quotes: the engine labels them and shows none when the event uses another currency.
 */
export const BudgetLine = z.object({
  key: ItemKey,
  name: z.string().min(2).max(60),
  basis: z.enum(["fixed", "per_attendee", "per_group"]),
  unitAmount: z.number().min(0).max(10_000_000),
  /** per_group: a number question holding the group (team) size. */
  groupSizeKey: QuestionKey.optional(),
  note: z.string().max(200).default(""),
  when: z.array(Condition).max(5).default([]),
  adjustments: z
    .array(
      z.object({ when: z.array(Condition).min(1).max(5), multiplier: z.number().min(0).max(10) }),
    )
    .max(6)
    .default([]),
});

/** An event-day block, placed from the start or the end of the event. Blocks that don't fit are dropped. */
export const ScheduleBlock = z.object({
  key: ItemKey,
  title: z.string().min(3).max(100),
  from: z.enum(["start", "end"]),
  /** Minutes after the start (from "start") or before the end (from "end"; the block ends that long before). */
  offsetMinutes: z.number().int().min(0).max(20_000),
  durationMinutes: z.number().int().min(5).max(1_440),
  note: z.string().max(200).default(""),
  when: z.array(Condition).max(5).default([]),
});

export const ProviderSuggestion = z.object({
  category: ProviderCategory,
  reason: z.string().min(3).max(200),
  when: z.array(Condition).max(5).default([]),
});

/**
 * Curated guidance for the venue-cancellation recovery workflow (event.md §23). It is planning
 * guidance written by the HalaEvents team, not a legal or contractual rule: it never authorizes
 * cancelling a booking, it only tells the model and the organizer what to ask and re-check.
 */
export const RecoveryGuidance = z.object({
  venueCancellation: z.object({
    principles: z.array(z.string().min(5).max(300)).min(1).max(10),
    /** What to ask each kind of provider whose arrangement may depend on the venue. */
    reconfirm: z
      .array(
        z.object({
          category: ProviderCategory,
          ask: z.array(z.string().min(5).max(200)).min(1).max(6),
        }),
      )
      .max(10),
    questionsForReplacementVenue: z.array(z.string().min(5).max(200)).max(10),
    accessAndComplianceNotes: z.array(z.string().min(5).max(300)).max(10),
  }),
});
export type RecoveryGuidance = z.infer<typeof RecoveryGuidance>;

export const PlaybookSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      .max(64),
    version: z.number().int().min(1).max(10000),
    eventType: EventType,
    title: z.string().min(3).max(120),
    questions: z.array(Question).min(1).max(100),
    taskTemplates: z.array(TaskTemplate).max(60).default([]),
    riskCategories: z.array(RiskCategory).max(30).default([]),
    /** Illustrative amounts below are in this currency. */
    referenceCurrency: z.string().length(3).default("AED"),
    summary: z.string().min(10).max(600),
    goals: z.array(TextRule).max(12).default([]),
    requirements: z.array(TextRule).max(20).default([]),
    assumptions: z.array(AssumptionRule).max(20).default([]),
    decisions: z.array(DecisionRule).max(20).default([]),
    budgetLines: z.array(BudgetLine).max(20).default([]),
    schedule: z.array(ScheduleBlock).max(40).default([]),
    requiredForPlan: z.array(RequiredInfo).max(30).default([]),
    complianceTopics: z.array(ComplianceTopic).max(30).default([]),
    providerCategories: z.array(ProviderSuggestion).max(20).default([]),
    recovery: RecoveryGuidance.optional(),
  })
  .superRefine((p, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });

    /** Conditions may use event facts and the questions in `known` (earlier ones, or all of them). */
    const checkCondition = (
      c: Condition,
      known: Map<string, Question>,
      path: (string | number)[],
      what: string,
    ) => {
      if (c.key.startsWith("event.")) {
        if (!(EVENT_CONTEXT_KEYS as readonly string[]).includes(c.key)) {
          issue(path, `${c.key} is not a known event fact`);
        }
        return;
      }
      const ref = known.get(c.key);
      if (!ref) return issue(path, `${c.key} is not ${what}`);
      const values = "values" in c ? c.values : [c.value];
      const fits = (v: string | number | boolean) =>
        ref.type === "boolean"
          ? typeof v === "boolean"
          : ref.type === "number"
            ? typeof v === "number"
            : ref.type === "text"
              ? typeof v === "string"
              : ref.options.some((o) => o.value === v);
      if (!values.every(fits)) issue(path, `Condition value doesn't fit ${c.key}`);
      if (c.op === "includes" && ref.type !== "multi_choice") {
        issue(path, "includes needs a multi-choice question");
      }
    };

    const seen = new Map<string, Question>();
    p.questions.forEach((q, i) => {
      if (q.key.startsWith("event.")) issue(["questions", i, "key"], "event.* keys are reserved");
      if (seen.has(q.key)) issue(["questions", i, "key"], `Duplicate key ${q.key}`);
      if (q.type === "number" && q.min > q.max) issue(["questions", i], "min is greater than max");
      q.when.forEach((c, j) =>
        checkCondition(c, seen, ["questions", i, "when", j], "an earlier question"),
      );
      seen.set(q.key, q);
    });

    const unique = (keys: string[], section: string) =>
      keys.forEach((k, i) => {
        if (keys.indexOf(k) !== i) issue([section, i, "key"], `Duplicate key ${k}`);
      });
    unique(
      p.taskTemplates.map((t) => t.key),
      "taskTemplates",
    );
    unique(
      p.riskCategories.map((r) => r.key),
      "riskCategories",
    );
    unique(
      p.complianceTopics.map((t) => t.key),
      "complianceTopics",
    );

    const templates = new Set(p.taskTemplates.map((t) => t.key));
    const risks = new Set(p.riskCategories.map((r) => r.key));
    p.taskTemplates.forEach((t, i) => {
      t.when.forEach((c, j) =>
        checkCondition(c, seen, ["taskTemplates", i, "when", j], "a question"),
      );
      t.dependsOn.forEach((d, j) => {
        if (d === t.key) issue(["taskTemplates", i, "dependsOn", j], `${t.key} depends on itself`);
        else if (!templates.has(d))
          issue(["taskTemplates", i, "dependsOn", j], `${d} is not a task template`);
      });
      t.requiredInfo.forEach((k, j) => {
        if (!seen.has(k)) issue(["taskTemplates", i, "requiredInfo", j], `${k} is not a question`);
      });
      t.risks.forEach((r, j) => {
        if (!risks.has(r)) issue(["taskTemplates", i, "risks", j], `${r} is not a risk category`);
      });
    });
    const cycle = findCycle(p.taskTemplates.map((t) => ({ id: t.key, dependsOn: t.dependsOn })));
    if (cycle) issue(["taskTemplates"], `Dependency cycle: ${cycle.join(" → ")}`);

    for (const [section, items] of [
      ["riskCategories", p.riskCategories],
      ["requiredForPlan", p.requiredForPlan],
      ["complianceTopics", p.complianceTopics],
      ["providerCategories", p.providerCategories],
    ] as const) {
      items.forEach((item, i) =>
        item.when.forEach((c, j) => checkCondition(c, seen, [section, i, "when", j], "a question")),
      );
    }
    p.requiredForPlan.forEach((r, i) => {
      if (!r.key.startsWith("event.") && !seen.has(r.key)) {
        issue(["requiredForPlan", i, "key"], `${r.key} is not a question`);
      }
    });

    const knownInfo = (k: string) =>
      (EVENT_CONTEXT_KEYS as readonly string[]).includes(k) || seen.has(k);
    const sections = [
      ["goals", p.goals],
      ["requirements", p.requirements],
      ["assumptions", p.assumptions],
      ["decisions", p.decisions],
      ["budgetLines", p.budgetLines],
      ["schedule", p.schedule],
    ] as const;
    for (const [section, items] of sections) {
      unique(
        items.map((x, i) => ("key" in x ? x.key : `${section}_${i}`)),
        section,
      );
      items.forEach((item, i) => {
        item.when.forEach((c, j) => checkCondition(c, seen, [section, i, "when", j], "a question"));
        if ("ifMissing" in item && item.ifMissing && !knownInfo(item.ifMissing))
          issue([section, i, "ifMissing"], `${item.ifMissing} is not a question or event fact`);
      });
    }
    p.budgetLines.forEach((b, i) => {
      b.adjustments.forEach((a, j) =>
        a.when.forEach((c, k) =>
          checkCondition(c, seen, ["budgetLines", i, "adjustments", j, "when", k], "a question"),
        ),
      );
      const group = b.groupSizeKey ? seen.get(b.groupSizeKey) : undefined;
      if (b.basis === "per_group" && group?.type !== "number")
        issue(["budgetLines", i, "groupSizeKey"], "per_group needs a number question");
    });
    p.taskTemplates.forEach((t, i) =>
      t.adjustments.forEach((a, j) =>
        a.when.forEach((c, k) =>
          checkCondition(c, seen, ["taskTemplates", i, "adjustments", j, "when", k], "a question"),
        ),
      ),
    );
    p.riskCategories.forEach((r, i) =>
      r.elevatedWhen.forEach((c, j) =>
        checkCondition(c, seen, ["riskCategories", i, "elevatedWhen", j], "a question"),
      ),
    );

    // Every {{placeholder}} in plan text must name a question or an event fact.
    const texts: [string, string][] = [
      ["summary", p.summary],
      ...p.goals.map((x, i): [string, string] => [`goals.${i}`, x.text]),
      ...p.requirements.map((x, i): [string, string] => [`requirements.${i}`, x.text]),
      ...p.assumptions.map((x, i): [string, string] => [`assumptions.${i}`, x.text]),
      ...p.decisions.map((x, i): [string, string] => [`decisions.${i}`, x.text]),
      ...p.budgetLines.map((x, i): [string, string] => [`budgetLines.${i}`, x.note]),
      ...p.taskTemplates.flatMap((t, i): [string, string][] => [
        [`taskTemplates.${i}.description`, t.description],
        [`taskTemplates.${i}.nextAction`, t.nextAction],
        ...t.adjustments.map((a, j): [string, string] => [
          `taskTemplates.${i}.adjustments.${j}`,
          a.note ?? "",
        ]),
      ]),
    ];
    for (const [where, text] of texts) {
      for (const k of placeholdersIn(text)) {
        if (!knownInfo(k) && !(TEXT_ONLY_KEYS as readonly string[]).includes(k))
          issue([where], `Unknown placeholder {{${k}}}`);
      }
    }

    // Schedule blocks are placed by minutes; a block longer than a day can't be placed sensibly.
    p.schedule.forEach((b, i) => {
      if (b.from === "end" && b.offsetMinutes < 0) issue(["schedule", i], "Offset is negative");
    });
  });
export type Playbook = z.infer<typeof PlaybookSchema>;

/**
 * Returns one dependency cycle (ids in order, first repeated at the end) or null. Edges to ids
 * outside the list are ignored; callers report unknown ids separately.
 */
export function findCycle(nodes: { id: string; dependsOn: readonly string[] }[]): string[] | null {
  const deps = new Map(nodes.map((n) => [n.id, n.dependsOn]));
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...stack.slice(stack.indexOf(id)), id];
    state.set(id, "visiting");
    stack.push(id);
    for (const d of deps.get(id) ?? []) {
      if (!deps.has(d)) continue;
      const found = visit(d);
      if (found) return found;
    }
    stack.pop();
    state.set(id, "done");
    return null;
  };
  for (const n of nodes) {
    const found = visit(n.id);
    if (found) return found;
  }
  return null;
}
