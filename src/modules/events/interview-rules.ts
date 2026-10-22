import { z } from "zod";
import { QuestionKey, type Condition, type Playbook, type Question } from "@/modules/ai/playbook";
import type { EventStatus } from "./schemas";

/**
 * Adaptive interview, deterministic part (event.md §6.4). The first round comes from playbook
 * conditions only; AI follow-ups (P3) are added on top and stored under `custom.*` keys.
 * Pure functions: no I/O, unit-tested in tests/unit/events/interview.test.ts.
 */

/** A stored answer. `null` = the organizer skipped an optional question. */
export const AnswerValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);
export type AnswerValue = z.infer<typeof AnswerValue>;
export type Answers = Record<string, AnswerValue>;
export type Context = Record<string, AnswerValue | undefined>;

/** New questions shown per round (event.md §6.2 interview post-rule). */
export const ROUND_SIZE = 5;

/** Answers can be changed while the event is still being planned. Mirrored in save_interview_answers(). */
export const INTERVIEW_EDITABLE_STATUSES: readonly EventStatus[] = ["draft", "planning", "ready"];
export const interviewEditable = (status: EventStatus) =>
  INTERVIEW_EDITABLE_STATUSES.includes(status);

export function eventContext(e: {
  venue_type: string | null;
  capacity: number;
  starts_at: string;
  ends_at: string;
  city: string | null;
  budget_amount: number | null;
}): Context {
  return {
    "event.venue_type": e.venue_type,
    "event.capacity": e.capacity,
    "event.duration_hours": Math.floor(
      (Date.parse(e.ends_at) - Date.parse(e.starts_at)) / 3_600_000,
    ),
    "event.city": e.city,
    "event.budget_amount": e.budget_amount,
  };
}

/** `undefined` (not answered yet) never satisfies a condition; `null` (skipped / not set) is a value. */
export function conditionHolds(c: Condition, ctx: Context): boolean {
  const v = ctx[c.key];
  if (v === undefined) return false;
  const scalar = v !== null && !Array.isArray(v);
  switch (c.op) {
    case "equals":
      return v === c.value;
    case "in":
      return scalar && c.values.includes(v);
    case "not_in":
      return !(scalar && c.values.includes(v));
    case "includes":
      return Array.isArray(v) && v.includes(c.value);
    case "gte":
      return typeof v === "number" && v >= c.value;
  }
}

export const conditionsHold = (when: readonly Condition[], ctx: Context) =>
  when.every((c) => conditionHolds(c, ctx));
const applies = (q: Question, ctx: Context) => conditionsHold(q.when, ctx);

/** Event facts plus the answers that currently apply: the context for plan-level conditions. */
export function answerContext(event: Context, state: InterviewState): Context {
  const ctx: Context = { ...event };
  for (const a of state.answered) ctx[a.question.key] = a.value;
  return ctx;
}

/** The playbook plus organizer-visible AI follow-up questions (custom.*, no conditions), asked last. */
export function withFollowUps(playbook: Playbook, followUps: Question[]): Playbook {
  return followUps.length
    ? { ...playbook, questions: [...playbook.questions, ...followUps] }
    : playbook;
}

export interface InterviewState {
  /** Applicable questions that have an answer, in playbook order. */
  answered: { question: Question; value: AnswerValue }[];
  /** The next round: up to ROUND_SIZE applicable, unanswered questions. */
  next: Question[];
  /** Stored playbook answers whose question no longer applies (or no longer exists). */
  stale: string[];
  /** No applicable question is unanswered. Later answers can't unlock more without a change. */
  complete: boolean;
}

/**
 * Walks the playbook in order. A question's conditions see only event facts and answers to
 * earlier questions that themselves apply, so a changed answer hides its whole dependent chain.
 */
export function interviewState(
  playbook: Playbook,
  event: Context,
  stored: Answers,
): InterviewState {
  const ctx: Context = { ...event };
  const answered: InterviewState["answered"] = [];
  const unanswered: Question[] = [];
  for (const q of playbook.questions) {
    if (!applies(q, ctx)) continue;
    if (Object.hasOwn(stored, q.key)) {
      ctx[q.key] = stored[q.key];
      answered.push({ question: q, value: stored[q.key] });
    } else {
      unanswered.push(q);
    }
  }
  const live = new Set(answered.map((a) => a.question.key));
  return {
    answered,
    next: unanswered.slice(0, ROUND_SIZE),
    // custom.* answers belong to AI follow-ups (P3), not to the playbook.
    stale: Object.keys(stored).filter((k) => !live.has(k) && !k.startsWith("custom.")),
    complete: unanswered.length === 0,
  };
}

