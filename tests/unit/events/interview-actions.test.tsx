import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, fakeClient, member, type FakeState } from "../helpers/fake-supabase";

// Authorization of the interview action and a render smoke test of the page, with an in-memory
// Supabase double. RLS and the RPC itself are covered on PGlite in tests/db/interview.test.ts;
// nothing here has run against a live Supabase.

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

const { saveInterviewAction, saveEventDetailsAction } = await import("@/modules/events/actions");

const EVENT = "11111111-1111-4111-8111-111111111111";
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

function form(entries: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of [v].flat()) f.append(k, x);
  return f;
}

const round1 = {
  round: [
    "audience.level",
    "format.team_size",
    "format.overnight",
    "venue.on_campus",
    "catering.provided",
  ],
  "audience.level": "school_students",
  "format.team_size": "4",
  "format.overnight": "yes",
  "venue.on_campus": "no",
  "catering.provided": "yes",
  $ACTION_ID_abc: "",
};

function setup(role: "owner" | "organizer" | "viewer" | null, status = "planning") {
  member(state, "user-1", ["organizer"]);
  state.tables.events = [
    {
      id: EVENT,
      owner_id: "owner",
      name: "Campus Hack",
      event_type: "university_hackathon",
      status,
      venue_type: "indoor",
      location_text: null,
      city: "Dubai",
      country: "AE",
      timezone: "Asia/Dubai",
      starts_at: future(30),
      ends_at: future(31.5), // 36 h: the overnight question applies
      capacity: 120,
      budget_amount: null,
      currency: "AED",
    },
  ];
  state.tables.event_members = role ? [{ event_id: EVENT, user_id: "user-1", role }] : [];
  state.tables.interview_answers = [];
}

beforeEach(() => {
  state = createFakeState({ sub: "user-1" });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
});

const saves = () => state.rpcCalls.filter((c) => c.fn === "save_interview_answers");

describe("saveInterviewAction", () => {
  it("an organizer's valid round is validated and saved through the RPC", async () => {
    setup("organizer");
    const result = await saveInterviewAction(EVENT, {}, form(round1));
    expect(result).toMatchObject({ ok: true });
    expect(saves()).toEqual([
      {
        fn: "save_interview_answers",
        args: {
          p_event_id: EVENT,
          p_playbook_id: "university-hackathon",
          p_playbook_version: 3,
          p_answers: {
            "audience.level": "school_students",
            "format.team_size": 4,
            "format.overnight": true,
            "venue.on_campus": false,
            "catering.provided": true,
          },
          p_remove_keys: [],
        },
      },
    ]);
  });

  it("viewers, outsiders and locked events never reach the database", async () => {
    for (const [role, status, message] of [
      ["viewer", "planning", /owner or organizers/],
      [null, "planning", /doesn't exist/],
      ["owner", "live", /This event is live/],
      ["owner", "cancelled", /This event is cancelled/],
    ] as const) {
      state = createFakeState({ sub: "user-1" });
      setup(role, status);
      const result = await saveInterviewAction(EVENT, {}, form(round1));
      expect(result, `${role}/${status}`).toMatchObject({
        ok: false,
        message: expect.stringMatching(message),
      });
      expect(saves()).toEqual([]);
    }
  });

  it("signed-out callers are sent to sign in", async () => {
    state = createFakeState({ sub: null });
    setup("owner");
    await expect(saveInterviewAction(EVENT, {}, form(round1))).rejects.toMatchObject({
      to: expect.stringMatching(/^\/sign-in/),
    });
    expect(saves()).toEqual([]);
  });

  it("invalid answers and forged rounds return field errors without saving", async () => {
    setup("owner");
    const bad = await saveInterviewAction(
      EVENT,
      {},
      form({ ...round1, "audience.level": "aliens", "format.team_size": "50" }),
    );
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.fieldErrors ?? {}).sort()).toEqual([
      "audience.level",
      "format.team_size",
    ]);
    const forged = await saveInterviewAction(EVENT, {}, form({ ...round1, round: ["custom.x"] }));
    expect(forged.fieldErrors).toHaveProperty("form");
    expect(await saveInterviewAction("not-a-uuid", {}, form(round1))).toMatchObject({ ok: false });
    expect(saves()).toEqual([]);
  });

  it("changing a parent answer removes the answers that depended on it", async () => {
    setup("owner");
    state.tables.interview_answers = [
      { event_id: EVENT, question_key: "audience.level", answer: "school_students" },
      { event_id: EVENT, question_key: "audience.min_age", answer: 12 },
    ];
    await saveInterviewAction(
      EVENT,
      {},
      form({ round: ["audience.level"], "audience.level": "university_students" }),
    );
    expect(saves()[0].args).toMatchObject({
      p_answers: { "audience.level": "university_students" },
      p_remove_keys: ["audience.min_age"],
    });
  });
});

