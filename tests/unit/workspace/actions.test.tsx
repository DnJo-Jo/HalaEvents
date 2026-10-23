import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, fakeClient, member, type FakeState } from "../helpers/fake-supabase";

// Workspace, compliance and notification actions with an in-memory Supabase double. These check
// that the app refuses before reaching the database; tests/db/{workspace,compliance}.test.ts check
// that the database refuses too.

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

const tasks = await import("@/modules/tasks/actions");
const events = await import("@/modules/events/actions");
const compliance = await import("@/modules/compliance/actions");
const notifications = await import("@/modules/notifications/actions");

const EVENT = "11111111-1111-4111-8111-111111111111";
const OTHER_EVENT = "22222222-2222-4222-8222-222222222222";
const TA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CHECK = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SOURCE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const PLAN = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const VIEWER = "99999999-9999-4999-8999-999999999999";
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

const task = (id: string, status = "todo", event_id = EVENT) => ({
  id,
  event_id,
  title: `Task ${id.slice(0, 2)}`,
  description: "",
  category: "logistics",
  priority: "medium",
  status,
  due_date: null,
  owner_user_id: null,
  owner_label: null,
  origin: "manual",
  completed_at: null,
  updated_at: future(0),
});

function setup(
  role: "owner" | "organizer" | "viewer" | null,
  opts: { status?: string; admin?: boolean } = {},
) {
  member(state, "user-1", ["organizer"], { admin: opts.admin });
  state.tables.events = [
    {
      id: EVENT,
      owner_id: "user-1",
      name: "Campus Hack",
      event_type: "university_hackathon",
      status: opts.status ?? "planning",
      venue_type: "indoor",
      location_text: null,
      city: "Dubai",
      country: "AE",
      timezone: "Asia/Dubai",
      starts_at: future(40),
      ends_at: future(41),
      capacity: 120,
      budget_amount: null,
      currency: "AED",
    },
  ];
  state.tables.event_members = [
    ...(role ? [{ event_id: EVENT, user_id: "user-1", role }] : []),
    { event_id: EVENT, user_id: VIEWER, role: "viewer" },
  ];
  state.tables.tasks = [
    task(TA),
    task(TB),
    task(TC),
    task("12121212-1212-4212-8212-121212121212", "todo", OTHER_EVENT),
  ];
  state.tables.task_dependencies = [
    { event_id: EVENT, task_id: TB, depends_on_task_id: TA },
    { event_id: EVENT, task_id: TC, depends_on_task_id: TB },
  ];
  state.tables.interview_answers = [];
  state.tables.ai_suggestions = [];
  state.tables.knowledge_sources = [
    {
      id: SOURCE,
      key: "det_event_permit",
      url: "https://www.dubaidet.gov.ae/en/x",
      title: "Apply for an event permit",
      authority: "Dubai Department of Economy and Tourism (DET)",
      jurisdiction: "AE-DU",
      scope: "",
      source_type: "official_gov",
      summary: "Search summary text",
      summary_kind: "search_result_summary",
      retrieval_status: "blocked",
      retrieved_at: "2026-10-22T09:00:00Z",
      retrieval_note: "HTTP 403",
      last_verified_at: null,
      verification_note: null,
    },
  ];
  state.tables.compliance_checks = [
    {
      id: CHECK,
      event_id: EVENT,
      topic_key: "event_permit",
      category: "permit",
      title: "Event permit or activity approval",
      description: "",
      reason: "Flagged because the venue is off campus.",
      origin: "rule",
      severity: "concern",
      applicability: "likely_applies",
      status: "under_review",
      status_reason: null,
      status_set_by: null,
      status_changed_at: null,
      reviewer_user_id: "someone-else" as string | null,
      next_action: "Ask DET.",
      official_channel_id: SOURCE,
      created_at: future(0),
      updated_at: future(0),
    },
  ];
  state.tables.compliance_references = [
    { id: "r1", check_id: CHECK, source_id: SOURCE, relevance_note: "", created_at: future(0) },
  ];
  state.tables.compliance_evidence = [];
  state.tables.official_submissions = [];
  state.tables.notifications = [];
  state.rpc.event_member_directory = {
    data: [
      { user_id: "user-1", display_name: "Sara", role: role ?? "owner" },
      { user_id: VIEWER, display_name: "Viewer Vic", role: "viewer" },
    ],
  };
  state.rpc.event_timeline = { data: [] };
  state.rpc.accept_ai_plan = { data: 3 };
  state.rpc.refresh_event_notifications = { data: 1 };
  state.rpc.sync_compliance_checks = { data: 2 };
}

const fd = (entries: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};
const writes = () => state.writes.filter((w) => w.op !== "select");
const rpcNames = () => state.rpcCalls.map((c) => c.fn);

beforeEach(() => {
  state = createFakeState({ sub: "user-1" });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
});

