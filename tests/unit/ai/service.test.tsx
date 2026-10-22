import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiProvider, ProviderResult } from "@/lib/ai/types";
import { createFakeState, fakeClient, member, type FakeState } from "../helpers/fake-supabase";
import { resetRateLimits } from "@/lib/rate-limit";

// AI orchestration with an in-memory Supabase double and a scripted provider (or the real mock
// provider). No network and no Gemini key. RLS/RPC behaviour itself is in tests/db/ai.test.ts.

let state: FakeState;
let provider: AiProvider;
const calls: unknown[] = [];

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(async () => fakeClient(state)),
}));
vi.mock("@/modules/ai/provider", async (orig) => ({
  ...(await orig<typeof import("@/modules/ai/provider")>()),
  getAiProvider: () => provider,
}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  }),
  notFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  }),
  usePathname: () => "/app",
}));

const { generatePlanAction, reviseTaskAction, suggestFollowUpsAction, dismissSuggestionAction } =
  await import("@/modules/ai/actions");
const { createMockProvider } = await import("@/lib/ai/mock");
const { MOCK_FIXTURES } = await import("@/modules/ai/provider");

const EVENT = "11111111-1111-4111-8111-111111111111";
const SUGGESTION = "55555555-5555-4555-8555-555555555555";
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

const ANSWERS = {
  "audience.level": "university_students",
  "audience.multi_institution": false,
  "format.team_size": 4,
  "format.overnight": false,
  "venue.on_campus": true,
  "venue.campus_booking": "requested",
  "catering.provided": true,
  "catering.dietary": ["halal"],
  "prizes.offered": false,
  "sponsors.expected": false,
  "ip.ownership": "participants",
  "media.photography": false,
  "accessibility.ask_needs": true,
};

function scripted(results: ProviderResult[]): AiProvider {
  return {
    name: "gemini",
    model: "gemini-test",
    isMock: false,
    async generate(req) {
      calls.push(req.pipeline);
      return results.shift() ?? { ok: false, code: "provider_error", message: "no more" };
    },
  };
}
const ok = (data: unknown): ProviderResult => ({
  ok: true,
  text: JSON.stringify(data),
  model: "gemini-test-001",
  usage: { inputTokens: 900, outputTokens: 300 },
});
const aiTask = (tempId: string, over = {}) => ({
  tempId,
  title: `Task ${tempId}`,
  description: "Something to do",
  category: "logistics",
  priority: "high",
  due: { type: "relative", anchor: "event_start", offsetDays: -14, date: "" },
  proposedOwner: "Logistics lead",
  dependsOn: [],
  requiredInfo: [],
  evidenceIds: ["answer:catering.provided"],
  confidence: "medium",
  uncertainty: "",
  nextAction: "Start",
  ...over,
});

function setup(
  role: "owner" | "organizer" | "viewer" | null,
  opts: { status?: string; answers?: Record<string, unknown> } = {},
) {
  member(state, "user-1", ["organizer"]);
  state.tables.events = [
    {
      id: EVENT,
      owner_id: "owner",
      name: "Campus Hack",
      event_type: "university_hackathon",
      status: opts.status ?? "planning",
      venue_type: "indoor",
      location_text: null,
      city: "Dubai",
      country: "AE",
      timezone: "Asia/Dubai",
      starts_at: future(60),
      ends_at: future(61), // 24 h
      capacity: 120,
      budget_amount: 15000,
      currency: "AED",
    },
  ];
  state.tables.event_members = role ? [{ event_id: EVENT, user_id: "user-1", role }] : [];
  state.tables.interview_answers = Object.entries(opts.answers ?? ANSWERS).map(
    ([question_key, answer]) => ({
      event_id: EVENT,
      question_key,
      answer,
    }),
  );
  state.tables.ai_suggestions = [];
  state.tables.ai_plans = [];
  state.tables.ai_runs = [];
  state.rpc.start_ai_run = { data: "run-1" };
  state.rpc.save_ai_plan = { data: "plan-1" };
  state.rpc.save_ai_followups = { data: 2 };
}

const rpc = (fn: string) =>
  state.rpcCalls.filter((c) => c.fn === fn).map((c) => c.args as Record<string, unknown>);
const fd = (entries: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};

