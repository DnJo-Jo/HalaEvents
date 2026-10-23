import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildPlan } from "@/modules/planning/engine";
import { evidenceCatalog, planContext, resolvePlan } from "@/modules/planning/rules";
import { PlanOverview, StoredTask } from "@/modules/planning/schemas";
import { answerContext, eventContext, interviewState } from "@/modules/events/interview-rules";
import { playbookFor } from "@/playbooks";
import { TestDb } from "./harness";

let db: TestDb;
let owner: string;
let organizer: string;
let viewer: string;
let outsider: string;
let eventId: string;

const HASH = "a".repeat(64);
const task = (key: string) => ({ key, payload: { tempId: key, title: `Task ${key}` } });

async function createEvent(ownerId: string): Promise<string> {
  const [{ id }] = await db.user(ownerId).query<{ id: string }>(
    `insert into public.events (owner_id, name, starts_at, ends_at, capacity)
       values ($1, 'AI Hackathon', '2026-12-01T09:00:00+04', '2026-12-02T18:00:00+04', 100) returning id`,
    [ownerId],
  );
  return id;
}

const START = "select public.start_ai_run($1, $2, 'gemini', 'gemini-test', $3, false) as id";
async function startRun(who: string, pipeline = "plan", event = eventId): Promise<string> {
  const [{ id }] = await db.user(who).query<{ id: string }>(START, [event, pipeline, HASH]);
  return id;
}
async function finishRun(who: string, runId: string, status = "succeeded") {
  await db
    .user(who)
    .query("select public.finish_ai_run($1, $2, null, 1, 1200, 900, 300, 'gemini-test-001')", [
      runId,
      status,
    ]);
}
async function succeededRun(who: string, pipeline = "plan", event = eventId) {
  const id = await startRun(who, pipeline, event);
  await finishRun(who, id);
  return id;
}
const SAVE_PLAN =
  "select public.save_ai_plan($1, $2, $3, $4, 'university-hackathon', 2, '[\"assumption\"]'::jsonb, $5::jsonb) as id";
const savePlan = (
  who: string,
  runId: string | null,
  source: string,
  tasks: unknown[],
  event = eventId,
) =>
  db
    .user(who)
    .query<{ id: string }>(SAVE_PLAN, [event, runId, source, HASH, JSON.stringify(tasks)]);

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createMember("owner@example.test");
  organizer = await db.createMember("co@example.test");
  viewer = await db.createMember("viewer@example.test");
  outsider = await db.createMember("outsider@example.test");
  eventId = await createEvent(owner);
  await db
    .user(owner)
    .query(
      "insert into public.event_members (event_id, user_id, role) values ($1, $2, 'organizer'), ($1, $3, 'viewer')",
      [eventId, organizer, viewer],
    );
});
afterAll(() => db.close());

