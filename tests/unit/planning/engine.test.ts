import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  answerContext,
  eventContext,
  interviewState,
  type Answers,
} from "@/modules/events/interview-rules";
import { EventType } from "@/modules/events/schemas";
import { buildPlan, type EngineEvent } from "@/modules/planning/engine";
import { PlanOutput } from "@/modules/planning/schemas";
import { evidenceCatalog, planContext, resolvePlan, validatePlan } from "@/modules/planning/rules";
import { playbookFor } from "@/playbooks";

const NOW = new Date("2026-10-23T08:00:00Z");

const baseEvent: EngineEvent & { venue_type: string | null } = {
  name: "Test Event",
  venue_type: "indoor",
  capacity: 120,
  starts_at: "2027-03-10T05:00:00Z", // 09:00 Dubai
  ends_at: "2027-03-11T05:00:00Z", // 24 h
  city: "Dubai",
  budget_amount: null,
  timezone: "Asia/Dubai",
  currency: "AED",
};

function plan(
  type: EventType,
  answers: Answers = {},
  over: Partial<typeof baseEvent> = {},
  now = NOW,
) {
  const playbook = playbookFor(type);
  const event = { ...baseEvent, ...over };
  const state = interviewState(playbook, eventContext(event), answers);
  const ctx = answerContext(eventContext(event), state);
  const pctx = planContext(event, evidenceCatalog(playbook, ctx, state), now);
  const out = buildPlan({ playbook, event, ctx, plan: pctx });
  return { out, pctx, playbook, resolved: resolvePlan(out.tasks, pctx) };
}

const HACK_FULL: Answers = {
  "audience.level": "school_students",
  "audience.min_age": 14,
  "audience.guardian_consent": "not_decided",
  "format.team_size": 4,
  "format.overnight": true,
  "format.overnight_supervision": "school_staff",
  "venue.on_campus": true,
  "venue.campus_booking": "requested",
  "catering.provided": true,
  "catering.dietary": ["halal", "nut_free"],
  "prizes.offered": true,
  "prizes.kind": ["cash"],
  "sponsors.expected": true,
  "ip.ownership": "not_decided",
  "media.photography": true,
  "media.consent": "registration_checkbox",
  "accessibility.ask_needs": true,
};
const CONF_FULL: Answers = {
  "audience.kind": "public",
  "program.tracks": 3,
  "program.speakers": 24,
  "program.keynote": true,
  "international.speakers": true,
  "venue.status": "requested",
  "registration.ticketed": true,
  "catering.provided": true,
  "catering.dietary": ["halal"],
  "sponsors.expected": true,
  "exhibition.booths": true,
  "media.recording": true,
  "media.consent": "not_decided",
  "accessibility.ask_needs": true,
};
const WORK_FULL: Answers = {
  "learners.level": "beginner",
  "session.format": "hands_on",
  "facilitators.count": 2,
  "audience.minors": true,
  "venue.status": "confirmed_in_writing",
  "materials.needed": ["laptops", "handouts", "software"],
  "prerequisites.required": true,
  "registration.fee": true,
  "catering.provided": true,
  "certificate.issued": true,
  "feedback.collect": true,
  "accessibility.ask_needs": true,
};
const CASES: [EventType, Answers][] = [
  ["university_hackathon", HACK_FULL],
  ["university_hackathon", {}],
  ["conference", CONF_FULL],
  ["conference", {}],
  ["workshop", WORK_FULL],
  ["workshop", {}],
];

const keys = (p: ReturnType<typeof plan>) => new Set(p.out.tasks.map((t) => t.tempId));

describe("different event types", () => {
  const hack = plan("university_hackathon", HACK_FULL);
  const conf = plan("conference", CONF_FULL);
  const work = plan("workshop", WORK_FULL);

  it("produce meaningfully different tasks, budgets, schedules and risks", () => {
    const sets = [keys(hack), keys(conf), keys(work)];
    // Each type has tasks the others do not have.
    expect(sets[0].has("overnight_plan") && !sets[1].has("overnight_plan")).toBe(true);
    expect(sets[1].has("call_for_speakers") && !sets[0].has("call_for_speakers")).toBe(true);
    expect(sets[2].has("define_outcomes") && !sets[0].has("define_outcomes")).toBe(true);
    for (const [a, b] of [
      [0, 1],
      [0, 2],
      [1, 2],
    ] as const) {
      const shared = [...sets[a]].filter((k) => sets[b].has(k));
      expect(shared.length / Math.min(sets[a].size, sets[b].size)).toBeLessThan(0.6);
    }
    const names = (p: typeof hack) => p.out.budgetCategories.map((b) => b.name).join("|");
    expect(names(hack)).toContain("Prizes");
    expect(names(conf)).toContain("Speaker costs");
    expect(names(work)).toContain("Facilitator fees");
    const titles = (p: typeof hack) => p.out.schedule.map((s) => s.title).join("|");
    expect(titles(hack)).toContain("Hacking starts");
    expect(titles(conf)).toContain("Keynote");
    expect(titles(work)).toContain("Hands-on practice");
    expect(hack.out.summary).toContain("hackathon");
    expect(conf.out.summary).toContain("conference");
    expect(work.out.summary).toContain("workshop");
    expect(hack.out.risks.map((r) => r.title)).not.toEqual(conf.out.risks.map((r) => r.title));
  });
});

