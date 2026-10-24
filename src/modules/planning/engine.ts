import { conditionsHold, formatAnswer, type Context } from "@/modules/events/interview-rules";
import { type Playbook, type Question, type TaskTemplate } from "./playbook";
import { localDate, missingInformation, type MissingInfo, type PlanContext } from "./rules";
import type { PlanOutput, TaskProposal } from "./schemas";

/**
 * The planning engine (event.md §6.2, §17). Turns a playbook (decision tables and templates) plus
 * the event facts and the organizer's interview answers into a plan draft. Pure and deterministic:
 * the same inputs always give the same plan, nothing is fetched, and no external service is used.
 *
 * Everything it produces is a suggestion. Amounts are illustrative allowances in the playbook's
 * reference currency, never quotes; it never states that a vendor is available, a permit is
 * approved or a booking is confirmed. The result still goes through `validatePlan` (rules.ts)
 * and is stored as proposals that an organizer reviews and accepts.
 */

/** Bump when the engine's behaviour changes, so saved plans are recognised as stale. */
export const ENGINE_VERSION = 1;

/** Below this many days to the first day, the plan is compressed and a risk is added. */
export const SHORT_LEAD_DAYS = 14;
/** Risks computed from event facts (not playbook text); generated drafts keep them too. */
export const COMPUTED_RISK_TITLES = {
  shortLead: "Short lead time",
  overBudget: "Estimated costs exceed the budget",
} as const;

export interface EngineEvent {
  name: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  capacity: number;
  currency: string;
  budget_amount: number | null;
  city: string | null;
}

export interface EngineInput {
  playbook: Playbook;
  event: EngineEvent;
  /** Event facts plus the answers that apply (see `answerContext`). */
  ctx: Context;
  /** Dates and the evidence ids a task may cite. */
  plan: PlanContext;
}

const LIKELIHOOD_RANK = { high: 0, medium: 1, low: 2 } as const;
const ROUND_TO = 50;

const clip = (s: string, max: number) =>
  s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
const money = (n: number) => n.toLocaleString("en-US");

/** Whole days from `from` to `to`, both YYYY-MM-DD. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function localClock(ms: number, timeZone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
  return { date: localDate(new Date(ms).toISOString(), timeZone), time: parts };
}

/** Fills `{{key}}` placeholders from event facts and answers; unknown or unanswered → a neutral phrase. */
function textFiller(input: EngineInput) {
  const { playbook, event, ctx, plan } = input;
  const questions = new Map<string, Question>(playbook.questions.map((q) => [q.key, q]));
  const value = (key: string): string => {
    if (key === "event.name") return event.name;
    if (key === "event.dates")
      return plan.startDate === plan.endDate
        ? plan.startDate
        : `${plan.startDate} to ${plan.endDate}`;
    const v = ctx[key];
    if (v === undefined || v === null || v === "") return "to be decided";
    if (key.startsWith("event.")) return key === "event.duration_hours" ? `${v} hours` : String(v);
    const q = questions.get(key);
    return q ? formatAnswer(q, v) : String(v);
  };
  return (text: string) => text.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/g, (_, k: string) => value(k));
}

function isMissing(ctx: Context, key: string): boolean {
  const v = ctx[key];
  return v === undefined || v === null || v === "";
}

// ------------------------------------------------------------------------------------------------
// Tasks
// ------------------------------------------------------------------------------------------------

function buildTasks(input: EngineInput, fill: (t: string) => string): TaskProposal[] {
  const { playbook, ctx, plan } = input;
  const questions = new Map(playbook.questions.map((q) => [q.key, q]));
  const templates = playbook.taskTemplates.filter((t) => conditionsHold(t.when, ctx));
  const keys = new Set(templates.map((t) => t.key));

  return templates.map((t: TaskTemplate) => {
    let priority = t.priority;
    let shift = 0;
    const notes: string[] = [];
    for (const a of t.adjustments) {
      if (!conditionsHold(a.when, ctx)) continue;
      if (a.priority) priority = a.priority;
      shift += a.shiftDays ?? 0;
      if (a.note) notes.push(fill(a.note));
    }
    const missing = t.requiredInfo.filter((k) => isMissing(ctx, k));
    const missingText = missing.map((k) => questions.get(k)?.text ?? k);
    const description = [fill(t.description), ...notes].join(" ");
    return {
      tempId: t.key,
      title: t.title,
      description: clip(description, 600),
      category: t.category,
      priority,
      due: {
        type: "relative" as const,
        anchor: t.due.anchor,
        offsetDays: Math.max(-365, Math.min(60, t.due.offsetDays + shift)),
        date: "",
      },
      proposedOwner: t.ownerRole,
      dependsOn: t.dependsOn.filter((d) => keys.has(d)),
      requiredInfo: missingText.map((x) => clip(x, 200)).slice(0, 5),
      evidenceIds: [`playbook:task.${t.key}`, ...t.requiredInfo.map((k) => `answer:${k}`)]
        .filter((id) => plan.evidence.has(id))
        .slice(0, 6),
      confidence:
        missing.length > 0
          ? ("low" as const)
          : t.requiredInfo.length
            ? ("high" as const)
            : ("medium" as const),
      uncertainty:
        missing.length > 0
          ? clip(`Waiting for your answer to: ${missingText.join("; ")}`, 300)
          : "",
      nextAction: clip(fill(t.nextAction), 200),
    };
  });
}

