import { describe, expect, it } from "vitest";
import { PlaybookSchema, findCycle } from "@/modules/planning/playbook";
import {
  addDays,
  evidenceCatalog,
  isRealDate,
  localDate,
  missingInformation,
  planContext,
  resolvePlan,
  validatePlan,
  type PlanContext,
} from "@/modules/planning/rules";
import { buildPlan } from "@/modules/planning/engine";
import { PlanOutput, type TaskProposal } from "@/modules/planning/schemas";
import {
  answerContext,
  eventContext,
  interviewState,
  type Answers,
} from "@/modules/events/interview-rules";
import { playbookFor } from "@/playbooks";
import raw from "../../../playbooks/university-hackathon.json";

const playbook = playbookFor("university_hackathon");
const event = {
  venue_type: "indoor",
  capacity: 150,
  starts_at: "2026-12-10T05:00:00Z", // 09:00 Dubai
  ends_at: "2026-12-11T14:00:00Z",
  city: "Dubai",
  budget_amount: 20000,
  timezone: "Asia/Dubai",
};
const ectx = eventContext(event);
const answers: Answers = {
  "audience.level": "school_students",
  "audience.min_age": 14,
  "audience.guardian_consent": "organizer",
  "format.team_size": 4,
  "format.overnight": true,
  "format.overnight_supervision": "school_staff",
  "venue.on_campus": true,
  "venue.campus_booking": "requested",
  "catering.provided": true,
  "catering.dietary": ["halal", "vegetarian"],
  "prizes.offered": false,
  "sponsors.expected": true,
  "ip.ownership": "participants",
  "media.photography": true,
  "media.consent": "registration_checkbox",
  "accessibility.ask_needs": true,
};
const state = interviewState(playbook, ectx, answers);
const actx = answerContext(ectx, state);
const evidence = evidenceCatalog(playbook, actx, state);
const ctx: PlanContext = planContext(event, evidence, new Date("2026-10-22T08:00:00Z"));

const task = (over: Partial<TaskProposal> = {}): TaskProposal => ({
  tempId: "a_task",
  title: "Do something",
  description: "Details",
  category: "logistics",
  priority: "medium",
  due: { type: "relative", anchor: "event_start", offsetDays: -10, date: "" },
  proposedOwner: "Lead organizer",
  dependsOn: [],
  requiredInfo: [],
  evidenceIds: [],
  confidence: "medium",
  uncertainty: "",
  nextAction: "Start",
  ...over,
});