beforeEach(() => {
  resetRateLimits();
  state = createFakeState({ sub: "user-1" });
  calls.length = 0;
  provider = scripted([]);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
});

describe("authorization", () => {
  it("viewers, outsiders, locked events and signed-out callers never reach the model", async () => {
    for (const [role, status, message] of [
      ["viewer", "planning", /owner or organizers/],
      [null, "planning", /doesn't exist/],
      ["owner", "completed", /This event is completed/],
    ] as const) {
      state = createFakeState({ sub: "user-1" });
      setup(role, { status });
      for (const action of [
        () => generatePlanAction(EVENT, {}, fd()),
        () => suggestFollowUpsAction(EVENT, {}, fd()),
        () => reviseTaskAction(EVENT, SUGGESTION, {}, fd({ note: "Make it earlier please" })),
        () => dismissSuggestionAction(EVENT, SUGGESTION, {}, fd()),
      ]) {
        expect(await action(), `${role}/${status}`).toMatchObject({
          ok: false,
          message: expect.stringMatching(message),
        });
      }
    }
    state = createFakeState({ sub: null });
    setup("owner");
    await expect(generatePlanAction(EVENT, {}, fd())).rejects.toMatchObject({
      to: expect.stringMatching(/^\/sign-in/),
    });
    expect(calls).toEqual([]);
    expect(rpc("start_ai_run")).toEqual([]);
  });

  it("malformed ids are refused before anything else", async () => {
    setup("owner");
    expect(await generatePlanAction("x", {}, fd())).toMatchObject({ ok: false });
    expect(
      await reviseTaskAction(EVENT, "../etc", {}, fd({ note: "valid note here" })),
    ).toMatchObject({ ok: false });
    expect(rpc("start_ai_run")).toEqual([]);
  });
});

describe("plan generation", () => {
  it("needs the plan-critical answers first (no model call)", async () => {
    setup("owner", { answers: { "audience.level": "university_students" } });
    const r = await generatePlanAction(EVENT, {}, fd());
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/Maximum team size/) });
    expect(calls).toEqual([]);
  });

  it("saves a validated AI plan with resolved deadlines and records usage", async () => {
    setup("organizer");
    provider = scripted([
      ok({
        tasks: [aiTask("book_room"), aiTask("order_food", { dependsOn: ["book_room"] })],
        assumptions: ["Indoor venue"],
      }),
    ]);
    const r = await generatePlanAction(EVENT, {}, fd());
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/Plan created/) });
    expect(rpc("start_ai_run")[0]).toMatchObject({
      p_event_id: EVENT,
      p_pipeline: "plan",
      p_provider: "gemini",
      p_is_mock: false,
    });
    expect(rpc("finish_ai_run")[0]).toMatchObject({
      p_status: "succeeded",
      p_input_tokens: 900,
      p_output_tokens: 300,
      p_attempts: 1,
    });
    const saved = rpc("save_ai_plan")[0];
    expect(saved).toMatchObject({
      p_source: "ai",
      p_run_id: "run-1",
      p_assumptions: ["Indoor venue"],
    });
    const tasks = saved.p_tasks as { key: string; payload: { dueDate: string; tempId: string } }[];
    expect(tasks.map((t) => t.key)).toEqual(["book_room", "order_food"]);
    expect(tasks[0].payload.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("does not generate again for identical inputs (duplicate request)", async () => {
    setup("owner");
    provider = scripted([ok({ tasks: [aiTask("t_one")], assumptions: [] })]);
    await generatePlanAction(EVENT, {}, fd());
    const hash = rpc("save_ai_plan")[0].p_input_hash;
    state.tables.ai_plans = [
      {
        id: "plan-1",
        event_id: EVENT,
        status: "current",
        source: "ai",
        input_hash: hash,
        assumptions: [],
        is_mock: false,
        created_at: future(0),
        ai_run_id: "run-1",
      },
    ];
    for (const intent of ["generate", "regenerate"]) {
      const r = await generatePlanAction(EVENT, {}, fd({ intent }));
      expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/already exists/) });
    }
    expect(calls).toEqual(["plan"]);
    expect(rpc("start_ai_run")).toHaveLength(1);
  });

  it("changed answers need an explicit regenerate", async () => {
    setup("owner");
    state.tables.ai_plans = [
      {
        id: "plan-1",
        event_id: EVENT,
        status: "current",
        source: "ai",
        input_hash: "0".repeat(64),
        assumptions: [],
        is_mock: false,
        created_at: future(0),
        ai_run_id: null,
      },
    ];
    expect(await generatePlanAction(EVENT, {}, fd())).toMatchObject({
      message: expect.stringMatching(/Regenerate plan/),
    });
    expect(calls).toEqual([]);
    provider = scripted([ok({ tasks: [aiTask("t_one")], assumptions: [] })]);
    expect(await generatePlanAction(EVENT, {}, fd({ intent: "regenerate" }))).toMatchObject({
      ok: true,
    });
    expect(calls).toEqual(["plan"]);
  });

  it("quota exhausted → clearly labelled playbook plan, run recorded as rate_limited", async () => {
    setup("owner");
    provider = scripted([
      { ok: false, code: "rate_limited", message: "quota", retryAfterSeconds: 40 },
    ]);
    const r = await generatePlanAction(EVENT, {}, fd());
    expect(r).toMatchObject({
      ok: true,
      message: expect.stringMatching(/usage limit[\s\S]*40 s[\s\S]*playbook instead, without AI/),
    });
    expect(calls).toEqual(["plan"]); // no retry against the quota
    expect(rpc("finish_ai_run")[0]).toMatchObject({
      p_status: "rate_limited",
      p_error_code: "rate_limited",
    });
    expect(rpc("save_ai_plan")[0]).toMatchObject({ p_source: "playbook", p_run_id: null });
  });

  it("an AI failure never replaces an existing plan", async () => {
    setup("owner");
    state.tables.ai_plans = [
      {
        id: "plan-1",
        event_id: EVENT,
        status: "current",
        source: "ai",
        input_hash: "0".repeat(64),
        assumptions: [],
        is_mock: false,
        created_at: future(0),
        ai_run_id: null,
      },
    ];
    provider = scripted([{ ok: false, code: "model_unavailable", message: "404" }]);
    const r = await generatePlanAction(EVENT, {}, fd({ intent: "regenerate" }));
    expect(r).toMatchObject({
      ok: false,
      message: expect.stringMatching(/GEMINI_MODEL[\s\S]*existing plan is unchanged/),
    });
    expect(rpc("save_ai_plan")).toEqual([]);
  });

  it("malformed output twice → invalid_output, nothing from the model is saved", async () => {
    setup("owner");
    provider = scripted([
      ok({ tasks: [aiTask("a_one", { dependsOn: ["ghost"] })], assumptions: [] }),
      ok({
        tasks: [aiTask("a_one", { evidenceIds: ["https://made-up.example"] })],
        assumptions: [],
      }),
    ]);
    await generatePlanAction(EVENT, {}, fd());
    expect(calls).toEqual(["plan", "plan"]);
    expect(rpc("finish_ai_run")[0]).toMatchObject({ p_status: "invalid_output", p_attempts: 2 });
    expect(rpc("save_ai_plan")[0]).toMatchObject({ p_source: "playbook" });
    const keys = (rpc("save_ai_plan")[0].p_tasks as { key: string }[]).map((t) => t.key);
    expect(keys).not.toContain("a_one");
  });

  it("timeouts are retried once and recorded", async () => {
    setup("owner");
    provider = scripted([
      { ok: false, code: "timeout", message: "t", retryable: true },
      { ok: false, code: "timeout", message: "t", retryable: true },
    ]);
    await generatePlanAction(EVENT, {}, fd());
    expect(calls).toHaveLength(2);
    expect(rpc("finish_ai_run")[0]).toMatchObject({ p_status: "timeout", p_attempts: 2 });
  });

  it("a concurrent request or the hourly cap stops before the model is called", async () => {
    setup("owner");
    state.rpc.start_ai_run = { error: { code: "23505", message: "ai_run_in_progress" } };
    expect(await generatePlanAction(EVENT, {}, fd())).toMatchObject({
      ok: false,
      message: expect.stringMatching(/already being generated/),
    });
    state.rpc.start_ai_run = { error: { code: "53400", message: "ai_rate_limited" } };
    expect(await generatePlanAction(EVENT, {}, fd())).toMatchObject({
      ok: false,
      message: expect.stringMatching(/hourly limit/),
    });
    expect(calls).toEqual([]);
  });

  it("the mock provider produces the playbook plan, flagged as mock", async () => {
    setup("owner");
    provider = createMockProvider(MOCK_FIXTURES);
    expect(await generatePlanAction(EVENT, {}, fd())).toMatchObject({
      ok: true,
      message: expect.stringMatching(/mock AI provider/),
    });
    expect(rpc("start_ai_run")[0]).toMatchObject({ p_provider: "mock", p_is_mock: true });
    const keys = (rpc("save_ai_plan")[0].p_tasks as { key: string }[]).map((t) => t.key);
    expect(keys).toContain("book_campus_venue");
    expect(keys).not.toContain("guardian_consent");
  });
});