describe("AI runs", () => {
  it("one running call per event and pipeline (duplicate requests are refused)", async () => {
    const run = await startRun(owner);
    expect(await db.user(organizer).error(START, [eventId, "plan", HASH])).toMatch(
      /ai_run_in_progress/,
    );
    await startRun(organizer, "interview"); // other pipeline is fine
    await finishRun(owner, run, "rate_limited");
    const again = await startRun(organizer);
    await finishRun(organizer, again, "failed");
    const [row] = await db.sql<{
      status: string;
      input_tokens: number;
      finished_at: string | null;
    }>("select status, input_tokens, finished_at from public.ai_runs where id = $1", [run]);
    expect(row).toMatchObject({ status: "rate_limited", input_tokens: 900 });
    expect(row.finished_at).not.toBeNull();
    await db.sql(
      "update public.ai_runs set status = 'failed', finished_at = now() where status = 'running'",
    );
  });

  it("a run abandoned for 3 minutes no longer blocks new runs", async () => {
    const stuck = await startRun(owner);
    await db.sql(
      "update public.ai_runs set created_at = now() - interval '4 minutes' where id = $1",
      [stuck],
    );
    const fresh = await startRun(owner);
    const [row] = await db.sql<{ status: string; error_code: string }>(
      "select status, error_code from public.ai_runs where id = $1",
      [stuck],
    );
    expect(row).toEqual({ status: "failed", error_code: "abandoned" });
    await finishRun(owner, fresh, "failed");
  });

  it("only the caller can finish their run, once, and never back to running", async () => {
    const run = await startRun(owner);
    expect(
      await db
        .user(organizer)
        .error("select public.finish_ai_run($1, 'succeeded', null, 1, 1, 0, 0, '')", [run]),
    ).toMatch(/not_found/);
    expect(
      await db
        .user(owner)
        .error("select public.finish_ai_run($1, 'running', null, 1, 1, 0, 0, '')", [run]),
    ).toMatch(/invalid_transition/);
    await finishRun(owner, run, "failed");
    expect(
      await db
        .user(owner)
        .error("select public.finish_ai_run($1, 'succeeded', null, 1, 1, 0, 0, '')", [run]),
    ).toMatch(/not_found/);
  });

  it("caps each user at 20 runs per hour", async () => {
    const capped = await db.createMember("capped@example.test");
    const own = await createEvent(capped);
    await db.sql(
      `insert into public.ai_runs (event_id, pipeline, provider, model, input_hash, status, created_by, finished_at)
       select $1, 'plan', 'mock', 'm', $2, 'failed', $3, now() from generate_series(1, 20)`,
      [own, HASH, capped],
    );
    expect(await db.user(capped).error(START, [own, "plan", HASH])).toMatch(/ai_rate_limited/);
  });

  it("viewers, outsiders and anon can't start runs; viewers can't read runs", async () => {
    expect(await db.user(viewer).error(START, [eventId, "plan", HASH])).toMatch(/forbidden/);
    expect(await db.user(outsider).error(START, [eventId, "plan", HASH])).toMatch(/forbidden/);
    expect(await db.anon.error(START, [eventId, "plan", HASH])).toMatch(/permission denied/);
    expect(
      await db.user(viewer).query("select 1 from public.ai_runs where event_id = $1", [eventId]),
    ).toEqual([]);
    expect(
      (
        await db
          .user(organizer)
          .query("select 1 from public.ai_runs where event_id = $1", [eventId])
      ).length,
    ).toBeGreaterThan(0);
  });

  it("validates pipeline, provider and hash", async () => {
    expect(
      await db
        .user(owner)
        .error("select public.start_ai_run($1, 'chat', 'gemini', 'm', $2, false)", [eventId, HASH]),
    ).toMatch(/pipeline_check/);
    expect(
      await db
        .user(owner)
        .error("select public.start_ai_run($1, 'plan', 'openai', 'm', $2, false)", [eventId, HASH]),
    ).toMatch(/provider_check/);
    expect(
      await db
        .user(owner)
        .error("select public.start_ai_run($1, 'plan', 'gemini', 'm', 'nothex', false)", [eventId]),
    ).toMatch(/input_hash_check/);
  });

  it("records rules runs ('playbook') and accepts the newer event types", async () => {
    const [{ id }] = await db
      .user(owner)
      .query<{ id: string }>(
        "select public.start_ai_run($1, 'recovery', 'playbook', 'rules', $2, false) as id",
        [eventId, HASH],
      );
    await db
      .user(owner)
      .query("select public.finish_ai_run($1, 'succeeded', null, 1, 0, 0, 0, 'rules')", [id]);
    for (const type of ["conference", "workshop"]) {
      const rows = await db.user(owner).query<{ event_type: string }>(
        `insert into public.events (owner_id, name, event_type, starts_at, ends_at, capacity)
           values ($1, 'Typed event', $2, '2026-12-01T09:00:00+04', '2026-12-01T17:00:00+04', 50)
           returning event_type`,
        [owner, type],
      );
      expect(rows[0].event_type).toBe(type);
    }
    expect(
      await db.user(owner).error(
        `insert into public.events (owner_id, name, event_type, starts_at, ends_at, capacity)
             values ($1, 'Bad', 'wedding', '2026-12-01T09:00:00+04', '2026-12-01T17:00:00+04', 50)`,
        [owner],
      ),
    ).toMatch(/event_type_check/);
  });
});

