import {
  conditionsHold,
  type Context,
  type InterviewState,
} from "@/modules/events/interview-rules";
import { findCycle, type Playbook, type Question } from "./playbook";
import type { FollowUpOutput, PlanOutput, StoredTask, TaskProposal } from "./schemas";

/**
 * Deterministic checks and transformations around AI output (event.md §6.2–6.3, §17.4).
 * Pure functions, unit-tested in tests/unit/ai/rules.test.ts. The model proposes; this file
 * decides what is valid, resolves dates and keeps the dependency graph acyclic.
 */

// ------------------------------------------------------------------------------------------------
// Dates (calendar dates in the event's timezone)
// ------------------------------------------------------------------------------------------------

export function localDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export function isRealDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Post-event tasks (close-out) may be due up to this many days after the last day. */
export const POST_EVENT_DAYS = 60;

export interface PlanContext {
  /** Event's first and last calendar day, and today, all in the event's timezone. */
  startDate: string;
  endDate: string;
  today: string;
  /** Evidence ids the model may cite → human label. */
  evidence: Map<string, string>;
}

export function planContext(
  event: { starts_at: string; ends_at: string; timezone: string },
  evidence: Map<string, string>,
  now: Date = new Date(),
): PlanContext {
  return {
    startDate: localDate(event.starts_at, event.timezone),
    endDate: localDate(event.ends_at, event.timezone),
    today: localDate(now.toISOString(), event.timezone),
    evidence,
  };
}

// ------------------------------------------------------------------------------------------------
// Plan validation and resolution
// ------------------------------------------------------------------------------------------------

const URL_LIKE = /\bhttps?:\/\/|\bwww\.[a-z0-9-]+\./i;

function textFields(t: TaskProposal): string[] {
  return [t.title, t.description, t.proposedOwner, t.uncertainty, t.nextAction, ...t.requiredInfo];
}

/** Business-rule errors for a model plan. Empty = valid. Messages are fed back in the repair turn. */
export function validatePlan(plan: PlanOutput, ctx: PlanContext): string[] {
  const errors: string[] = [];
  const ids = plan.tasks.map((t) => t.tempId);
  const known = new Set(ids);
  ids.forEach((id, i) => {
    if (ids.indexOf(id) !== i) errors.push(`tasks[${i}].tempId: duplicate id "${id}".`);
  });
  plan.tasks.forEach((t, i) => {
    const at = `tasks[${i}] (${t.tempId})`;
    for (const d of t.dependsOn) {
      if (d === t.tempId) errors.push(`${at}.dependsOn: a task can't depend on itself.`);
      else if (!known.has(d)) errors.push(`${at}.dependsOn: "${d}" is not a tempId in this plan.`);
    }
    for (const e of t.evidenceIds) {
      if (!ctx.evidence.has(e))
        errors.push(`${at}.evidenceIds: "${e}" is not one of the supplied evidence ids.`);
    }
    if (textFields(t).some((s) => URL_LIKE.test(s))) {
      errors.push(`${at}: don't include URLs or web addresses; cite evidence ids instead.`);
    }
    errors.push(...dueErrors(t, at, ctx));
  });
  const cycle = findCycle(plan.tasks.map((t) => ({ id: t.tempId, dependsOn: t.dependsOn })));
  if (cycle) errors.push(`dependsOn: dependency cycle ${cycle.join(" → ")}.`);
  if (plan.assumptions.some((a) => URL_LIKE.test(a)))
    errors.push("assumptions: don't include URLs.");
  const overviewText = [
    plan.summary,
    ...plan.requirements,
    ...plan.missingInformation,
    ...plan.budgetCategories.flatMap((b) => [b.name, b.note]),
    ...plan.risks.flatMap((r) => [r.title, r.mitigation]),
  ];
  if (overviewText.some((x) => URL_LIKE.test(x)))
    errors.push("overview: don't include URLs or web addresses.");
  return errors;
}