describe("targeted revision", () => {
  const stored = (tempId: string, over = {}) => ({
    ...aiTask(tempId, over),
    dueDate: "2026-12-01",
    warnings: [],
  });
  function withPlan() {
    state.tables.ai_plans = [
      {
        id: "plan-1",
        event_id: EVENT,
        status: "current",
        source: "ai",
        input_hash: "0".repeat(64),
        assumptions: [],
        is_mock: false,
        created_at: future(0),
        ai_run_id: null,
      },
    ];
    state.tables.ai_suggestions = [
      {
        id: SUGGESTION,
        event_id: EVENT,
        plan_id: "plan-1",
        kind: "task",
        item_key: "book_room",
        status: "proposed",
        source: "ai",
        revision: 1,
        is_mock: false,
        payload: stored("book_room"),
      },
      {
        id: "s2",
        event_id: EVENT,
        plan_id: "plan-1",
        kind: "task",
        item_key: "order_food",
        status: "proposed",
        source: "ai",
        revision: 1,
        is_mock: false,
        payload: stored("order_food", { dependsOn: ["book_room"] }),
      },
    ];
  }

  it("revises only the requested task", async () => {
    setup("owner");
    withPlan();
    provider = scripted([
      ok({
        task: aiTask("book_room", { priority: "critical" }),
        changeSummary: "Raised the priority.",
      }),
    ]);
    const r = await reviseTaskAction(
      EVENT,
      SUGGESTION,
      {},
      fd({ note: "This is critical for us" }),
    );
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/Raised the priority/) });
    expect(rpc("revise_ai_task")[0]).toMatchObject({
      p_suggestion_id: SUGGESTION,
      p_run_id: "run-1",
      p_payload: { priority: "critical", changeSummary: "Raised the priority." },
    });
    expect(rpc("save_ai_plan")).toEqual([]);
  });

  it("rejects a revision that renames the task or creates a cycle", async () => {
    setup("owner");
    withPlan();
    provider = scripted([
      ok({ task: aiTask("renamed"), changeSummary: "x x x" }),
      ok({ task: aiTask("book_room", { dependsOn: ["order_food"] }), changeSummary: "x x x" }),
    ]);
    const r = await reviseTaskAction(EVENT, SUGGESTION, {}, fd({ note: "Change it somehow" }));
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/task is unchanged/) });
    expect(rpc("revise_ai_task")).toEqual([]);
  });

  it("validates the note and refuses tasks outside the current plan", async () => {
    setup("owner");
    withPlan();
    expect(await reviseTaskAction(EVENT, SUGGESTION, {}, fd({ note: "no" }))).toMatchObject({
      ok: false,
      fieldErrors: { note: expect.any(Array) },
    });
    expect(
      await reviseTaskAction(
        EVENT,
        "66666666-6666-4666-8666-666666666666",
        {},
        fd({ note: "Valid change note" }),
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/isn't in the current plan/),
    });
    expect(calls).toEqual([]);
  });
});

