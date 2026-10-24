import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, fakeClient, member, type FakeState } from "../helpers/fake-supabase";

// Plan orchestration with an in-memory Supabase double. No network. RLS/RPC behaviour itself is in
// tests/db/ai.test.ts.

let state: FakeState;

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(async () => fakeClient(state)),
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

const { generatePlanAction, dismissSuggestionAction } = await import("@/modules/planning/actions");
const { resetRateLimits } = await import("@/lib/rate-limit");

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
  state.rpc.save_ai_plan = { data: "plan-1" };
  state.rpc.set_ai_plan_overview = { data: null };
}

const rpc = (fn: string) =>
  state.rpcCalls.filter((c) => c.fn === fn).map((c) => c.args as Record<string, unknown>);
const fd = (entries: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};
const fetchSpy = vi.fn();

beforeEach(() => {
  state = createFakeState({ sub: "user-1" });
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  resetRateLimits();
});

describe("authorization", () => {
  it("viewers, outsiders, locked events and signed-out callers never get a plan", async () => {
    for (const [role, status, message] of [
      ["viewer", "planning", /owner or organizers/],
      [null, "planning", /doesn't exist/],
      ["owner", "completed", /This event is completed/],
    ] as const) {
      state = createFakeState({ sub: "user-1" });
      setup(role, { status });
      for (const action of [
        () => generatePlanAction(EVENT, {}, fd()),
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
    expect(rpc("save_ai_plan")).toEqual([]);
  });

  it("malformed ids are refused before anything else", async () => {
    setup("owner");
    expect(await generatePlanAction("x", {}, fd())).toMatchObject({ ok: false });
    expect(await dismissSuggestionAction(EVENT, "../etc", {}, fd())).toMatchObject({ ok: false });
    expect(rpc("save_ai_plan")).toEqual([]);
  });
});

describe("plan generation", () => {
  it("builds and stores a playbook plan without any model run or network call", async () => {
    setup("organizer");
    const r = await generatePlanAction(EVENT, {}, fd());
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/Plan created/) });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rpc("start_ai_run")).toEqual([]);
    const saved = rpc("save_ai_plan")[0];
    expect(saved).toMatchObject({
      p_source: "playbook",
      p_run_id: null,
      p_playbook_id: "university-hackathon",
    });
    const tasks = saved.p_tasks as { key: string; payload: { dueDate: string } }[];
    expect(tasks.length).toBeGreaterThan(8);
    expect(tasks.every((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.payload.dueDate))).toBe(true);
    expect(saved.p_assumptions).toEqual(
      expect.arrayContaining([expect.stringMatching(/timezone/)]),
    );
    expect(rpc("set_ai_plan_overview")[0]).toMatchObject({
      p_plan_id: "plan-1",
      p_overview: expect.objectContaining({
        summary: expect.stringContaining("Campus Hack"),
        budgetSummary: expect.stringContaining("not quotes"),
      }),
    });
  });

  it("still produces a useful plan when most answers are missing", async () => {
    setup("owner", { answers: { "audience.level": "university_students" } });
    const r = await generatePlanAction(EVENT, {}, fd());
    expect(r).toMatchObject({ ok: true, message: expect.stringMatching(/Plan created/) });
    const overview = rpc("set_ai_plan_overview")[0].p_overview as {
      followUpQuestions: unknown[];
      missingInformation: string[];
    };
    expect(overview.missingInformation.length).toBeGreaterThan(0);
    expect(overview.followUpQuestions.length).toBeGreaterThan(0);
    expect((rpc("save_ai_plan")[0].p_tasks as unknown[]).length).toBeGreaterThan(5);
  });

  it("keeps the saved plan for identical inputs and asks for an explicit regenerate when answers changed", async () => {
    setup("owner");
    await generatePlanAction(EVENT, {}, fd());
    const hash = rpc("save_ai_plan")[0].p_input_hash;
    const row = (input_hash: unknown) => ({
      id: "plan-1",
      event_id: EVENT,
      status: "current",
      source: "playbook",
      input_hash,
      assumptions: [],
      is_mock: false,
      created_at: future(0),
      ai_run_id: null,
    });
    state.tables.ai_plans = [row(hash)];
    expect(await generatePlanAction(EVENT, {}, fd())).toMatchObject({
      ok: true,
      message: expect.stringMatching(/already exists/),
    });
    expect(rpc("save_ai_plan")).toHaveLength(1);

    state.tables.ai_plans = [row("0".repeat(64))];
    expect(await generatePlanAction(EVENT, {}, fd())).toMatchObject({
      message: expect.stringMatching(/Regenerate/),
    });
    expect(rpc("save_ai_plan")).toHaveLength(1);
    expect(await generatePlanAction(EVENT, {}, fd({ intent: "regenerate" }))).toMatchObject({
      ok: true,
      message: expect.stringMatching(/Plan created/),
    });
    expect(rpc("save_ai_plan")).toHaveLength(2);
  });

  it("a different answer produces a different input hash", async () => {
    setup("owner");
    await generatePlanAction(EVENT, {}, fd());
    setup("owner", { answers: { ...ANSWERS, "catering.provided": false } });
    await generatePlanAction(EVENT, {}, fd());
    const [a, b] = rpc("save_ai_plan");
    expect(a.p_input_hash).not.toBe(b.p_input_hash);
  });
});