function dueErrors(t: TaskProposal, at: string, ctx: PlanContext): string[] {
  if (t.due.type === "relative") return [];
  if (!isRealDate(t.due.date))
    return [`${at}.due.date: "${t.due.date}" is not a real YYYY-MM-DD date.`];
  if (t.due.date < ctx.today)
    return [`${at}.due.date: ${t.due.date} is in the past (today is ${ctx.today}).`];
  if (t.due.date > addDays(ctx.endDate, POST_EVENT_DAYS)) {
    return [`${at}.due.date: ${t.due.date} is more than ${POST_EVENT_DAYS} days after the event.`];
  }
  return [];
}

/**
 * Turns validated proposals into stored tasks: resolves relative deadlines to calendar dates,
 * keeps pre-event deadlines on or before the first day, moves past deadlines to today, and flags
 * tasks due before their dependencies. Run validatePlan first.
 */
export function resolvePlan(tasks: TaskProposal[], ctx: PlanContext): StoredTask[] {
  const resolved = tasks.map((t) => {
    const warnings: string[] = [];
    let dueDate =
      t.due.type === "date"
        ? t.due.date
        : addDays(t.due.anchor === "event_start" ? ctx.startDate : ctx.endDate, t.due.offsetDays);
    if (t.due.type === "relative" && t.due.anchor === "event_start" && dueDate > ctx.startDate) {
      dueDate = ctx.startDate;
      warnings.push(
        "Deadline moved to the first event day: pre-event tasks can't be due after the event starts.",
      );
    }
    if (dueDate < ctx.today) {
      dueDate = ctx.today;
      warnings.push("The suggested deadline has already passed; it was moved to today.");
    }
    return { ...t, dueDate, warnings };
  });
  const byId = new Map(resolved.map((t) => [t.tempId, t]));
  for (const t of resolved) {
    for (const d of t.dependsOn) {
      const dep = byId.get(d);
      if (dep && dep.dueDate > t.dueDate) {
        t.warnings.push(`Due before the task it depends on ("${dep.title}", ${dep.dueDate}).`);
      }
    }
  }
  return resolved;
}

/** A revised task must keep its id and fit the rest of the plan (dependencies, cycles, evidence, dates). */
export function validateRevision(
  revised: TaskProposal,
  original: StoredTask,
  others: StoredTask[],
  ctx: PlanContext,
): string[] {
  if (revised.tempId !== original.tempId) return [`task.tempId must stay "${original.tempId}".`];
  const errors = validatePlan(
    { ...EMPTY_OVERVIEW, tasks: [...others, revised], assumptions: [] },
    ctx,
  );
  return errors.map((e) => e.replace(/^tasks\[\d+\] \(([^)]+)\)/, "task ($1)"));
}

// ------------------------------------------------------------------------------------------------
// Playbook-derived context
// ------------------------------------------------------------------------------------------------

export interface MissingInfo {
  key: string;
  label: string;
}

/** Plan-critical information that is unanswered, skipped (null) or unset on the event. */
export function missingInformation(playbook: Playbook, ctx: Context): MissingInfo[] {
  return playbook.requiredForPlan
    .filter((r) => conditionsHold(r.when, ctx))
    .filter((r) => ctx[r.key] === undefined || ctx[r.key] === null || ctx[r.key] === "")
    .map((r) => ({ key: r.key, label: r.label }));
}

/**
 * The only ids a plan may cite: the organizer's current answers and the applicable playbook
 * items. No web sources exist until knowledge sources are verified (P5), so none can be cited.
 */
export function evidenceCatalog(
  playbook: Playbook,
  ctx: Context,
  state: InterviewState,
): Map<string, string> {
  const ev = new Map<string, string>();
  for (const a of state.answered)
    if (a.value !== null) ev.set(`answer:${a.question.key}`, `Your answer: ${a.question.text}`);
  for (const t of playbook.taskTemplates) {
    if (conditionsHold(t.when, ctx)) ev.set(`playbook:task.${t.key}`, `Playbook task: ${t.title}`);
  }
  for (const r of playbook.riskCategories) {
    if (conditionsHold(r.when, ctx)) ev.set(`playbook:risk.${r.key}`, `Playbook risk: ${r.label}`);
  }
  for (const c of playbook.complianceTopics) {
    if (conditionsHold(c.when, ctx))
      ev.set(`playbook:topic.${c.key}`, `Playbook topic: ${c.title} (not verified)`);
  }
  return ev;
}

