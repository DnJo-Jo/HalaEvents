import {
  conditionsHold,
  type Context,
  type InterviewState,
} from "@/modules/events/interview-rules";
import { findCycle, type Playbook } from "./playbook";
import type { PlanOutput, StoredTask, TaskProposal } from "./schemas";

/**
 * Deterministic checks and transformations around a generated plan (event.md §6.2–6.3, §17.4).
 * Pure functions, unit-tested in tests/unit/planning/rules.test.ts. The engine proposes; this file
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
  /** Evidence ids a plan may cite → human label. */
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

/** Business-rule errors for a generated plan. Empty = valid. */
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
    plan.budgetSummary,
    ...plan.goals,
    ...plan.requirements,
    ...plan.missingInformation,
    ...plan.decisions,
    ...plan.followUpQuestions.flatMap((q) => [q.question, q.why]),
    ...plan.budgetCategories.flatMap((b) => [b.name, b.note]),
    ...plan.risks.flatMap((r) => [r.title, r.mitigation, r.contingency]),
    ...plan.schedule.flatMap((b) => [b.title, b.note]),
  ];
  if (overviewText.some((x) => URL_LIKE.test(x)))
    errors.push("overview: don't include URLs or web addresses.");
  plan.schedule.forEach((b, i) => {
    const prev = plan.schedule[i - 1];
    if (prev && `${prev.date} ${prev.start}` > `${b.date} ${b.start}`)
      errors.push(`schedule[${i}]: blocks must be in time order.`);
  });
  return errors;
}

/**
 * Extra checks for plans whose overview a model wrote (full custom drafts): the schedule must sit
 * on the event's days with blocks that end after they start. Template/hybrid schedules come from
 * the engine and are covered by its tests.
 */
export function fullPlanErrors(plan: PlanOutput, ctx: PlanContext): string[] {
  const errors: string[] = [];
  plan.schedule.forEach((b, i) => {
    if (!isRealDate(b.date) || b.date < ctx.startDate || b.date > ctx.endDate)
      errors.push(`schedule[${i}].date: ${b.date} is not an event day.`);
    if (!(b.start < b.end)) errors.push(`schedule[${i}]: must end after it starts.`);
  });
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