describe("plans", () => {
  let firstPlan: string;

  it("saves an AI plan from the caller's own successful run, once", async () => {
    const run = await succeededRun(owner);
    [{ id: firstPlan }] = await savePlan(owner, run, "ai", [task("book_room"), task("order_food")]);
    expect(
      await db
        .user(owner)
        .error(SAVE_PLAN, [eventId, run, "ai", HASH, JSON.stringify([task("x_one")])]),
    ).toMatch(/run_already_used/);
    const failed = await startRun(owner);
    await finishRun(owner, failed, "invalid_output");
    expect(
      await db
        .user(owner)
        .error(SAVE_PLAN, [eventId, failed, "ai", HASH, JSON.stringify([task("x_one")])]),
    ).toMatch(/run_not_usable/);
    const othersRun = await succeededRun(organizer);
    expect(
      await db
        .user(owner)
        .error(SAVE_PLAN, [eventId, othersRun, "ai", HASH, JSON.stringify([task("x_one")])]),
    ).toMatch(/run_not_usable/);
    await savePlan(organizer, othersRun, "ai", [task("book_room")]); // organizer's own run works
  });

  it("a new plan supersedes the old plan and its open proposals; one current plan per event", async () => {
    await savePlan(owner, null, "playbook", [task("pb_one")]);
    const plans = await db.sql<{ status: string; source: string }>(
      "select status, source from public.ai_plans where event_id = $1 order by created_at",
      [eventId],
    );
    expect(plans.filter((p) => p.status === "current")).toEqual([
      { status: "current", source: "playbook" },
    ]);
    const old = await db.sql<{ status: string }>(
      "select distinct status from public.ai_suggestions where plan_id = $1",
      [firstPlan],
    );
    expect(old).toEqual([{ status: "superseded" }]);
  });

  it("refuses playbook plans with a run, empty or oversize plans and unknown sources", async () => {
    const run = await succeededRun(owner);
    expect(
      await db
        .user(owner)
        .error(SAVE_PLAN, [eventId, run, "playbook", HASH, JSON.stringify([task("x_one")])]),
    ).toMatch(/playbook_plan_has_no_run/);
    expect(await db.user(owner).error(SAVE_PLAN, [eventId, null, "playbook", HASH, "[]"])).toMatch(
      /invalid_tasks/,
    );
    const many = Array.from({ length: 41 }, (_, i) => task(`t_${i}`));
    expect(
      await db
        .user(owner)
        .error(SAVE_PLAN, [eventId, null, "playbook", HASH, JSON.stringify(many)]),
    ).toMatch(/invalid_tasks/);
    expect(
      await db
        .user(owner)
        .error(SAVE_PLAN, [eventId, null, "magic", HASH, JSON.stringify([task("x_one")])]),
    ).toMatch(/invalid_source/);
  });

  it("members read plans and proposals; outsiders see nothing; no direct writes for anyone", async () => {
    expect(
      (await db.user(viewer).query("select 1 from public.ai_plans where event_id = $1", [eventId]))
        .length,
    ).toBeGreaterThan(0);
    expect(
      (
        await db
          .user(viewer)
          .query("select 1 from public.ai_suggestions where event_id = $1", [eventId])
      ).length,
    ).toBeGreaterThan(0);
    expect(
      await db.user(outsider).query("select 1 from public.ai_plans where event_id = $1", [eventId]),
    ).toEqual([]);
    expect(
      await db
        .user(outsider)
        .query("select 1 from public.ai_suggestions where event_id = $1", [eventId]),
    ).toEqual([]);
    for (const sql of [
      "update public.ai_suggestions set status = 'accepted' where event_id = $1",
      "delete from public.ai_plans where event_id = $1",
      "update public.ai_runs set status = 'succeeded' where event_id = $1",
      "insert into public.ai_plans (event_id, source, input_hash, playbook_id, playbook_version) values ($1, 'ai', repeat('b', 64), 'x', 1)",
    ]) {
      expect(await db.user(owner).error(sql, [eventId])).toMatch(/permission denied/);
    }
    expect(await db.anon.error("select * from public.ai_suggestions")).toMatch(/permission denied/);
  });

  it("plan creation and suggestion decisions are audited", async () => {
    const rows = await db.sql<{ entity_type: string }>(
      "select distinct entity_type from public.audit_log where event_id = $1 and entity_type like 'ai_%'",
      [eventId],
    );
    expect(rows.map((r) => r.entity_type).sort()).toEqual(["ai_plans", "ai_suggestions"]);
  });
});

