import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, fakeClient, member, type FakeState } from "../helpers/fake-supabase";
import { IDS, makeImpact } from "./fixtures";
import { resetRateLimits } from "@/lib/rate-limit";

// Recovery orchestration with an in-memory Supabase double and no external service. RLS and
// the RPC rules themselves are covered by tests/db/recovery.test.ts.

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

const actions = await import("@/modules/recovery/actions");

const EVENT = "11111111-1111-4111-8111-111111111111";
const OTHER_EVENT = "22222222-2222-4222-8222-222222222222";
const INCIDENT = "e0000000-0000-4000-8000-000000000001";
const PLAN = "f0000000-0000-4000-8000-000000000001";
const APPROVAL = "ab000000-0000-4000-8000-000000000001";
const TODAY = "2026-11-01";

const fd = (entries: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};
const rpc = (fn: string) =>
  state.rpcCalls.filter((c) => c.fn === fn).map((c) => c.args as Record<string, unknown>);
const RECOVERY_RPCS = [
  "simulate_venue_cancellation",
  "save_recovery_plan",
  "set_recovery_selection",
  "reject_recovery_plan",
  "close_incident",
  "resolve_recovery_flag",
  "update_recovery_inquiry",
  "discard_recovery_inquiry",
  "request_approval",
  "execute_recovery_approval",
  "execute_inquiry_approval",
  "start_ai_run",
];
const reachedDatabase = () => state.rpcCalls.filter((c) => RECOVERY_RPCS.includes(c.fn));

const fetchSpy = vi.fn();

function setup(
  role: "owner" | "organizer" | "viewer" | null,
  opts: { incidentStatus?: string; incidentEvent?: string; existingIncidents?: number } = {},
) {
  member(state, "user-1", ["organizer"]);
  state.tables.events = [
    {
      id: EVENT,
      owner_id: "owner",
      name: "Campus Hack",
      event_type: "university_hackathon",
      status: "planning",
      venue_type: "indoor",
      location_text: null,
      city: "Dubai",
      country: "AE",
      timezone: "Asia/Dubai",
      starts_at: "2026-12-01T05:00:00Z",
      ends_at: "2026-12-02T05:00:00Z",
      capacity: 100,
      budget_amount: 20000,
      currency: "AED",
    },
  ];
  state.tables.event_members = role ? [{ event_id: EVENT, user_id: "user-1", role }] : [];
  const row = (id: string, event: string) => ({
    id,
    event_id: event,
    booking_id: IDS.venueBooking,
    is_simulated: true,
    status: opts.incidentStatus ?? "assessing",
    simulated_at: "2026-11-01T08:00:00Z",
    note: null,
    impact: makeImpact(),
    resolution_note: null,
    closed_at: null,
    created_at: "2026-11-01T08:00:00Z",
  });
  state.tables.incidents = [
    row(INCIDENT, opts.incidentEvent ?? EVENT),
    ...Array.from({ length: opts.existingIncidents ?? 0 }, (_, i) => ({
      ...row(`e0000000-0000-4000-8000-00000000010${i}`, EVENT),
      status: "dismissed",
    })),
  ];
  state.tables.ai_runs = [];
  state.rpc.start_ai_run = { data: "run-1" };
  state.rpc.save_recovery_plan = { data: PLAN };
  state.tables.recovery_plans = [{ id: PLAN, event_id: EVENT, incident_id: INCIDENT }];
  state.tables.approvals = [];
}

const approvalRow = (over: Record<string, unknown> = {}) => ({
  id: APPROVAL,
  event_id: EVENT,
  action_type: "apply_recovery",
  target_id: PLAN,
  recipient_summary: "1 recovery change(s)",
  payload: {},
  payload_hash: "0".repeat(64),
  status: "approved",
  requested_by: "user-1",
  requested_at: "2026-11-01T08:00:00Z",
  decided_by: "user-1",
  decided_at: "2026-11-01T08:05:00Z",
  decision_note: null,
  executed_by: null,
  executed_at: null,
  result: null,
  failure_reason: null,
  ...over,
});