describe("interview answers change the plan", () => {
  it("overnight and minors add tasks, raise priorities, and shape schedule and budget", () => {
    const day = plan("university_hackathon", {
      ...HACK_FULL,
      "format.overnight": false,
      "audience.level": "university_students",
    });
    const night = plan("university_hackathon", HACK_FULL);
    expect(keys(day).has("overnight_plan")).toBe(false);
    expect(keys(night).has("overnight_plan")).toBe(true);
    expect(keys(day).has("guardian_consent")).toBe(false);
    expect(keys(night).has("guardian_consent")).toBe(true);
    const priority = (p: typeof night, k: string) =>
      p.out.tasks.find((t) => t.tempId === k)?.priority;
    expect(priority(night, "safety_plan")).toBe("critical"); // minors present
    expect(priority(day, "safety_plan")).toBe("high");
    expect(night.out.schedule.map((s) => s.title)).toEqual(
      expect.arrayContaining(["Quiet hours begin", "Breakfast"]),
    );
    expect(day.out.schedule.map((s) => s.title)).not.toContain("Quiet hours begin");
    const amount = (p: typeof night, name: string) =>
      p.out.budgetCategories.find((b) => b.name === name)?.estimatedAmount ?? 0;
    expect(amount(night, "Food and drink")).toBeGreaterThan(amount(day, "Food and drink"));
    expect(night.out.budgetCategories.map((b) => b.name)).toContain("Overnight security");
    expect(day.out.budgetCategories.map((b) => b.name)).not.toContain("Overnight security");
  });

  it("answers appear in task text, requirements and decisions", () => {
    const p = plan("university_hackathon", HACK_FULL);
    const catering = p.out.tasks.find((t) => t.tempId === "book_catering")!;
    expect(catering.priority).toBe("critical"); // overnight
    expect(p.out.requirements.join(" ")).toMatch(/Halal, Nut-free/);
    expect(p.out.requirements.join(" ")).toContain("minimum age 14");
    // "not decided" answers become open decisions.
    expect(p.out.decisions.join(" ")).toMatch(/guardian consent/i);
    expect(p.out.decisions.join(" ")).toMatch(/ownership|own/i);
    expect(p.out.risks.find((r) => r.title === "Participants under 18")?.likelihood).toBe("high");
  });

  it("capacity, venue type and budget change timing, costs and warnings", () => {
    const small = plan("university_hackathon", HACK_FULL, { capacity: 60 });
    const large = plan("university_hackathon", HACK_FULL, { capacity: 400 });
    const due = (p: typeof small, k: string) => p.resolved.find((t) => t.tempId === k)!.dueDate;
    expect(due(large, "book_catering") < due(small, "book_catering")).toBe(true);
    const total = (p: typeof small) =>
      p.out.budgetCategories.reduce((s, b) => s + b.estimatedAmount, 0);
    expect(total(large)).toBeGreaterThan(total(small));

    const online = plan("university_hackathon", HACK_FULL, { venue_type: "online" });
    expect(keys(online).has("setup_online_platform")).toBe(true);
    expect(online.out.schedule.map((s) => s.title)).toContain("Platform opens and sound check");

    const tight = plan("university_hackathon", HACK_FULL, { budget_amount: 5000 });
    expect(tight.out.budgetSummary).toMatch(/more than your budget/);
    expect(tight.out.risks.map((r) => r.title)).toContain("Estimated costs exceed the budget");
    expect(tight.out.decisions.join(" ")).toMatch(/within your budget/);
  });

  it("a short lead time compresses the plan and says so", () => {
    const soon = plan("university_hackathon", HACK_FULL, {}, new Date("2027-03-01T08:00:00Z"));
    expect(soon.out.risks.map((r) => r.title)).toContain("Short lead time");
    expect(soon.out.summary).toMatch(/close/);
    expect(soon.resolved.some((t) => t.warnings.some((w) => /already passed/.test(w)))).toBe(true);
  });
});