describe("revise and dismiss", () => {
  const currentTask = async (key: string) =>
    (
      await db.sql<{ id: string; revision: number }>(
        `select s.id, s.revision from public.ai_suggestions s join public.ai_plans p on p.id = s.plan_id
         where p.event_id = $1 and p.status = 'current' and s.item_key = $2 and s.status = 'proposed'`,
        [eventId, key],
      )
    )[0];

  it("a revision supersedes the task and adds revision + 1 with the same key", async () => {
    const before = await currentTask("pb_one");
    const run = await succeededRun(owner, "revise_task");
    await db
      .user(owner)
      .query("select public.revise_ai_task($1, $2, $3::jsonb)", [
        before.id,
        run,
        JSON.stringify({ tempId: "pb_one", title: "Revised" }),
      ]);
    const after = await currentTask("pb_one");
    expect(after.revision).toBe(2);
    const [old] = await db.sql<{ status: string }>(
      "select status from public.ai_suggestions where id = $1",
      [before.id],
    );
    expect(old.status).toBe("superseded");
    const run2 = await succeededRun(owner, "revise_task");
    expect(
      await db
        .user(owner)
        .error("select public.revise_ai_task($1, $2, '{}'::jsonb)", [before.id, run2]),
    ).toMatch(/invalid_transition/);
    const planRun = await succeededRun(owner, "plan");
    expect(
      await db
        .user(owner)
        .error("select public.revise_ai_task($1, $2, '{}'::jsonb)", [after.id, planRun]),
    ).toMatch(/run_not_usable/);
  });

  it("dismiss: proposed → rejected once; viewers can't", async () => {
    const t = await currentTask("pb_one");
    expect(await db.user(viewer).error("select public.dismiss_ai_suggestion($1)", [t.id])).toMatch(
      /forbidden/,
    );
    await db.user(organizer).query("select public.dismiss_ai_suggestion($1)", [t.id]);
    expect(await db.user(owner).error("select public.dismiss_ai_suggestion($1)", [t.id])).toMatch(
      /invalid_transition: rejected/,
    );
    const [row] = await db.sql<{ status: string; decided_by: string }>(
      "select status, decided_by from public.ai_suggestions where id = $1",
      [t.id],
    );
    expect(row).toEqual({ status: "rejected", decided_by: organizer });
  });
});

describe("follow-up questions", () => {
  const SAVE = "select public.save_ai_followups($1, $2, $3::jsonb) as n";
  const q = (key: string) => ({ key, payload: { key, type: "text", text: "Question?" } });

  it("saves up to 3 per run, skips keys that are already live, needs custom.* keys", async () => {
    const run = await succeededRun(owner, "interview");
    const [{ n }] = await db
      .user(owner)
      .query<{ n: number }>(SAVE, [
        run,
        eventId,
        JSON.stringify([q("custom.aaa"), q("custom.bbb")]),
      ]);
    expect(n).toBe(2);
    const run2 = await succeededRun(owner, "interview");
    const [{ n: n2 }] = await db
      .user(owner)
      .query<{ n: number }>(SAVE, [
        run2,
        eventId,
        JSON.stringify([q("custom.aaa"), q("custom.ccc")]),
      ]);
    expect(n2).toBe(1);
    const run3 = await succeededRun(owner, "interview");
    expect(
      await db
        .user(owner)
        .error(SAVE, [run3, eventId, JSON.stringify([q("a.b"), q("c.d"), q("e.f"), q("g.h")])]),
    ).toMatch(/invalid_questions/);
    expect(
      await db.user(owner).error(SAVE, [run3, eventId, JSON.stringify([q("audience.level")])]),
    ).toMatch(/ai_suggestions_question_key/);
  });

  it("caps live follow-ups at 15 per event", async () => {
    const own = await createEvent(owner);
    await db.sql(
      `insert into public.ai_suggestions (event_id, kind, source, item_key, payload)
       select $1, 'question', 'ai', 'custom.q' || g, '{}'::jsonb from generate_series(1, 15) g`,
      [own],
    );
    const run = await succeededRun(owner, "interview", own);
    expect(
      await db.user(owner).error(SAVE, [run, own, JSON.stringify([q("custom.extra")])]),
    ).toMatch(/too_many_followups/);
  });
});