describe("tasks", () => {
  it("viewers and outsiders can't create or change tasks", async () => {
    for (const role of ["viewer", null] as const) {
      setup(role);
      const r = await tasks.createTaskAction(EVENT, {}, fd({ title: "New task" }));
      expect(r.ok).toBe(false);
      expect(writes()).toHaveLength(0);
    }
  });

  it("invalid transitions and done-while-blocked are refused before the database", async () => {
    setup("organizer");
    state.tables.tasks[0] = task(TA, "done");
    const bad = await tasks.changeTaskStatusAction(EVENT, TA, {}, fd({ status: "cancelled" }));
    expect(bad).toMatchObject({ ok: false, message: "A task can't go from done to cancelled." });
    state.tables.tasks[0] = task(TA, "in_progress");
    const blocked = await tasks.changeTaskStatusAction(EVENT, TB, {}, fd({ status: "done" }));
    expect(blocked.message).toMatch(/blocked/);
    expect(writes()).toHaveLength(0);
    const ok = await tasks.changeTaskStatusAction(EVENT, TA, {}, fd({ status: "done" }));
    expect(ok.ok).toBe(true);
    expect(writes()).toEqual([
      expect.objectContaining({ table: "tasks", op: "update", values: { status: "done" } }),
    ]);
  });

  it("cyclic and cross-event dependencies are refused; owners must be managers", async () => {
    setup("owner");
    const cycle = await tasks.addDependencyAction(EVENT, TA, {}, fd({ dependsOn: TC }));
    expect(cycle.message).toMatch(/loop/);
    const foreign = await tasks.addDependencyAction(
      EVENT,
      TA,
      {},
      fd({ dependsOn: "12121212-1212-4212-8212-121212121212" }),
    );
    expect(foreign.message).toMatch(/isn't part of this event/);
    const owner = await tasks.assignTaskAction(
      EVENT,
      TA,
      {},
      fd({ ownerUserId: VIEWER, dueDate: "" }),
    );
    expect(owner.message).toMatch(/owner or one of its organizers/);
    expect(writes()).toHaveLength(0);
  });

  it("accepting a plan goes through the RPC and refreshes reminders", async () => {
    setup("owner");
    const r = await tasks.acceptPlanAction(EVENT, PLAN, {}, fd());
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining("3 tasks") });
    expect(rpcNames()).toEqual(
      expect.arrayContaining(["accept_ai_plan", "refresh_event_notifications"]),
    );
  });
});

describe("event details and lifecycle", () => {
  it("only allowed status changes reach the database", async () => {
    setup("organizer", { status: "draft" });
    const bad = await events.changeEventStatusAction(EVENT, {}, fd({ status: "live" }));
    expect(bad).toMatchObject({ ok: false, message: "An event can't go from draft to live." });
    expect(writes()).toHaveLength(0);
    const ok = await events.changeEventStatusAction(EVENT, {}, fd({ status: "planning" }));
    expect(ok.ok).toBe(true);
    setup("viewer");
    expect((await events.changeEventStatusAction(EVENT, {}, fd({ status: "ready" }))).ok).toBe(
      false,
    );
  });

  it("finished events can't be edited", async () => {
    setup("owner", { status: "completed" });
    const r = await events.updateEventAction(
      EVENT,
      {},
      fd({
        name: "Renamed",
        timezone: "Asia/Dubai",
        startsAt: "2026-12-01T09:00",
        endsAt: "2026-12-02T09:00",
        capacity: "10",
      }),
    );
    expect(r.message).toMatch(/completed/);
    expect(writes()).toHaveLength(0);
  });
});