describe("interview page", () => {
  const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);
  const render = async () => {
    const { default: Page } = await import("@/app/app/events/[eventId]/interview/page");
    return html(Page({ params: Promise.resolve({ eventId: EVENT }) }));
  };

  it("managers get the next round as a form, with the playbook labelled", async () => {
    setup("owner");
    const out = await render();
    expect(out).toContain("Who is the hackathon for?");
    expect(out).toContain('name="round" value="audience.level"');
    expect(out).toContain("Playbook: University hackathon");
    expect(out).toContain("Nothing here is a legal or permit requirement");
    expect(out).toContain("Save answers");
    expect(out).not.toContain("What is the minimum participant age?");
  });

  it("school-student answers bring up the age and consent questions", async () => {
    setup("owner");
    state.tables.interview_answers = [
      { event_id: EVENT, question_key: "audience.level", answer: "school_students" },
    ];
    const out = await render();
    expect(out).toContain("What is the minimum participant age?");
    expect(out).toContain("Who will collect guardian consent");
  });

  it("viewers see answers read-only", async () => {
    setup("viewer");
    state.tables.interview_answers = [
      { event_id: EVENT, question_key: "audience.level", answer: "mixed" },
    ];
    const out = await render();
    expect(out).toContain("Read only");
    expect(out).toContain("Mixed: school and university students");
    expect(out).not.toContain("Save answers");
  });

  it("non-members get a 404", async () => {
    setup(null);
    await expect(render()).rejects.toMatchObject({ notFound: true });
  });
});

describe("additional event details", () => {
  const render = async () => {
    const { default: Page } = await import("@/app/app/events/[eventId]/interview/page");
    return renderToStaticMarkup(await Page({ params: Promise.resolve({ eventId: EVENT }) }));
  };
  const details = () =>
    state.rpcCalls.filter((c) => c.fn === "save_event_details").map((c) => c.args);
  const send = (text: string) => saveEventDetailsAction(EVENT, {}, form({ details: text }));

  it("owners and organizers save it (trimmed); empty text clears it", async () => {
    for (const role of ["owner", "organizer"] as const) {
      state = createFakeState({ sub: "user-1" });
      setup(role);
      expect(await send("  Shuttle from the main gate every 30 minutes.\r\n")).toMatchObject({
        ok: true,
        message: expect.stringMatching(/Regenerate the plan/),
      });
      expect(details()).toEqual([
        { p_event_id: EVENT, p_details: "Shuttle from the main gate every 30 minutes." },
      ]);
    }
    expect(await send("   ")).toMatchObject({ ok: true, message: "Additional details removed." });
    expect(details().at(-1)).toEqual({ p_event_id: EVENT, p_details: "" });
  });

  it("viewers, outsiders and locked events can't change it; too long is a field error", async () => {
    for (const [role, status, message] of [
      ["viewer", "planning", /owner or organizers/],
      [null, "planning", /doesn't exist/],
      ["owner", "live", /details can't be changed/],
    ] as const) {
      state = createFakeState({ sub: "user-1" });
      setup(role, status);
      expect(await send("x")).toMatchObject({ ok: false, message: expect.stringMatching(message) });
    }
    state = createFakeState({ sub: "user-1" });
    setup("owner");
    expect(await send("x".repeat(3001))).toMatchObject({
      ok: false,
      fieldErrors: { details: [expect.stringMatching(/3000/)] },
    });
    expect(details()).toEqual([]);
    expect(await saveEventDetailsAction("nope", {}, form({ details: "x" }))).toMatchObject({
      ok: false,
    });
  });

  it("the interview page shows an optional, editable section with examples; viewers read it", async () => {
    setup("owner");
    (state.tables.events[0] as Record<string, unknown>).additional_details = "Prayer room needed.";
    const out = await render();
    expect(out).toContain("Additional event details");
    expect(out).toContain("Optional.");
    expect(out).toContain('name="details"');
    expect(out).toContain("Prayer room needed.");
    for (const s of [
      "Venue:",
      "Catering:",
      "Transport:",
      "Accessibility:",
      "Equipment:",
      "Special arrangements:",
    ])
      expect(out).toContain(s);
    setup("viewer");
    (state.tables.events[0] as Record<string, unknown>).additional_details = "Prayer room needed.";
    const ro = await render();
    expect(ro).toContain("Prayer room needed.");
    expect(ro).not.toContain('name="details"');
  });
});