const RawValues = z.array(z.string().max(2000)).max(20);

function valueSchema(q: Question): z.ZodType<Exclude<AnswerValue, null>> {
  const choose = { message: "Choose one of the listed options." };
  switch (q.type) {
    case "single_choice":
      return z.enum(q.options.map((o) => o.value) as [string, ...string[]], choose);
    case "multi_choice":
      return z
        .array(z.enum(q.options.map((o) => o.value) as [string, ...string[]], choose))
        .max(q.options.length)
        .transform((a) => [...new Set(a)]);
    case "boolean":
      return z.enum(["yes", "no"], choose).transform((v) => v === "yes");
    case "number": {
      const range = { message: `Enter a whole number from ${q.min} to ${q.max}.` };
      return z.coerce.number(range).int(range).min(q.min, range).max(q.max, range);
    }
    case "text":
      return z.string().max(q.maxLength, { message: `Use at most ${q.maxLength} characters.` });
  }
}

/** Validates one form answer (all form values for the field). Blank optional answers → null. */
export function parseAnswer(
  q: Question,
  raw: unknown,
): { ok: true; value: AnswerValue } | { ok: false; message: string } {
  const values = RawValues.safeParse(raw ?? []);
  if (!values.success) return { ok: false, message: "That answer isn't valid." };
  const given = values.data.map((s) => s.trim()).filter(Boolean);
  if (given.length === 0) {
    return q.required ? { ok: false, message: "Answer this question." } : { ok: true, value: null };
  }
  const r = valueSchema(q).safeParse(q.type === "multi_choice" ? given : given.at(-1));
  return r.success
    ? { ok: true, value: r.data }
    : { ok: false, message: r.error.issues[0].message };
}

const RoundKeys = z.array(QuestionKey).min(1).max(100);
const OUT_OF_DATE = "This form is out of date. Reload the page and try again.";

/**
 * Validates a submitted round. `raw` maps field names to every submitted value; `raw.round` lists
 * the question keys the form showed. Only questions that apply — given the submitted answers
 * merged over the stored ones — are saved; answers whose question stopped applying are returned
 * in `removeKeys`.
 */
export function parseSubmission(
  playbook: Playbook,
  event: Context,
  stored: Answers,
  raw: Record<string, unknown>,
):
  | { ok: true; answers: Answers; removeKeys: string[] }
  | { ok: false; fieldErrors: Record<string, string[]> } {
  const keys = RoundKeys.safeParse(raw.round);
  const known = new Set(playbook.questions.map((q) => q.key));
  if (!keys.success || !keys.data.every((k) => known.has(k))) {
    return { ok: false, fieldErrors: { form: [OUT_OF_DATE] } };
  }
  const round = new Set(keys.data);
  const ctx: Context = { ...event };
  const answers: Answers = {};
  const fieldErrors: Record<string, string[]> = {};
  for (const q of playbook.questions) {
    if (!applies(q, ctx)) continue;
    if (round.has(q.key)) {
      const r = parseAnswer(q, raw[q.key]);
      if (!r.ok) {
        fieldErrors[q.key] = [r.message];
        continue;
      }
      answers[q.key] = r.value;
      ctx[q.key] = r.value;
    } else if (Object.hasOwn(stored, q.key)) {
      ctx[q.key] = stored[q.key];
    }
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };
  if (Object.keys(answers).length === 0) return { ok: false, fieldErrors: { form: [OUT_OF_DATE] } };
  const { stale } = interviewState(playbook, event, { ...stored, ...answers });
  return { ok: true, answers, removeKeys: stale };
}

/** Human-readable answer for summaries. */
export function formatAnswer(q: Question, value: AnswerValue): string {
  if (value === null) return "Skipped";
  const label = (v: string) =>
    q.type === "single_choice" || q.type === "multi_choice"
      ? (q.options.find((o) => o.value === v)?.label ?? v)
      : v;
  if (Array.isArray(value)) return value.length ? value.map(label).join(", ") : "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number")
    return q.type === "number" && q.unit ? `${value} ${q.unit}` : String(value);
  return label(value);
}