describe("pages", () => {
  const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);

  it("plan page shows the draft, deadlines, owners and sources without provider wording", async () => {
    setup("viewer");
    state.tables.ai_plans = [
      {
        id: "plan-1",
        event_id: EVENT,
        status: "current",
        source: "playbook",
        input_hash: "0".repeat(64),
        assumptions: ["Teams have up to 4 people."],
        overview: {
          summary: "A campus hackathon for about 120 people.",
          goals: ["Run a safe event."],
          requirements: ["Wi-Fi for every device."],
          missingInformation: [],
          decisions: ["Choose the theme."],
          followUpQuestions: [{ question: "Is food provided?", why: "Sets the catering plan." }],
          budgetCategories: [{ name: "Venue", estimatedAmount: 1500, note: "Illustrative." }],
          budgetSummary: "Illustrative planning allowances, not quotes: about 1,500 AED.",
          risks: [
            {
              title: "Venue availability",
              mitigation: "Confirm in writing.",
              likelihood: "high",
              contingency: "Keep a backup room.",
            },
          ],
          schedule: [
            { date: "2026-12-01", start: "09:00", end: "10:00", title: "Registration", note: "" },
          ],
        },
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
        source: "playbook",
        revision: 1,
        is_mock: false,
        payload: {
          tempId: "book_room",
          title: "Book the room",
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
          dueDate: "2026-12-01",
          warnings: ["The suggested deadline has already passed; it was moved to today."],
        },
      },
    ];
    const { default: Page } = await import("@/app/app/events/[eventId]/plan/page");
    const out = await html(Page({ params: Promise.resolve({ eventId: EVENT }) }));
    for (const text of [
      "This is a draft for you to review",
      "Book the room",
      "Logistics lead",
      "Your answer: Will you provide food and drinks?",
      "already passed",
      "not quotes",
      "Registration",
      "Keep a backup room",
      "Choose the theme.",
      "Is food provided?",
    ])
      expect(out, text).toContain(text);
    expect(out).not.toMatch(/\bAI\b|Gemini|Groq|mock|Mock/);
    expect(out).not.toContain("Generate plan"); // viewer
    expect(out).not.toContain("Dismiss");
    // The stored hash doesn't match these inputs: viewers see the warning without the action.
    expect(out).toContain("This plan is out of date");
    expect(out).toContain("owner or organizers can regenerate it");
  });

  it("plan page warns only when the event details or answers changed after the plan was made", async () => {
    setup("owner");
    await generatePlanAction(EVENT, {}, fd());
    const saved = rpc("save_ai_plan")[0];
    state.tables.ai_plans = [
      {
        id: "plan-1",
        event_id: EVENT,
        status: "current",
        source: "playbook",
        input_hash: saved.p_input_hash,
        assumptions: [],
        overview: null,
        is_mock: false,
        created_at: future(0),
        ai_run_id: null,
      },
    ];
    const { default: Page } = await import("@/app/app/events/[eventId]/plan/page");
    const render = () => html(Page({ params: Promise.resolve({ eventId: EVENT }) }));

    const fresh = await render();
    expect(fresh).not.toContain("This plan is out of date");
    expect(fresh).toContain("Regenerate template plan");

    state.tables.interview_answers = state.tables.interview_answers.map((a) =>
      a.question_key === "format.team_size" ? { ...a, answer: 5 } : a,
    );
    const afterAnswer = await render();
    expect(afterAnswer).toContain("This plan is out of date");
    expect(afterAnswer).toContain("Regenerate the plan to bring it up to date.");

    state.tables.interview_answers = state.tables.interview_answers.map((a) =>
      a.question_key === "format.team_size" ? { ...a, answer: 4 } : a,
    );
    (state.tables.events[0] as Record<string, unknown>).capacity = 200;
    expect(await render()).toContain("This plan is out of date");
  });

  it("interview page shows earlier follow-up questions as optional with a separate dismiss form", async () => {
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
        is_mock: false,
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
    expect(out).toContain("Follow-up · optional");
    expect(out).toContain('form="dismiss-q1"');
    expect(out).toContain('id="dismiss-q1"');
    expect(out).not.toMatch(/\bAI\b|Gemini|Groq/);
  });
});