// ------------------------------------------------------------------------------------------------
// Budget
// ------------------------------------------------------------------------------------------------

interface BudgetResult {
  categories: PlanOutput["budgetCategories"];
  summary: string;
  total: number;
  /** True when the illustrative total is higher than the budget the organizer entered. */
  overBudget: boolean;
}

function buildBudget(input: EngineInput): BudgetResult {
  const { playbook, event, ctx } = input;
  const ref = playbook.referenceCurrency;
  const lines = playbook.budgetLines.filter((b) => conditionsHold(b.when, ctx));
  if (lines.length === 0) return { categories: [], summary: "", total: 0, overBudget: false };

  if (event.currency !== ref) {
    return {
      categories: lines.map((b) => ({
        name: b.name,
        estimatedAmount: 0,
        note: clip(
          `${b.note} No illustrative amount: the playbook's allowances are in ${ref}, not ${event.currency}.`.trim(),
          300,
        ),
      })),
      summary: `The playbook's illustrative allowances are written in ${ref} and are not converted to ${event.currency}, so no amounts are shown. Ask providers for real quotes.`,
      total: 0,
      overBudget: false,
    };
  }

  const categories = lines.map((b) => {
    let factor = 1;
    for (const a of b.adjustments) if (conditionsHold(a.when, ctx)) factor *= a.multiplier;
    let quantity = 1;
    let basis = "per event";
    if (b.basis === "per_attendee") {
      quantity = event.capacity;
      basis = `${money(b.unitAmount)} ${ref} × ${money(event.capacity)} attendees`;
    } else if (b.basis === "per_group") {
      const size = b.groupSizeKey ? ctx[b.groupSizeKey] : undefined;
      if (typeof size !== "number" || size < 1) {
        return {
          name: b.name,
          estimatedAmount: 0,
          note: clip(`${b.note} Not estimated yet: it depends on the team size.`.trim(), 300),
        };
      }
      quantity = Math.ceil(event.capacity / size);
      basis = `${money(b.unitAmount)} ${ref} × about ${quantity} teams`;
    }
    const raw = b.unitAmount * quantity * factor;
    const amount = Math.round(raw / ROUND_TO) * ROUND_TO;
    const note = [
      b.note,
      `Illustrative allowance (${basis}${factor !== 1 ? `, adjusted ×${factor}` : ""}), not a quote.`,
    ]
      .filter(Boolean)
      .join(" ");
    return { name: b.name, estimatedAmount: amount, note: clip(note, 300) };
  });

  const total = categories.reduce((sum, c) => sum + c.estimatedAmount, 0);
  const budget = event.budget_amount;
  let summary = `Illustrative planning allowances, not quotes: about ${money(total)} ${ref} in total.`;
  let overBudget = false;
  if (budget !== null && budget > 0) {
    const pct = Math.round((total / budget) * 100);
    overBudget = total > budget;
    summary += ` Your budget is ${money(budget)} ${ref}, so these allowances use about ${pct}% of it.`;
    if (overBudget)
      summary += " That is more than your budget: decide what to reduce, or raise the budget.";
  } else {
    summary += " No budget has been set for this event yet.";
  }
  return { categories, summary: clip(summary, 600), total, overBudget };
}

// ------------------------------------------------------------------------------------------------
// Event-day schedule
// ------------------------------------------------------------------------------------------------

function buildSchedule(input: EngineInput, fill: (t: string) => string): PlanOutput["schedule"] {
  const { playbook, event, ctx } = input;
  const start = Date.parse(event.starts_at);
  const total = Math.round((Date.parse(event.ends_at) - start) / 60_000);
  const placed: { at: number; block: PlanOutput["schedule"][number] }[] = [];
  for (const b of playbook.schedule) {
    if (!conditionsHold(b.when, ctx)) continue;
    const at = b.from === "start" ? b.offsetMinutes : total - b.offsetMinutes - b.durationMinutes;
    if (at < 0 || at + b.durationMinutes > total) continue;
    const from = localClock(start + at * 60_000, event.timezone);
    const to = localClock(start + (at + b.durationMinutes) * 60_000, event.timezone);
    placed.push({
      at,
      block: {
        date: from.date,
        start: from.time,
        end: to.time,
        title: b.title,
        note: clip(fill(b.note), 200),
      },
    });
  }
  return placed.sort((a, b) => a.at - b.at).map((p) => p.block);
}

// ------------------------------------------------------------------------------------------------
// Overview
// ------------------------------------------------------------------------------------------------