const EMPTY_OVERVIEW = {
  summary: "Revised task.",
  requirements: [],
  missingInformation: [],
  budgetCategories: [],
  risks: [],
};

/** The plan built from the playbook alone: the mock provider's output and the no-AI fallback. */
export function playbookPlan(
  playbook: Playbook,
  ctx: Context,
  evidence: Map<string, string>,
): PlanOutput {
  const templates = playbook.taskTemplates.filter((t) => conditionsHold(t.when, ctx));
  const keys = new Set(templates.map((t) => t.key));
  const questionText = new Map(playbook.questions.map((q) => [q.key, q.text]));
  const risks = playbook.riskCategories.filter((r) => conditionsHold(r.when, ctx));
  return {
    summary: "Plan built from the HalaEvents playbook and your interview answers, without AI.",
    requirements: [],
    missingInformation: [],
    budgetCategories: [],
    risks: risks.slice(0, 10).map((r) => ({
      title: r.label.slice(0, 100),
      mitigation: "Review the related tasks and checks in this plan.",
      likelihood: "medium" as const,
    })),
    tasks: templates.map((t) => ({
      tempId: t.key,
      title: t.title,
      description: t.description,
      category: t.category,
      priority: t.priority,
      due: { type: "relative", anchor: t.due.anchor, offsetDays: t.due.offsetDays, date: "" },
      proposedOwner: t.ownerRole,
      dependsOn: t.dependsOn.filter((d) => keys.has(d)),
      requiredInfo: t.requiredInfo.map((k) => questionText.get(k) ?? k).slice(0, 5),
      evidenceIds: [`playbook:task.${t.key}`, ...t.requiredInfo.map((k) => `answer:${k}`)]
        .filter((id) => evidence.has(id))
        .slice(0, 6),
      confidence: "medium",
      uncertainty: "",
      nextAction: t.nextAction,
    })),
    assumptions: ["Built from the HalaEvents playbook and your answers, without AI."],
  };
}

// ------------------------------------------------------------------------------------------------
// Interview follow-ups
// ------------------------------------------------------------------------------------------------

/** Live (non-dismissed) AI follow-up questions an event may have. */
export const MAX_FOLLOW_UPS = 15;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * Keeps only new, well-formed follow-ups: no reused keys (answered, dismissed or playbook), no
 * question whose wording matches one already asked, no URLs, and within the per-event limit.
 * Single-choice questions with fewer than two distinct options become free-text questions.
 */
export function filterFollowUps(
  output: FollowUpOutput,
  existing: { keys: Set<string>; texts: string[]; liveCount: number },
): Question[] {
  const keys = new Set(existing.keys);
  const texts = new Set(existing.texts.map(normalize));
  const out: Question[] = [];
  for (const f of output.questions) {
    if (existing.liveCount + out.length >= MAX_FOLLOW_UPS) break;
    if (keys.has(f.key) || texts.has(normalize(f.text))) continue;
    if ([f.text, f.why, ...f.options].some((s) => URL_LIKE.test(s))) continue;
    keys.add(f.key);
    texts.add(normalize(f.text));
    const options = [...new Set(f.options.map((o) => o.trim()).filter(Boolean))];
    const base = { key: f.key, text: f.text, why: f.why, required: false, when: [] };
    out.push(
      f.type === "boolean"
        ? { ...base, type: "boolean" }
        : f.type === "single_choice" && options.length >= 2
          ? {
              ...base,
              type: "single_choice",
              options: options.map((label, i) => ({ value: `option_${i + 1}`, label })),
            }
          : { ...base, type: "text", maxLength: 300 },
    );
  }
  return out;
}