describe("interview follow-ups", () => {
  it("are only requested after the playbook questions", async () => {
    setup("owner", { answers: { "audience.level": "mixed" } });
    expect(await suggestFollowUpsAction(EVENT, {}, fd())).toMatchObject({
      ok: false,
      message: expect.stringMatching(/playbook questions first/),
    });
    expect(calls).toEqual([]);
  });

  it("saves filtered follow-ups and doesn't repeat a request for identical inputs", async () => {
    setup("owner");
    provider = createMockProvider(MOCK_FIXTURES);
    expect(await suggestFollowUpsAction(EVENT, {}, fd())).toMatchObject({
      ok: true,
      message: expect.stringMatching(/2 follow-up questions added \(mock AI\)/),
    });
    const saved = rpc("save_ai_followups")[0].p_questions as { key: string }[];
    expect(saved.map((q) => q.key)).toEqual(["custom.judging_format", "custom.wifi_capacity"]);
    const hash = rpc("start_ai_run")[0].p_input_hash;
    state.tables.ai_runs = [
      {
        id: "run-1",
        event_id: EVENT,
        pipeline: "interview",
        input_hash: hash,
        status: "succeeded",
      },
    ];
    expect(await suggestFollowUpsAction(EVENT, {}, fd())).toMatchObject({
      message: expect.stringMatching(/no new request/),
    });
    expect(rpc("start_ai_run")).toHaveLength(1);
  });

  it("never re-asks answered or dismissed follow-ups", async () => {
    setup("owner");
    state.tables.ai_suggestions = [
      {
        id: "q1",
        event_id: EVENT,
        kind: "question",
        item_key: "custom.judging_format",
        status: "rejected",
        source: "ai",
        revision: 1,
        is_mock: true,
        payload: {
          key: "custom.judging_format",
          type: "text",
          text: "How will teams present their projects to the judges?",
          why: "Because.",
          required: false,
          when: [],
          maxLength: 300,
        },
      },
    ];
    provider = createMockProvider(MOCK_FIXTURES);
    await suggestFollowUpsAction(EVENT, {}, fd());
    const saved = rpc("save_ai_followups")[0].p_questions as { key: string }[];
    expect(saved.map((q) => q.key)).toEqual(["custom.wifi_capacity"]);
  });
});