beforeEach(() => {
  resetRateLimits();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${TODAY}T08:00:00Z`));
  state = createFakeState({ sub: "user-1" });
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("authorization: nothing reaches the database for non-managers", () => {
  it("viewers, outsiders and other events' incidents are refused", async () => {
    for (const [role, message] of [
      ["viewer", /owner or organizers/],
      [null, /doesn't exist/],
    ] as const) {
      state = createFakeState({ sub: "user-1" });
      setup(role);
      for (const run of [
        () => actions.simulateAction(EVENT, {}, fd({ bookingId: IDS.venueBooking })),
        () => actions.generateRecoveryAction(EVENT, INCIDENT, {}, fd()),
        () => actions.selectChangesAction(EVENT, PLAN, {}, fd()),
        () => actions.rejectPlanAction(EVENT, PLAN, {}, fd({ reason: "Not workable" })),
        () =>
          actions.closeIncidentAction(
            EVENT,
            INCIDENT,
            {},
            fd({ outcome: "dismissed", reason: "Practice over" }),
          ),
        () => actions.requestApprovalAction(EVENT, "apply_recovery", PLAN, {}, fd()),
        () => actions.applyApprovedAction(EVENT, APPROVAL, {}, fd()),
        () => actions.recordInquiryAction(EVENT, APPROVAL, {}, fd()),
      ]) {
        expect(await run(), `${role}`).toMatchObject({
          ok: false,
          message: expect.stringMatching(message),
        });
      }
      expect(reachedDatabase(), `${role}`).toEqual([]);
      expect(rpc("save_recovery_plan")).toEqual([]);
    }
  });

  it("a signed-out caller is sent to sign in", async () => {
    state = createFakeState({ sub: null });
    setup("owner");
    await expect(actions.generateRecoveryAction(EVENT, INCIDENT, {}, fd())).rejects.toMatchObject({
      to: expect.stringMatching(/^\/sign-in/),
    });
    expect(reachedDatabase()).toEqual([]);
  });

  it("malformed ids are refused before anything else", async () => {
    setup("owner");
    expect(await actions.generateRecoveryAction("x", INCIDENT, {}, fd())).toMatchObject({
      ok: false,
    });
    expect(await actions.applyApprovedAction(EVENT, "../etc", {}, fd())).toMatchObject({
      ok: false,
    });
    expect(await actions.simulateAction(EVENT, {}, fd({ bookingId: "nope" }))).toMatchObject({
      ok: false,
    });
    expect(reachedDatabase()).toEqual([]);
  });

  it("an incident of another event is not found", async () => {
    setup("owner", { incidentEvent: OTHER_EVENT });
    expect(await actions.generateRecoveryAction(EVENT, INCIDENT, {}, fd())).toMatchObject({
      ok: false,
      message: expect.stringMatching(/isn't part of this event/),
    });
    expect(reachedDatabase()).toEqual([]);
  });

  it("a closed incident cannot get a new proposal, and nothing is stored", async () => {
    setup("owner", { incidentStatus: "resolved" });
    expect(await actions.generateRecoveryAction(EVENT, INCIDENT, {}, fd())).toMatchObject({
      ok: false,
    });
    expect(rpc("save_recovery_plan")).toEqual([]);
  });
});

describe("idempotency", () => {
  it("repeated simulation requests carry the same key; a booking with history gets the next one", async () => {
    setup("owner");
    state.rpc.simulate_venue_cancellation = { data: { id: INCIDENT, created: true } };
    const first = await actions.simulateAction(EVENT, {}, fd({ bookingId: IDS.venueBooking }));
    state.rpc.simulate_venue_cancellation = { data: { id: INCIDENT, created: false } };
    const second = await actions.simulateAction(EVENT, {}, fd({ bookingId: IDS.venueBooking }));
    const keys = rpc("simulate_venue_cancellation").map((a) => a.p_idempotency_key);
    expect(keys).toEqual([`sim:${IDS.venueBooking}:1`, `sim:${IDS.venueBooking}:1`]);
    expect(first.message).toMatch(/recorded/);
    expect(second.message).toMatch(/already simulated/);

    state = createFakeState({ sub: "user-1" });
    setup("owner", { existingIncidents: 2 });
    state.rpc.simulate_venue_cancellation = { data: { id: INCIDENT, created: true } };
    await actions.simulateAction(EVENT, {}, fd({ bookingId: IDS.venueBooking }));
    expect(rpc("simulate_venue_cancellation")[0].p_idempotency_key).toBe(
      `sim:${IDS.venueBooking}:3`,
    );
  });
});

describe("generating a proposal", () => {
  it("stores a rule-checked proposal from the playbook; applies and sends nothing", async () => {
    setup("owner");
    const r = await actions.generateRecoveryAction(EVENT, INCIDENT, {}, fd());
    expect(r).toMatchObject({
      ok: true,
      message: expect.stringMatching(/Nothing has been applied/),
    });
    expect(r.message).not.toMatch(/\bAI\b|mock|Mock/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(rpc("start_ai_run")[0]).toMatchObject({
      p_pipeline: "recovery",
      p_provider: "playbook",
      p_is_mock: false,
    });
    expect(rpc("finish_ai_run")[0]).toMatchObject({ p_status: "succeeded" });
    const [saved] = rpc("save_recovery_plan");
    expect(saved).toMatchObject({ p_incident_id: INCIDENT, p_ai_run_id: "run-1" });
    const changes = saved.p_changes as { kind: string; entity_type: string | null }[];
    expect(new Set(changes.map((c) => c.kind))).toEqual(
      new Set(["reschedule_task", "add_task", "flag_review"]),
    );
    expect(changes.filter((c) => c.entity_type === "booking")).toHaveLength(1);
    expect(JSON.stringify(saved)).not.toMatch(/cancel_booking/);
    // No approval, execution or message RPC was triggered by generating.
    for (const fn of [
      "request_approval",
      "execute_recovery_approval",
      "claim_approval",
      "finish_communication",
    ]) {
      expect(rpc(fn)).toEqual([]);
    }
  });

  it("the stored proposal never claims availability, prices or confirmations", async () => {
    setup("owner");
    await actions.generateRecoveryAction(EVENT, INCIDENT, {}, fd());
    const text = JSON.stringify(rpc("save_recovery_plan")[0]);
    expect(text).not.toMatch(/is available|has been confirmed|is confirmed/i);
  });
});

describe("approvals", () => {
  it("an approval of the wrong type or another event can't be executed here", async () => {
    setup("owner");
    state.tables.approvals = [
      approvalRow({ action_type: "send_communication" }),
      approvalRow({ id: "ab000000-0000-4000-8000-000000000002", event_id: OTHER_EVENT }),
    ];
    for (const id of [
      APPROVAL,
      "ab000000-0000-4000-8000-000000000002",
      "ab000000-0000-4000-8000-000000000009",
    ]) {
      expect(await actions.applyApprovedAction(EVENT, id, {}, fd())).toMatchObject({
        ok: false,
        message: expect.stringMatching(/isn't part of this event/),
      });
    }
    expect(rpc("execute_recovery_approval")).toEqual([]);
  });

  it("applying calls the one-transaction RPC and reports a superseded approval honestly", async () => {
    setup("owner");
    state.tables.approvals = [approvalRow()];
    state.rpc.execute_recovery_approval = { data: "executed" };
    expect(await actions.applyApprovedAction(EVENT, APPROVAL, {}, fd())).toMatchObject({
      ok: true,
      message: expect.stringMatching(/bookings were not cancelled/),
    });
    state.rpc.execute_recovery_approval = { data: "superseded" };
    expect(await actions.applyApprovedAction(EVENT, APPROVAL, {}, fd())).toMatchObject({
      message: expect.stringMatching(/nothing was applied/),
    });
    expect(rpc("execute_recovery_approval")).toHaveLength(2);
  });

  it("inquiries are only ever recorded as simulated", async () => {
    setup("owner");
    state.tables.approvals = [approvalRow({ action_type: "send_provider_inquiry" })];
    state.rpc.execute_inquiry_approval = { data: "executed" };
    expect(await actions.recordInquiryAction(EVENT, APPROVAL, {}, fd())).toMatchObject({
      ok: true,
      message: expect.stringMatching(/No provider was contacted/),
    });
  });

  it("database refusals become readable messages", async () => {
    setup("owner");
    state.rpc.request_approval = {
      error: { code: "23514", message: "nothing_selected: select at least one change" },
    };
    expect(
      await actions.requestApprovalAction(EVENT, "apply_recovery", PLAN, {}, fd()),
    ).toMatchObject({
      ok: false,
      message: "Select at least one change to apply.",
    });
    state.rpc.close_incident = {
      error: { code: "23514", message: "plan_not_applied: apply an approved plan" },
    };
    expect(
      await actions.closeIncidentAction(
        EVENT,
        INCIDENT,
        {},
        fd({ outcome: "resolved", reason: "Done well" }),
      ),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Apply an approved recovery plan/),
    });
  });

  it("the selection form passes only valid ids", async () => {
    setup("owner");
    const a = "f1000000-0000-4000-8000-000000000001";
    const f = new FormData();
    f.append("changeId", a);
    expect(await actions.selectChangesAction(EVENT, PLAN, {}, f)).toMatchObject({ ok: true });
    expect(rpc("set_recovery_selection")[0]).toMatchObject({ p_plan_id: PLAN, p_change_ids: [a] });
    const bad = new FormData();
    bad.append("changeId", "1; drop table");
    expect(await actions.selectChangesAction(EVENT, PLAN, {}, bad)).toMatchObject({ ok: false });
    expect(rpc("set_recovery_selection")).toHaveLength(1);
  });
});