describe("event state", () => {
  it("nothing AI-related can be written once the event is live; data is deleted with the event", async () => {
    const id = await createEvent(owner);
    const run = await succeededRun(owner, "plan", id);
    for (const status of ["planning", "ready", "live"]) {
      await db
        .user(owner)
        .query("update public.events set status = $2 where id = $1", [id, status]);
    }
    expect(await db.user(owner).error(START, [id, "plan", HASH])).toMatch(/event_locked: live/);
    expect(
      await db.user(owner).error(SAVE_PLAN, [id, run, "ai", HASH, JSON.stringify([task("x_one")])]),
    ).toMatch(/event_locked/);

    const draft = await createEvent(owner);
    await savePlan(owner, null, "playbook", [task("x_one")], draft);
    await db.user(owner).query("delete from public.events where id = $1", [draft]);
    expect(await db.sql("select 1 from public.ai_plans where event_id = $1", [draft])).toEqual([]);
    expect(
      await db.sql("select 1 from public.ai_suggestions where event_id = $1", [draft]),
    ).toEqual([]);
  });
});

describe("plan overview", () => {
  const OVERVIEW = JSON.stringify({ summary: "A hackathon.", risks: [] });
  const SET = "select public.set_ai_plan_overview($1, $2::jsonb)";

  it("is written by event managers only and readable by members", async () => {
    const run = await succeededRun(owner);
    const [{ id }] = await savePlan(owner, run, "ai", [task("t_overview")]);
    await expect(db.user(viewer).query(SET, [id, OVERVIEW])).rejects.toThrow();
    await expect(db.user(outsider).query(SET, [id, OVERVIEW])).rejects.toThrow();
    await db.user(owner).query(SET, [id, OVERVIEW]);
    const rows = await db
      .user(owner)
      .query<{ overview: { summary: string } }>(
        "select overview from public.ai_plans where id = $1",
        [id],
      );
    expect(rows[0]?.overview.summary).toBe("A hackathon.");
  });

  it("rejects a non-object overview", async () => {
    const run = await succeededRun(owner);
    const [{ id }] = await savePlan(owner, run, "ai", [task("t_overview2")]);
    await expect(db.user(owner).query(SET, [id, "[]"])).rejects.toThrow();
  });
});

describe("engine output against the real RPCs", () => {
  it.each(["university_hackathon", "conference", "workshop"] as const)(
    "a %s plan is accepted by save_ai_plan and set_ai_plan_overview and reads back",
    async (type) => {
      const id = await createEvent(owner);
      const event = {
        name: "AI Hackathon",
        venue_type: "indoor",
        capacity: 100,
        starts_at: "2026-12-01T05:00:00Z",
        ends_at: "2026-12-02T14:00:00Z",
        city: "Dubai",
        budget_amount: 40000,
        timezone: "Asia/Dubai",
        currency: "AED",
      };
      const playbook = playbookFor(type);
      const state = interviewState(playbook, eventContext(event), {});
      const ctx = answerContext(eventContext(event), state);
      const pctx = planContext(event, evidenceCatalog(playbook, ctx, state));
      const plan = buildPlan({ playbook, event, ctx, plan: pctx });
      const tasks = resolvePlan(plan.tasks, pctx).map((t) => ({ key: t.tempId, payload: t }));
      const [{ id: planId }] = await db
        .user(owner)
        .query<{ id: string }>(SAVE_PLAN.replace("'university-hackathon', 2", "$6, $7"), [
          id,
          null,
          "playbook",
          HASH,
          JSON.stringify(tasks),
          playbook.id,
          playbook.version,
        ]);
      const overview = { ...plan, tasks: undefined, assumptions: undefined };
      await db
        .user(owner)
        .query("select public.set_ai_plan_overview($1, $2::jsonb)", [
          planId,
          JSON.stringify(overview),
        ]);
      const [row] = await db
        .user(owner)
        .query<{ overview: unknown }>("select overview from public.ai_plans where id = $1", [
          planId,
        ]);
      expect(PlanOverview.safeParse(row.overview).success).toBe(true);
      const saved = await db
        .user(owner)
        .query<{ payload: unknown }>(
          "select payload from public.ai_suggestions where plan_id = $1",
          [planId],
        );
      expect(saved).toHaveLength(tasks.length);
      expect(saved.every((r) => StoredTask.safeParse(r.payload).success)).toBe(true);
    },
  );
});