describe("missing optional details", () => {
  it.each(["university_hackathon", "conference", "workshop"] as const)(
    "%s: an empty interview still gives a useful, valid draft",
    (type) => {
      const p = plan(type, {});
      expect(p.out.tasks.length).toBeGreaterThanOrEqual(6);
      expect(p.out.summary.length).toBeGreaterThan(30);
      expect(p.out.schedule.length).toBeGreaterThan(2);
      expect(p.out.risks.length).toBeGreaterThan(1);
      expect(p.out.assumptions.length).toBeGreaterThan(2);
      expect(PlanOutput.safeParse(p.out).success).toBe(true);
      expect(validatePlan(p.out, p.pctx)).toEqual([]);
    },
  );

  it("asks only the few follow-up questions that matter, and states assumptions for them", () => {
    const p = plan("university_hackathon", {});
    expect(p.out.followUpQuestions.length).toBeGreaterThan(0);
    expect(p.out.followUpQuestions.length).toBeLessThanOrEqual(5);
    expect(p.out.missingInformation.length).toBeGreaterThan(0);
    expect(p.out.assumptions.join(" ")).toMatch(/university students only/);
    // Tasks that need an unanswered question say so and have low confidence.
    const waiting = p.out.tasks.filter((t) => t.confidence === "low");
    expect(waiting.length).toBeGreaterThan(0);
    expect(waiting[0].uncertainty).toMatch(/Waiting for your answer/);
    // Answering removes the assumption and the question.
    const answered = plan("university_hackathon", HACK_FULL);
    expect(answered.out.assumptions.join(" ")).not.toMatch(/university students only/);
    expect(answered.out.followUpQuestions).toEqual([]);
  });

  it("works with no city, no budget and no venue type", () => {
    const p = plan("workshop", {}, { city: null, budget_amount: null, venue_type: null });
    expect(p.out.tasks.length).toBeGreaterThan(5);
    expect(validatePlan(p.out, p.pctx)).toEqual([]);
  });
});