function buildFollowUps(
  playbook: Playbook,
  missing: MissingInfo[],
): PlanOutput["followUpQuestions"] {
  const questions = new Map(playbook.questions.map((q) => [q.key, q]));
  return missing.slice(0, 5).map((m) => {
    const q = questions.get(m.key);
    return {
      question: clip(q?.text ?? m.label, 200),
      why: clip(q?.why ?? "Edit the event details to answer this.", 300),
    };
  });
}

/** Questions answered "not decided" / "not started" are open decisions in their own right. */
function undecidedAnswers(playbook: Playbook, ctx: Context): string[] {
  const out: string[] = [];
  for (const q of playbook.questions) {
    if (q.type !== "single_choice") continue;
    const v = ctx[q.key];
    if (v !== "not_decided" && v !== "not_started") continue;
    out.push(clip(`${q.text} Currently: ${formatAnswer(q, v).toLowerCase()}.`, 300));
  }
  return out;
}

export function buildPlan(input: EngineInput): PlanOutput {
  const { playbook, event, ctx, plan } = input;
  const fill = textFiller(input);
  const applicable = <T extends { when: Parameters<typeof conditionsHold>[0] }>(items: T[]) =>
    items.filter((x) => conditionsHold(x.when, ctx));

  const lead = daysBetween(plan.today, plan.startDate);
  const short = lead < SHORT_LEAD_DAYS;
  const missing = missingInformation(playbook, ctx);
  const budget = buildBudget(input);

  const assumptions = [
    ...applicable(playbook.assumptions)
      .filter((a) => !a.ifMissing || isMissing(ctx, a.ifMissing))
      .map((a) => fill(a.text)),
    `Dates and times use the event's timezone (${event.timezone}).`,
    "Nothing in this plan has been confirmed with a venue, provider or authority: availability, prices, permits and policies still have to be checked.",
  ];
  if (budget.categories.length > 0)
    assumptions.push(
      "Budget figures are illustrative allowances for planning, not quotes. Replace them with real quotes.",
    );

  const decisions = [
    ...undecidedAnswers(playbook, ctx),
    ...applicable(playbook.decisions)
      .filter((d) => !d.ifMissing || isMissing(ctx, d.ifMissing))
      .map((d) => fill(d.text)),
  ];
  if (budget.overBudget)
    decisions.push(
      "Decide how to bring the estimated costs within your budget, or raise the budget.",
    );
  if (event.budget_amount === null && budget.categories.length > 0)
    decisions.push("Set a budget for the event so costs can be compared with it.");

  const risks: PlanOutput["risks"] = applicable(playbook.riskCategories).map((r) => ({
    title: clip(r.label, 100),
    mitigation: clip(fill(r.mitigation), 200),
    likelihood:
      r.elevatedWhen.length > 0 && conditionsHold(r.elevatedWhen, ctx) ? "high" : r.likelihood,
    contingency: clip(fill(r.contingency), 200),
  }));
  if (short) {
    risks.push({
      title: COMPUTED_RISK_TITLES.shortLead,
      mitigation: `Only ${Math.max(lead, 0)} day${lead === 1 ? "" : "s"} remain before the first day: do the critical tasks first and drop what isn't essential.`,
      likelihood: "high",
      contingency:
        "If the venue, approvals or key providers can't be confirmed in time, reduce the scope or move the date.",
    });
  }
  if (budget.overBudget) {
    risks.push({
      title: COMPUTED_RISK_TITLES.overBudget,
      mitigation:
        "Compare the illustrative allowances with real quotes and cut or reduce the largest lines first.",
      likelihood: "medium",
      contingency:
        "Look for sponsors, a smaller venue or fewer attendees before committing to any supplier.",
    });
  }
  risks.sort((a, b) => LIKELIHOOD_RANK[a.likelihood] - LIKELIHOOD_RANK[b.likelihood]);

  const requirements = applicable(playbook.requirements).map((r) => fill(r.text));
  if (short)
    assumptions.push(
      `The event starts in ${Math.max(lead, 0)} days, so deadlines that would already have passed are moved to today.`,
    );

  return {
    summary: clip(
      `${fill(playbook.summary)}${short ? ` The first day is close (${Math.max(lead, 0)} days away), so this plan is compressed.` : ""}`,
      800,
    ),
    goals: applicable(playbook.goals)
      .map((g) => fill(g.text))
      .slice(0, 12),
    requirements: requirements.slice(0, 20),
    missingInformation: missing.map((m) => m.label).slice(0, 10),
    decisions: decisions.slice(0, 20),
    followUpQuestions: buildFollowUps(playbook, missing),
    budgetCategories: budget.categories.slice(0, 20),
    budgetSummary: budget.summary,
    risks: risks.slice(0, 20),
    schedule: buildSchedule(input, fill),
    tasks: buildTasks(input, fill),
    assumptions: assumptions.slice(0, 20),
    // Template plans don't read the free-text details, so they never report conflicts.
    conflicts: [],
  };
}