describe("custom drafts (AI gateway, fake fetch)", () => {
  const MODEL = "@cf/test/model-1";
  const enableAi = () => {
    vi.stubEnv("AI_PROVIDER", "cloudflare");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-token-not-real");
    vi.stubEnv("AI_PLAN_MODEL", MODEL);
    vi.stubEnv("AI_PLAN_STRATEGY", "hybrid");
  };
  const cf = (status: number, body: unknown) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  const answer = (response: unknown) =>
    cf(200, {
      success: true,
      errors: [],
      result: { response, usage: { prompt_tokens: 900, completion_tokens: 400 } },
    });
  const DRAFT = {
    summary: "A one-day campus hackathon for about 120 students in Dubai.",
    goals: ["Run a safe, well-paced event."],
    tasks: [
      {
        id: "define_scope",
        title: "Confirm scope and theme",
        description: "Agree theme, format and judging with the team.",
        category: "staffing",
        priority: "high",
        anchor: "start",
        offsetDays: -40,
        owner: "Lead organizer",
        dependsOn: [],
        evidence: ["answer:audience.level", "playbook:task.define_scope"],
        confidence: "high",
        nextAction: "Book a planning meeting.",
      },
      {
        id: "brief_judges",
        title: "Brief the judges",
        description: "Share the judging criteria.",
        category: "staffing",
        priority: "medium",
        anchor: "start",
        offsetDays: -7,
        owner: "Program lead",
        dependsOn: ["define_scope"],
        evidence: [],
        confidence: "medium",
        nextAction: "Draft the criteria.",
      },
      {
        id: "thank_partners",
        title: "Thank participants and partners",
        description: "Send thank-you notes after the event.",
        category: "communications",
        priority: "low",
        anchor: "end",
        offsetDays: 3,
        owner: "Comms lead",
        dependsOn: [],
        evidence: [],
        confidence: "high",
        nextAction: "Prepare the list.",
      },
    ],
    assumptions: ["Judging happens on the last afternoon."],
    risks: [
      {
        title: "Low sign-ups",
        likelihood: "medium",
        mitigation: "Promote early.",
        contingency: "",
      },
    ],
    decisions: ["Choose the theme."],
    followUpQuestions: [{ question: "Will there be prizes?", why: "Sets the prize rules." }],
    conflicts: [],
  };
  const custom = (intent = "generate") =>
    generatePlanAction(EVENT, {}, fd({ mode: "custom", intent }));
  const ready = () => {
    setup("owner");
    enableAi();
    state.rpc.start_ai_run = { data: "run-1" };
    state.rpc.finish_ai_run = { data: null };
  };

  it("one request, validated locally, saved as a custom draft with usage recorded", async () => {
    ready();
    fetchSpy.mockResolvedValueOnce(answer(DRAFT));
    expect(await custom()).toMatchObject({
      ok: true,
      message: expect.stringMatching(/Custom draft created/),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0][0])).toContain(`/ai/run/${MODEL}`);
    expect(rpc("start_ai_run")[0]).toMatchObject({
      p_pipeline: "plan",
      p_provider: "cloudflare",
      p_model: MODEL,
      p_prompt_version: "planning.plan@3",
    });
    expect(rpc("finish_ai_run")[0]).toMatchObject({
      p_status: "succeeded",
      p_error_code: null,
      p_attempts: 1,
      p_input_tokens: 900,
      p_output_tokens: 400,
    });
    const saved = rpc("save_ai_plan")[0];
    expect(saved).toMatchObject({ p_source: "ai", p_run_id: "run-1" });
    expect((saved.p_tasks as { key: string }[]).map((t) => t.key)).toEqual([
      "define_scope",
      "brief_judges",
      "thank_partners",
    ]);
    const overview = rpc("set_ai_plan_overview")[0].p_overview as Record<string, unknown>;
    expect(overview.summary).toBe(DRAFT.summary);
    expect(String(overview.budgetSummary)).toContain("not quotes"); // computed by the engine
  });

  it.each([
    [
      "malformed output",
      () => answer("{not json"),
      /didn't pass HalaEvents' checks/,
      "invalid_output",
    ],
    ["schema mismatch", () => answer({ ...DRAFT, tasks: [] }), /didn't pass/, "invalid_output"],
    [
      "dependency cycle",
      () =>
        answer({
          ...DRAFT,
          tasks: DRAFT.tasks.map((t) =>
            t.id === "define_scope" ? { ...t, dependsOn: ["brief_judges"] } : t,
          ),
        }),
      /didn't pass/,
      "invalid_output",
    ],
    [
      "quota exhausted",
      () => cf(429, { success: false, errors: [] }),
      /usage limit/,
      "rate_limited",
    ],
    [
      "auth failure",
      () => cf(401, { success: false, errors: [] }),
      /aren't available right now/,
      "failed",
    ],
    ["provider outage", () => cf(503, "down"), /aren't available right now/, "failed"],
  ] as const)("%s: nothing saved, run closed, one request", async (_n, res, message, status) => {
    ready();
    fetchSpy.mockResolvedValueOnce(res());
    expect(await custom()).toMatchObject({ ok: false, message: expect.stringMatching(message) });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(rpc("finish_ai_run")[0]).toMatchObject({ p_status: status });
    expect(rpc("save_ai_plan")).toEqual([]);
  });

  it("timeouts are reported as such", async () => {
    ready();
    fetchSpy.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    expect(await custom()).toMatchObject({
      ok: false,
      message: expect.stringMatching(/took too long/),
    });
    expect(rpc("finish_ai_run")[0]).toMatchObject({ p_status: "timeout", p_error_code: "timeout" });
  });

  it("not configured: no request, no run, and the template mode still works", async () => {
    setup("owner");
    expect(await custom()).toMatchObject({
      ok: false,
      message: expect.stringMatching(/aren't available/),
    });
    expect(rpc("start_ai_run")).toEqual([]);
    expect(await generatePlanAction(EVENT, {}, fd({ mode: "template" }))).toMatchObject({
      ok: true,
    });
    expect(rpc("save_ai_plan")[0]).toMatchObject({ p_source: "playbook" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reuses an identical custom draft without a new request, even on regenerate", async () => {
    ready();
    fetchSpy.mockResolvedValueOnce(answer(DRAFT));
    await custom();
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
      expect(await custom(intent)).toMatchObject({
        message: expect.stringMatching(/already exists/),
      });
    }
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // A template plan for the same inputs has a different fingerprint than the custom draft.
    await generatePlanAction(EVENT, {}, fd({ mode: "template", intent: "regenerate" }));
    expect(rpc("save_ai_plan")[1].p_input_hash).not.toBe(hash);
  });

  const savedRow = (hash: unknown, runId = "run-1") => ({
    id: "plan-1",
    event_id: EVENT,
    status: "current",
    source: "ai",
    input_hash: hash,
    assumptions: [],
    is_mock: false,
    created_at: future(0),
    ai_run_id: runId,
  });

  it("a changed answer or a different model invalidates the saved draft; each change is one new request", async () => {
    ready();
    fetchSpy.mockImplementation(async () => answer(DRAFT));
    await custom();
    state.tables.ai_plans = [savedRow(rpc("save_ai_plan")[0].p_input_hash)];

    state.tables.interview_answers = state.tables.interview_answers.map((a) =>
      a.question_key === "format.team_size" ? { ...a, answer: 5 } : a,
    );
    expect(await custom()).toMatchObject({ message: expect.stringMatching(/answers changed/) });
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no request until the organizer regenerates
    expect(await custom("regenerate")).toMatchObject({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    state.tables.ai_plans = [savedRow(rpc("save_ai_plan")[1].p_input_hash)];

    vi.stubEnv("AI_PLAN_MODEL", "@cf/test/model-2");
    expect(await custom("regenerate")).toMatchObject({ ok: true });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(rpc("start_ai_run")[2]).toMatchObject({ p_model: "@cf/test/model-2" });
  });

  it("the fingerprint changes with the prompt version and the model, not otherwise", async () => {
    const { planInputHash } = await import("@/modules/planning/service");
    const { playbookFor } = await import("@/playbooks");
    const { interviewState, eventContext } = await import("@/modules/events/interview-rules");
    setup("owner");
    const event = state.tables.events[0] as Parameters<typeof planInputHash>[0]["event"];
    const playbook = playbookFor("university_hackathon");
    const state0 = interviewState(playbook, eventContext(event), {});
    const inputs = { playbook, state: state0, ctx: {}, event } as Parameters<
      typeof planInputHash
    >[0];
    const h = (draft?: { model: string; promptVersion: string }) => planInputHash(inputs, draft);
    const v1 = h({ model: "m1", promptVersion: "planning.plan@1" });
    expect(h({ model: "m1", promptVersion: "planning.plan@1" })).toBe(v1);
    expect(h({ model: "m1", promptVersion: "planning.plan@2" })).not.toBe(v1);
    expect(h({ model: "m2", promptVersion: "planning.plan@1" })).not.toBe(v1);
    expect(h()).not.toBe(v1); // template plans have their own fingerprint
  });

  it("a draft cut off at the output-token limit is rejected, never saved", async () => {
    ready();
    const full = JSON.stringify(DRAFT);
    fetchSpy.mockResolvedValueOnce(answer(full.slice(0, Math.floor(full.length * 0.7))));
    expect(await custom()).toMatchObject({
      ok: false,
      message: expect.stringMatching(/didn't pass/),
    });
    expect(rpc("finish_ai_run")[0]).toMatchObject({ p_status: "invalid_output" });
    expect(rpc("save_ai_plan")).toEqual([]);
    expect(JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).max_tokens).toBe(4096);
  });

  it("logs carry codes and counts only: no token, prompt or output text", async () => {
    ready();
    const logs: string[] = [];
    for (const level of ["info", "warn", "error", "log"] as const)
      vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logs.push(a.join(" ")));
    fetchSpy.mockResolvedValueOnce(answer(DRAFT));
    await custom();
    fetchSpy.mockResolvedValueOnce(cf(401, { success: false, errors: [{ message: "bad token" }] }));
    await custom("regenerate");
    const text = logs.join("\n");
    expect(text).toContain('"msg":"plan_draft"');
    for (const secret of ["test-token-not-real", "Bearer", "ANSWERS", DRAFT.summary, "bad token"])
      expect(text).not.toContain(secret);
    const sent = String(fetchSpy.mock.calls[0][1]?.body);
    expect(sent).not.toContain("test-token-not-real"); // the token only travels in the header
  });

  it("refuses concurrent and rapid repeated requests before calling the provider", async () => {
    ready();
    state.rpc.start_ai_run = { error: { code: "23505", message: "ai_run_in_progress" } };
    expect(await custom()).toMatchObject({
      message: expect.stringMatching(/already being prepared/),
    });
    expect(fetchSpy).not.toHaveBeenCalled();

    resetRateLimits(); // the refused attempt above counted towards the burst limit
    state.rpc.start_ai_run = { data: "run-1" };
    fetchSpy.mockImplementation(async () => answer(DRAFT));
    for (let i = 0; i < 3; i++) await custom();
    expect(await custom()).toMatchObject({ message: expect.stringMatching(/wait a minute/) });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("page load never calls the provider; buttons follow the configuration", async () => {
    const { default: Page } = await import("@/app/app/events/[eventId]/plan/page");
    setup("owner");
    const off = renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: EVENT }) }));
    expect(off).toContain("Generate template plan");
    expect(off).not.toContain("custom draft");
    enableAi();
    const on = renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: EVENT }) }));
    expect(on).toContain("Generate custom draft");
    expect(on).not.toMatch(/\bAI\b|Cloudflare|cloudflare|Workers/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("full custom drafts (AI_PLAN_STRATEGY=full, the default)", () => {
  const MODEL = "@cf/test/model-1";
  const ready = () => {
    setup("owner");
    vi.stubEnv("AI_PROVIDER", "cloudflare");
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-token-not-real");
    vi.stubEnv("AI_PLAN_MODEL", MODEL);
    state.rpc.start_ai_run = { data: "run-1" };
    state.rpc.finish_ai_run = { data: null };
  };
  const day = (offset: number) => {
    const start = (state.tables.events[0] as { starts_at: string }).starts_at;
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(
      new Date(Date.parse(start) + offset * 86_400_000),
    );
  };
  const FULL = () => ({
    summary: "A 24-hour campus hackathon in Dubai for 120 university students.",
    goals: ["Ship working prototypes."],
    tasks: [
      {
        id: "book_hall",
        title: "Book the main hall",
        description: "Reserve a hall for 120 people with power and Wi-Fi.",
        category: "venue",
        priority: "critical",
        anchor: "start",
        offsetDays: -30,
        owner: "Venue lead",
        dependsOn: [],
        evidence: ["answer:venue.on_campus"],
        confidence: "high",
        nextAction: "Ask facilities for available halls.",
      },
      {
        id: "order_food",
        title: "Order halal catering",
        description: "Three meals and snacks for 24 hours.",
        category: "catering",
        priority: "high",
        anchor: "start",
        offsetDays: -14,
        owner: "Catering lead",
        dependsOn: ["book_hall"],
        evidence: ["answer:catering.dietary"],
        confidence: "medium",
        nextAction: "Request two quotes.",
      },
      {
        id: "wrap_up",
        title: "Publish results",
        description: "Share winners and thank sponsors.",
        category: "closeout",
        priority: "low",
        anchor: "end",
        offsetDays: 2,
        owner: "Comms lead",
        dependsOn: [],
        evidence: [],
        confidence: "high",
        nextAction: "Draft the post.",
      },
    ],
    assumptions: ["Judging happens in the last two hours."],
    risks: [
      {
        title: "Wi-Fi overload",
        likelihood: "medium",
        mitigation: "Ask IT for a dedicated network.",
        contingency: "Bring hotspots.",
      },
    ],
    decisions: ["Pick the theme."],
    followUpQuestions: [],
    requirements: ["A hall for 120 with power at every table."],
    missingInformation: [],
    conflicts: [],
    budgetCategories: [
      { name: "Catering", estimatedAmount: 9000, note: "Three meals, illustrative." },
    ],
    budgetSummary: "About 9,000 AED of the 15,000 AED budget; illustrative, not quotes.",
    schedule: [
      { date: day(0), start: "12:00", end: "13:00", title: "Check-in", note: "" },
      { date: day(0), start: "13:00", end: "14:00", title: "Kick-off", note: "" },
    ],
  });
  const answer = (response: unknown) =>
    new Response(
      JSON.stringify({
        success: true,
        errors: [],
        result: { response, usage: { prompt_tokens: 500, completion_tokens: 1800 } },
      }),
      { status: 200 },
    );
  const custom = () => generatePlanAction(EVENT, {}, fd({ mode: "custom" }));

  it("the model writes everything; only event facts and answers are sent", async () => {
    ready();
    fetchSpy.mockResolvedValueOnce(answer(FULL()));
    expect(await custom()).toMatchObject({
      ok: true,
      message: expect.stringMatching(/Custom draft created/),
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    const user = body.messages[1].content as string;
    expect(user).toContain("ANSWERS (key = answer)");
    expect(user).toMatch(/starts: \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
    for (const s of ["BASELINE TASKS", "PLAYBOOK RISKS", "COMPLIANCE TOPICS", "playbook:"])
      expect(user).not.toContain(s);
    expect(body.response_format.json_schema.properties).toHaveProperty("schedule");
    expect(rpc("start_ai_run")[0]).toMatchObject({ p_prompt_version: "planning.full@2" });
    const overview = rpc("set_ai_plan_overview")[0].p_overview as Record<string, unknown>;
    expect(overview.budgetCategories).toEqual(FULL().budgetCategories);
    expect(overview.schedule).toEqual(FULL().schedule);
    expect(overview.requirements).toEqual(FULL().requirements);
    expect(rpc("save_ai_plan")[0]).toMatchObject({ p_source: "ai" });
  });

  it("sends the additional details, saves the model's conflicts and shows them on the plan", async () => {
    ready();
    (state.tables.events[0] as Record<string, unknown>).additional_details =
      "Please plan for 300 guests and a rooftop venue.";
    fetchSpy.mockResolvedValueOnce(
      answer({ ...FULL(), conflicts: ["Details mention 300 guests; the event capacity is 120."] }),
    );
    expect(await custom()).toMatchObject({ ok: true });
    const user = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body)).messages[1].content as string;
    expect(user).toContain("<<<\nPlease plan for 300 guests and a rooftop venue.\n>>>");
    expect(user).toContain("capacity: 120"); // structured fact still sent unchanged
    const overview = rpc("set_ai_plan_overview")[0].p_overview as { conflicts: string[] };
    expect(overview.conflicts).toEqual(["Details mention 300 guests; the event capacity is 120."]);

    state.tables.ai_plans = [
      {
        id: "plan-1",
        event_id: EVENT,
        status: "current",
        source: "ai",
        input_hash: rpc("save_ai_plan")[0].p_input_hash,
        assumptions: [],
        overview: {
          ...overview,
          summary: "A summary of the plan.",
          goals: [],
          requirements: [],
          missingInformation: [],
          decisions: [],
          followUpQuestions: [],
          budgetCategories: [],
          budgetSummary: "",
          risks: [],
          schedule: [],
        },
        is_mock: false,
        created_at: future(0),
        ai_run_id: "run-1",
      },
    ];
    state.tables.ai_runs = [{ id: "run-1", model: MODEL, prompt_version: "planning.full@2" }];
    const { default: Page } = await import("@/app/app/events/[eventId]/plan/page");
    const page = renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: EVENT }) }));
    expect(page).toContain("Your additional details disagree with your answers");
    expect(page).toContain("the event capacity is 120");
    expect(page).not.toContain("This plan is out of date");

    // Editing the details invalidates the custom draft: no request until the organizer regenerates.
    (state.tables.events[0] as Record<string, unknown>).additional_details = "A rooftop venue.";
    expect(
      renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: EVENT }) })),
    ).toContain("This plan is out of date");
    expect(await custom()).toMatchObject({ message: expect.stringMatching(/changed/) });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    fetchSpy.mockResolvedValueOnce(answer(FULL()));
    expect(
      await generatePlanAction(EVENT, {}, fd({ mode: "custom", intent: "regenerate" })),
    ).toMatchObject({ ok: true });
    const second = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body)).messages[1]
      .content as string;
    expect(second).toContain("<<<\nA rooftop venue.\n>>>");
  });

  it("template plans ignore the details, so editing them doesn't mark a template plan stale", async () => {
    ready();
    await generatePlanAction(EVENT, {}, fd({ mode: "template" }));
    state.tables.ai_plans = [
      {
        id: "plan-1",
        event_id: EVENT,
        status: "current",
        source: "playbook",
        input_hash: rpc("save_ai_plan")[0].p_input_hash,
        assumptions: [],
        overview: null,
        is_mock: false,
        created_at: future(0),
        ai_run_id: null,
      },
    ];
    (state.tables.events[0] as Record<string, unknown>).additional_details = "New detail.";
    const { default: Page } = await import("@/app/app/events/[eventId]/plan/page");
    const page = renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: EVENT }) }));
    expect(page).not.toContain("This plan is out of date");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a schedule outside the event days is rejected and nothing is saved", async () => {
    ready();
    const bad = FULL();
    bad.schedule = [{ date: day(30), start: "10:00", end: "11:00", title: "Wrong day", note: "" }];
    fetchSpy.mockResolvedValueOnce(answer(bad));
    expect(await custom()).toMatchObject({
      ok: false,
      message: expect.stringMatching(/didn't pass/),
    });
    expect(rpc("finish_ai_run")[0]).toMatchObject({ p_status: "invalid_output" });
    expect(rpc("save_ai_plan")).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("the playbook template stays available and makes no request", async () => {
    ready();
    expect(await generatePlanAction(EVENT, {}, fd({ mode: "template" }))).toMatchObject({
      ok: true,
    });
    expect(rpc("save_ai_plan")[0]).toMatchObject({ p_source: "playbook" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