describe("playbook file", () => {
  it("playbooks/university-hackathon.json is valid and has every section", () => {
    const p = PlaybookSchema.parse(raw);
    expect(p.taskTemplates.length).toBeGreaterThan(10);
    expect(p.riskCategories.length).toBeGreaterThan(3);
    expect(p.requiredForPlan.length).toBeGreaterThan(3);
    expect(p.complianceTopics.length).toBeGreaterThan(3);
    expect(p.providerCategories.length).toBeGreaterThan(2);
  });

  it("can't label a compliance topic verified (that needs a verified source, P5)", () => {
    const bad = structuredClone(raw) as { complianceTopics: { confidence: string }[] };
    bad.complianceTopics[0].confidence = "verified_source";
    expect(PlaybookSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects template cycles, unknown dependencies, questions and risks", () => {
    const withTemplates = (taskTemplates: unknown[]) =>
      PlaybookSchema.safeParse({ ...raw, taskTemplates });
    const t = (key: string, dependsOn: string[], extra = {}) => ({
      key,
      title: "Title",
      description: "Desc",
      category: "logistics",
      priority: "low",
      due: { anchor: "event_start", offsetDays: -1 },
      ownerRole: "Lead",
      nextAction: "Go",
      dependsOn,
      ...extra,
    });
    const messages = (r: ReturnType<typeof withTemplates>) =>
      r.error?.issues.map((i) => i.message) ?? [];
    expect(messages(withTemplates([t("aa", ["bb"]), t("bb", ["aa"])]))).toContain(
      "Dependency cycle: aa → bb → aa",
    );
    expect(messages(withTemplates([t("aa", ["zz"])]))).toContain("zz is not a task template");
    expect(messages(withTemplates([t("aa", ["aa"])]))).toContain("aa depends on itself");
    expect(messages(withTemplates([t("aa", [], { requiredInfo: ["nope.key"] })]))).toContain(
      "nope.key is not a question",
    );
    expect(messages(withTemplates([t("aa", [], { risks: ["ghost"] })]))).toContain(
      "ghost is not a risk category",
    );
  });

  it("findCycle finds cycles and ignores edges to unknown ids", () => {
    expect(
      findCycle([
        { id: "a", dependsOn: ["b"] },
        { id: "b", dependsOn: ["c"] },
        { id: "c", dependsOn: ["a"] },
      ]),
    ).toEqual(["a", "b", "c", "a"]);
    expect(findCycle([{ id: "a", dependsOn: ["x"] }])).toBeNull();
  });
});

describe("dates", () => {
  it("resolves calendar dates in the event timezone", () => {
    expect(localDate("2026-12-09T21:00:00Z", "Asia/Dubai")).toBe("2026-12-10");
    expect(addDays("2026-12-10", -40)).toBe("2026-10-31");
    expect(isRealDate("2026-02-29")).toBe(false);
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(ctx).toMatchObject({
      startDate: "2026-12-10",
      endDate: "2026-12-11",
      today: "2026-10-22",
    });
  });
});

describe("validatePlan", () => {
  const overview = {
    summary: "A two-day hackathon for students.",
    goals: [],
    requirements: [],
    missingInformation: [],
    decisions: [],
    followUpQuestions: [],
    budgetCategories: [],
    budgetSummary: "",
    risks: [],
    schedule: [],
  };
  const plan = (tasks: TaskProposal[], assumptions: string[] = []) => ({
    ...overview,
    tasks,
    assumptions,
  });

  it("accepts a well-formed plan", () => {
    expect(
      validatePlan(plan([task(), task({ tempId: "b_task", dependsOn: ["a_task"] })]), ctx),
    ).toEqual([]);
  });

  it("rejects unknown, self and cyclic dependencies and duplicate ids", () => {
    const errors = validatePlan(
      plan([
        task({ tempId: "a_task", dependsOn: ["b_task"] }),
        task({ tempId: "b_task", dependsOn: ["a_task", "ghost"] }),
        task({ tempId: "c_task", dependsOn: ["c_task"] }),
        task({ tempId: "c_task" }),
      ]),
      ctx,
    ).join("\n");
    expect(errors).toMatch(/"ghost" is not a tempId/);
    expect(errors).toMatch(/can't depend on itself/);
    expect(errors).toMatch(/dependency cycle a_task → b_task → a_task/);
    expect(errors).toMatch(/duplicate id "c_task"/);
  });

  it("rejects malformed, impossible, past and far-future dates", () => {
    const due = (date: string) =>
      task({ due: { type: "date", anchor: "event_start", offsetDays: 0, date } });
    expect(validatePlan(plan([due("2026/11/01")]), ctx).join()).toMatch(
      /not a real YYYY-MM-DD date/,
    );
    expect(validatePlan(plan([due("2026-11-31")]), ctx).join()).toMatch(/not a real/);
    expect(validatePlan(plan([due("2026-10-01")]), ctx).join()).toMatch(/in the past/);
    expect(validatePlan(plan([due("2027-06-01")]), ctx).join()).toMatch(/more than 60 days after/);
    expect(validatePlan(plan([due("2026-11-20")]), ctx)).toEqual([]);
  });

  it("rejects evidence ids that weren't supplied and any URL (no invented sources)", () => {
    expect(validatePlan(plan([task({ evidenceIds: ["answer:audience.level"] })]), ctx)).toEqual([]);
    expect(
      validatePlan(plan([task({ evidenceIds: ["source:dubai-law-123"] })]), ctx).join(),
    ).toMatch(/not one of the supplied evidence ids/);
    expect(
      validatePlan(plan([task({ description: "See https://dubai.gov.ae/permits" })]), ctx).join(),
    ).toMatch(/URLs/);
    expect(
      validatePlan(plan([task({ nextAction: "Check www.example.ae for forms" })]), ctx).join(),
    ).toMatch(/URLs/);
    expect(validatePlan(plan([task()], ["Per http://x.y"]), ctx).join()).toMatch(/assumptions/);
  });

  it("the schema rejects invalid enum values, bad ids and oversize plans", () => {
    const valid = plan([task()]);
    expect(PlanOutput.safeParse(valid).success).toBe(true);
    expect(PlanOutput.safeParse(plan([task({ priority: "urgent" as never })])).success).toBe(false);
    expect(PlanOutput.safeParse(plan([task({ category: "parties" as never })])).success).toBe(
      false,
    );
    expect(PlanOutput.safeParse(plan([task({ confidence: "certain" as never })])).success).toBe(
      false,
    );
    expect(PlanOutput.safeParse(plan([task({ tempId: "Bad Id" })])).success).toBe(false);
    expect(
      PlanOutput.safeParse(
        plan([
          task({ due: { type: "relative", anchor: "event_start", offsetDays: 1.5, date: "" } }),
        ]),
      ).success,
    ).toBe(false);
    expect(
      PlanOutput.safeParse(plan(Array.from({ length: 41 }, (_, i) => task({ tempId: `t_${i}` }))))
        .success,
    ).toBe(false);
    expect(PlanOutput.safeParse({ tasks: [], assumptions: [] }).success).toBe(false);
  });

  it("rejects URLs in the overview and accepts a complete one", () => {
    expect(
      validatePlan({ ...plan([task()]), summary: "See https://x.example for details" }, ctx).join(),
    ).toMatch(/overview/);
    expect(
      validatePlan(
        {
          ...plan([task()]),
          budgetCategories: [{ name: "Venue", estimatedAmount: 5000, note: "estimate" }],
        },
        ctx,
      ),
    ).toEqual([]);
  });
});

describe("resolvePlan", () => {
  it("resolves relative deadlines, clamps pre-event tasks and past dates, flags dependency order", () => {
    const [a, b, c, d] = resolvePlan(
      [
        task({
          tempId: "a_task",
          due: { type: "relative", anchor: "event_start", offsetDays: -30, date: "" },
        }),
        task({
          tempId: "b_task",
          due: { type: "relative", anchor: "event_start", offsetDays: 3, date: "" },
        }),
        task({
          tempId: "c_task",
          due: { type: "relative", anchor: "event_start", offsetDays: -200, date: "" },
        }),
        task({
          tempId: "d_task",
          dependsOn: ["a_task"],
          due: { type: "relative", anchor: "event_start", offsetDays: -40, date: "" },
        }),
      ],
      ctx,
    );
    expect(a.dueDate).toBe("2026-11-10");
    expect(b).toMatchObject({ dueDate: "2026-12-10" });
    expect(b.warnings[0]).toMatch(/first event day/);
    expect(c).toMatchObject({ dueDate: "2026-10-22" });
    expect(c.warnings[0]).toMatch(/already passed/);
    expect(d.warnings[0]).toMatch(/Due before the task it depends on/);
  });

  it("after-event tasks may be due after the last day", () => {
    const [t] = resolvePlan(
      [task({ due: { type: "relative", anchor: "event_end", offsetDays: 7, date: "" } })],
      ctx,
    );
    expect(t).toMatchObject({ dueDate: "2026-12-18", warnings: [] });
  });
});

describe("engine plan", () => {
  const input = {
    playbook,
    event: { ...event, name: "Campus Hack", currency: "AED" },
    ctx: actx,
    plan: ctx,
  };
  const plan = buildPlan(input);

  it("includes only applicable templates and is valid against the plan rules", () => {
    const ids = plan.tasks.map((t) => t.tempId);
    expect(ids).toContain("guardian_consent"); // school students
    expect(ids).toContain("book_campus_venue"); // on campus
    expect(ids).not.toContain("source_external_venue");
    expect(ids).not.toContain("prizes_judging"); // no prizes
    expect(ids).toContain("overnight_plan");
    expect(PlanOutput.safeParse(plan).success).toBe(true);
    expect(validatePlan(plan, ctx)).toEqual([]);
  });

  it("drops dependencies on templates that don't apply", () => {
    const overnight = plan.tasks.find((t) => t.tempId === "overnight_plan")!;
    expect(overnight.dependsOn).toEqual(["book_campus_venue"]);
  });

  it("is deterministic", () => {
    expect(buildPlan(input)).toEqual(plan);
  });

  it("evidence lists answers and applicable playbook items, labelled; topics say 'not verified'", () => {
    expect(evidence.get("answer:audience.level")).toBe("Your answer: Who is the hackathon for?");
    expect(evidence.get("playbook:topic.minors_safeguarding")).toMatch(/not verified/);
    expect(evidence.has("playbook:topic.event_permit")).toBe(false); // on campus
    expect([...evidence.keys()].some((k) => k.startsWith("http"))).toBe(false);
  });
});

describe("missing information", () => {
  it("lists unanswered plan-critical items and unset event facts", () => {
    const empty = interviewState(playbook, eventContext({ ...event, city: null }), {});
    const missing = missingInformation(
      playbook,
      answerContext(eventContext({ ...event, city: null }), empty),
    );
    expect(missing.map((m) => m.key)).toEqual([
      "event.city",
      "audience.level",
      "format.team_size",
      "venue.on_campus",
      "catering.provided",
    ]);
  });

  it("is empty once the needed answers exist; conditional items appear only when they apply", () => {
    expect(missingInformation(playbook, actx)).toEqual([]);
    const noConsent = { ...answers };
    delete noConsent["audience.guardian_consent"];
    const s = interviewState(playbook, ectx, noConsent);
    expect(missingInformation(playbook, answerContext(ectx, s)).map((m) => m.key)).toEqual([
      "audience.guardian_consent",
    ]);
  });
});