describe("pages", () => {
  const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);

  it("plan page labels proposals, mock output, deadlines, owners and evidence", async () => {
    setup("viewer");
    state.tables.ai_plans = [
      {
        id: "plan-1",
        event_id: EVENT,
        status: "current",
        source: "ai",
        input_hash: "0".repeat(64),
        assumptions: ["Indoor venue"],
        is_mock: true,
        created_at: future(0),
        ai_run_id: null,
      },
    ];
    state.tables.ai_suggestions = [
      {
        id: SUGGESTION,
        event_id: EVENT,
        plan_id: "plan-1",
        kind: "task",
        item_key: "book_room",
        status: "proposed",
        source: "ai",
        revision: 1,
        is_mock: true,
        payload: {
          ...aiTask("book_room"),
          dueDate: "2026-12-01",
          warnings: ["The suggested deadline has already passed; it was moved to today."],
        },
      },
    ];
    provider = createMockProvider(MOCK_FIXTURES);
    const { default: Page } = await import("@/app/app/events/[eventId]/plan/page");
    const out = await html(Page({ params: Promise.resolve({ eventId: EVENT }) }));
    expect(out).toContain("These are proposals, not tasks");
    expect(out).toContain("Task book_room");
    expect(out).toContain("Logistics lead");
    expect(out).toContain("Your answer: Will you provide food and drinks?");
    expect(out).toContain("already passed");
    expect(out).toMatch(/Mock/);
    expect(out).not.toContain("Generate plan"); // viewer
    expect(out).not.toContain("Dismiss");
  });

  it("interview page shows AI follow-ups as optional with a separate dismiss form", async () => {
    setup("owner");
    state.tables.ai_suggestions = [
      {
        id: "q1",
        event_id: EVENT,
        kind: "question",
        item_key: "custom.wifi_capacity",
        status: "proposed",
        source: "ai",
        revision: 1,
        is_mock: true,
        payload: {
          key: "custom.wifi_capacity",
          type: "boolean",
          text: "Has the venue confirmed Wi-Fi capacity?",
          why: "Internet matters.",
          required: false,
          when: [],
        },
      },
    ];
    const { default: Page } = await import("@/app/app/events/[eventId]/interview/page");
    const out = await html(Page({ params: Promise.resolve({ eventId: EVENT }) }));
    expect(out).toContain("Has the venue confirmed Wi-Fi capacity?");
    expect(out).toContain("AI suggestion · optional");
    expect(out).toContain('form="dismiss-q1"');
    expect(out).toContain('id="dismiss-q1"');
    expect(out).toContain("enough information to generate a useful plan");
  });
});