describe("assumptions and estimates are labelled", () => {
  it("never present budget amounts as quotes and always list what is unconfirmed", () => {
    for (const [type, answers] of CASES) {
      const p = plan(type, answers);
      const text = JSON.stringify(p.out).replace(
        /Nothing in this plan has been confirmed[^"]*/,
        "",
      );
      if (p.out.budgetCategories.length > 0) {
        expect(p.out.budgetSummary).toMatch(/Illustrative planning allowances, not quotes/);
        for (const b of p.out.budgetCategories)
          if (b.estimatedAmount > 0) expect(b.note).toMatch(/Illustrative allowance/);
        expect(p.out.assumptions.join(" ")).toMatch(/illustrative allowances/);
      }
      expect(p.out.assumptions.join(" ")).toMatch(/Nothing in this plan has been confirmed/);
      // The engine never claims availability, approvals or bookings.
      expect(text).not.toMatch(
        /\b(is|are|has been|have been) (available|confirmed|booked|approved)\b/i,
      );
      expect(text).not.toMatch(/https?:\/\//);
    }
  });

  it("shows no amounts when the event currency differs from the playbook's reference currency", () => {
    const p = plan("university_hackathon", HACK_FULL, { currency: "USD" });
    expect(p.out.budgetCategories.every((b) => b.estimatedAmount === 0)).toBe(true);
    expect(p.out.budgetSummary).toMatch(/not converted to USD/);
  });

  it("the plan never cites sources it was not given", () => {
    const p = plan("conference", CONF_FULL);
    for (const t of p.out.tasks)
      for (const id of t.evidenceIds) expect(p.pctx.evidence.has(id)).toBe(true);
  });
});

describe("task dependencies and schedules", () => {
  it.each(CASES)(
    "%s: dependencies are acyclic, known and never due later than their task",
    (type, answers) => {
      const p = plan(type, answers);
      expect(validatePlan(p.out, p.pctx)).toEqual([]);
      const due = new Map(p.resolved.map((t) => [t.tempId, t.dueDate]));
      for (const t of p.resolved) {
        for (const d of t.dependsOn) expect(due.has(d), `${t.tempId} → ${d}`).toBe(true);
        expect(
          t.warnings.filter((w) => /before the task it depends on/.test(w)),
          t.tempId,
        ).toEqual([]);
        for (const d of t.dependsOn)
          expect(due.get(d)! <= t.dueDate, `${t.tempId} after ${d}`).toBe(true);
      }
      // Pre-event tasks fall before the first day; close-out is after the last day.
      for (const t of p.resolved) {
        if (t.due.anchor === "event_start") expect(t.dueDate <= "2027-03-10").toBe(true);
        else expect(t.dueDate >= "2027-03-11").toBe(true);
      }
    },
  );

  it.each(CASES)("%s: the event-day schedule is ordered and inside the event", (type, answers) => {
    const p = plan(type, answers);
    const s = p.out.schedule;
    const at = (d: string, t: string) => `${d}T${t}`;
    for (let i = 0; i < s.length; i++) {
      expect(at(s[i].date, s[i].start) >= "2027-03-10T09:00").toBe(true);
      if (i > 0) expect(at(s[i].date, s[i].start) >= at(s[i - 1].date, s[i - 1].start)).toBe(true);
      expect(s[i].date <= "2027-03-11").toBe(true);
    }
    // The last block ends when the event ends (24 h later, same wall-clock time).
    const last = s[s.length - 1];
    expect(last.date + last.end <= "2027-03-1109:00").toBe(true);
  });

  it("short events drop blocks that do not fit", () => {
    const short = plan("conference", CONF_FULL, { ends_at: "2027-03-10T07:00:00Z" }); // 2 h
    expect(short.out.schedule.length).toBeLessThan(
      plan("conference", CONF_FULL).out.schedule.length,
    );
    expect(short.out.schedule.every((b) => b.end <= "11:00")).toBe(true);
  });

  it("every playbook's template dependencies stay in order even with all adjustments applied", () => {
    for (const type of EventType.options) {
      const pb = playbookFor(type);
      const tpl = new Map(pb.taskTemplates.map((t) => [t.key, t]));
      const earliest = (key: string) => {
        const t = tpl.get(key)!;
        const shifts = t.adjustments.reduce((n, a) => n + Math.min(a.shiftDays ?? 0, 0), 0);
        return t.due.offsetDays + shifts;
      };
      const latest = (key: string) => tpl.get(key)!.due.offsetDays;
      for (const t of pb.taskTemplates)
        for (const d of t.dependsOn) {
          const dep = tpl.get(d)!;
          if (dep.due.anchor !== t.due.anchor) {
            expect(dep.due.anchor, `${type}: ${t.key} ← ${d}`).toBe("event_start");
            continue;
          }
          expect(latest(d) <= earliest(t.key), `${type}: ${t.key} ← ${d}`).toBe(true);
        }
    }
  });
});

describe("no external AI provider", () => {
  const root = join(__dirname, "../../..");
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
    );

  it("AI provider code lives only in the gateway (src/lib/ai) and the env schema; no SDKs", () => {
    const files = walk(join(root, "src")).filter((f) => /\.(ts|tsx|mts)$/.test(f));
    const rel = (f: string) => f.slice(root.length + 1);
    const allowed = (f: string) =>
      rel(f).startsWith("src/lib/ai/") || rel(f) === "src/lib/env.server.ts";
    const providerCode =
      /api\.cloudflare\.com|CLOUDFLARE_|AI_PROVIDER|AI_PLAN_MODEL|createCloudflareProvider/;
    expect(
      files.filter((f) => !allowed(f) && providerCode.test(readFileSync(f, "utf8"))).map(rel),
    ).toEqual([]);
    // Removed providers and every AI SDK stay out of the whole tree.
    const banned =
      /generativelanguage\.googleapis|api\.groq\.com|api\.x\.ai|api\.anthropic\.com|openrouter\.ai|api\.openai\.com|GEMINI_|GROQ_|XAI_|@google\/genai|@anthropic-ai|openai/i;
    expect(files.filter((f) => banned.test(readFileSync(f, "utf8"))).map(rel)).toEqual([]);
  });

  it("no page or component shows provider names, debug output or unfinished-section copy", () => {
    const ui = [...walk(join(root, "src/app")), ...walk(join(root, "src/components"))].filter(
      (f) => /\.tsx?$/.test(f) && !f.includes("design-system"),
    );
    const banned =
      /Gemini|Groq|Grok|OpenRouter|\bAI\b|[Mm]ock mode|debugger|console\.log|lorem ipsum|TODO|FIXME|arrives in P\d|isn.t built yet/;
    const hits = ui.filter((f) => banned.test(readFileSync(f, "utf8")));
    expect(hits.map((f) => f.slice(root.length + 1))).toEqual([]);
  });

  it("package.json has no AI SDK dependency and .env.example no AI variables", () => {
    const pkg = readFileSync(join(root, "package.json"), "utf8");
    expect(pkg).not.toMatch(/genai|anthropic|openai|groq|generative-ai/i);
    expect(readFileSync(join(root, ".env.example"), "utf8")).not.toMatch(/GEMINI|GROQ|XAI_/);
  });
});