describe("compliance", () => {
  it("running checks sends rule results only (automatic states) and needs a manager", async () => {
    setup("owner");
    await compliance.runChecksAction(EVENT, {}, fd());
    const call = state.rpcCalls.find((c) => c.fn === "sync_compliance_checks")!;
    const items = (call.args as { p_items: { status: string }[] }).p_items;
    expect(items.length).toBeGreaterThan(0);
    expect(
      items.every((i) => ["not_assessed", "needs_information", "conditional"].includes(i.status)),
    ).toBe(true);
    setup("viewer");
    state.rpcCalls = [];
    expect((await compliance.runChecksAction(EVENT, {}, fd())).ok).toBe(false);
    expect(rpcNames()).not.toContain("sync_compliance_checks");
  });

  it("only the reviewer (or an admin) clears, and only with real evidence", async () => {
    setup("owner");
    const notReviewer = await compliance.changeCheckStatusAction(
      EVENT,
      CHECK,
      {},
      fd({ status: "cleared", reason: "Looks fine" }),
    );
    expect(notReviewer.message).toMatch(/assigned reviewer/);
    expect(notReviewer.message).toMatch(/real \(not simulated\) evidence/);
    state.tables.compliance_checks[0].reviewer_user_id = "user-1";
    state.tables.compliance_evidence = [
      {
        id: "e1",
        check_id: CHECK,
        kind: "submission_reference",
        value: "Simulated DEMO-1",
        is_simulated: true,
        recorded_by: null,
        recorded_at: future(0),
      },
    ];
    const simulatedOnly = await compliance.changeCheckStatusAction(
      EVENT,
      CHECK,
      {},
      fd({ status: "cleared", reason: "Demo reply" }),
    );
    expect(simulatedOnly.message).toMatch(/real \(not simulated\) evidence/);
    expect(rpcNames()).not.toContain("set_compliance_status");
    state.tables.compliance_evidence.push({
      id: "e2",
      check_id: CHECK,
      kind: "reference_number",
      value: "REF-1",
      is_simulated: false,
      recorded_by: "user-1",
      recorded_at: future(0),
    });
    const ok = await compliance.changeCheckStatusAction(
      EVENT,
      CHECK,
      {},
      fd({ status: "cleared", reason: "Venue letter REF-1" }),
    );
    expect(ok.ok).toBe(true);
    expect(state.rpcCalls.find((c) => c.fn === "set_compliance_status")?.args).toEqual({
      p_check_id: CHECK,
      p_status: "cleared",
      p_reason: "Venue letter REF-1",
    });
  });

  it("platform admins can decide; viewers can't change status or add evidence", async () => {
    setup("viewer");
    expect(
      (
        await compliance.changeCheckStatusAction(
          EVENT,
          CHECK,
          {},
          fd({ status: "rejected", reason: "No" }),
        )
      ).ok,
    ).toBe(false);
    expect(
      (
        await compliance.addEvidenceAction(
          EVENT,
          CHECK,
          {},
          fd({ kind: "note", value: "Viewer note" }),
        )
      ).ok,
    ).toBe(false);
    expect(rpcNames()).not.toContain("add_compliance_evidence");
    setup(null, { admin: true });
    const r = await compliance.changeCheckStatusAction(
      EVENT,
      CHECK,
      {},
      fd({ status: "rejected", reason: "Flagged by mistake" }),
    );
    expect(r.ok).toBe(true);
  });

  it("source_supported is unavailable until a referenced source is verified", async () => {
    setup("owner");
    state.tables.compliance_checks[0].status = "conditional";
    const r = await compliance.changeCheckStatusAction(
      EVENT,
      CHECK,
      {},
      fd({ status: "source_supported" }),
    );
    expect(r.message).toMatch(/verified/);
    state.tables.knowledge_sources[0].last_verified_at = future(0);
    state.tables.knowledge_sources[0].verification_note = "Checked live page";
    expect(
      (
        await compliance.changeCheckStatusAction(
          EVENT,
          CHECK,
          {},
          fd({ status: "source_supported" }),
        )
      ).ok,
    ).toBe(true);
  });

  it("evidence links must be https; simulated submissions say nothing was sent", async () => {
    setup("owner");
    const bad = await compliance.addEvidenceAction(
      EVENT,
      CHECK,
      {},
      fd({ kind: "link", value: "javascript:alert(1)" }),
    );
    expect(bad.ok).toBe(false);
    const sim = await compliance.simulateSubmissionAction(EVENT, CHECK, {}, fd());
    expect(sim.message).toMatch(/nothing was sent/);
    expect(rpcNames()).toContain("simulate_official_submission");
  });

  it("only admins verify sources", async () => {
    setup("owner");
    const r = await compliance.setSourceVerificationAction(
      SOURCE,
      {},
      fd({ verified: "true", note: "Checked today" }),
    );
    expect(r).toMatchObject({ ok: false, message: "Only platform admins can verify sources." });
  });
});

describe("notifications", () => {
  it("reminders include missing plan information from the playbook", async () => {
    setup("owner");
    await notifications.refreshRemindersAction(EVENT, {}, fd());
    const call = state.rpcCalls.find((c) => c.fn === "refresh_event_notifications")!;
    const missing = (call.args as { p_missing: { key: string }[] }).p_missing.map((m) => m.key);
    expect(missing).toEqual(expect.arrayContaining(["audience.level", "venue.on_campus"]));
  });
});

describe("pages", () => {
  const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);

  it("task board shows blocked state and hides edit forms from viewers", async () => {
    setup("viewer");
    const { default: Page } = await import("@/app/app/events/[eventId]/tasks/page");
    const out = await html(Page({ params: Promise.resolve({ eventId: EVENT }) }));
    expect(out).toContain("Blocked");
    expect(out).toContain("Depends on");
    expect(out).not.toContain("Add a task");
    expect(out).not.toContain("Change task");
  });

  it("check page explains the flag, labels sources unverified and the official application as a demo", async () => {
    setup("owner");
    const { default: Page } = await import("@/app/app/events/[eventId]/compliance/[checkId]/page");
    const out = await html(Page({ params: Promise.resolve({ eventId: EVENT, checkId: CHECK }) }));
    expect(out).toContain("Why this was flagged");
    expect(out).toContain("Flagged by a fixed HalaEvents rule from your answers");
    expect(out).toContain("Not verified");
    expect(out).toContain("Search-result summary, not the page");
    expect(out).toContain("Demonstration only");
    expect(out).toContain("Simulated · demo");
    expect(out).toContain("Only the assigned reviewer or a platform admin decides.");
  });

  it("source registry says live verification is unavailable", async () => {
    setup("owner");
    const { default: Page } = await import("@/app/app/compliance/page");
    const out = await html(Page());
    expect(out).toContain("Live verification is unavailable");
    expect(out).toContain("Not verified");
    expect(out).not.toContain("I checked the live page today"); // not an admin
  });
});
