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
afterEach(() => vi.unstubAllGlobals());

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
      message: expect.stringMatching(/Regenerate plan/),
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
