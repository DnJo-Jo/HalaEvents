import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";

let db: TestDb;
let owner: string;
let organizer: string;
let viewer: string;
let outsider: string;
let eventId: string;
let otherEvent: string;

const HASH = "b".repeat(64);
const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

async function createEvent(ownerId: string, name = "Workspace Hack"): Promise<string> {
  const start = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const end = new Date(Date.now() + 31 * 86_400_000).toISOString();
  const [{ id }] = await db.user(ownerId).query<{ id: string }>(
    `insert into public.events (owner_id, name, starts_at, ends_at, capacity)
       values ($1, $2, $3, $4, 100) returning id`,
    [ownerId, name, start, end],
  );
  return id;
}

async function task(
  who: string,
  title: string,
  extra: Record<string, unknown> = {},
  event = eventId,
) {
  const cols = ["event_id", "title", ...Object.keys(extra)];
  const vals = [event, title, ...Object.values(extra)];
  const [{ id }] = await db
    .user(who)
    .query<{ id: string }>(
      `insert into public.tasks (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      vals,
    );
  return id;
}
const depend = (who: string, t: string, on: string) =>
  db
    .user(who)
    .query("insert into public.task_dependencies (task_id, depends_on_task_id) values ($1, $2)", [
      t,
      on,
    ]);
const setStatus = (who: string, t: string, status: string) =>
  db.user(who).query("update public.tasks set status = $2 where id = $1", [t, status]);

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createMember("owner@example.test");
  organizer = await db.createMember("co@example.test");
  viewer = await db.createMember("viewer@example.test");
  outsider = await db.createMember("outsider@example.test");
  eventId = await createEvent(owner);
  otherEvent = await createEvent(owner, "Other Hack");
  await db
    .user(owner)
    .query(
      "insert into public.event_members (event_id, user_id, role) values ($1, $2, 'organizer'), ($1, $3, 'viewer')",
      [eventId, organizer, viewer],
    );
});
afterAll(() => db.close());

describe("tasks", () => {
  it("managers create tasks; viewers and outsiders can't; members read, outsiders don't", async () => {
    const id = await task(organizer, "Book the hall", { priority: "high", due_date: day(10) });
    expect(
      await db
        .user(viewer)
        .error("insert into public.tasks (event_id, title) values ($1, 'x y z')", [eventId]),
    ).toMatch(/row-level security/);
    expect(
      await db
        .user(outsider)
        .error("insert into public.tasks (event_id, title) values ($1, 'x y z')", [eventId]),
    ).toMatch(/row-level security/);
    expect(
      await db.user(viewer).query("select id from public.tasks where id = $1", [id]),
    ).toHaveLength(1);
    expect(
      await db.user(outsider).query("select id from public.tasks where id = $1", [id]),
    ).toHaveLength(0);
    const upd = await db
      .user(viewer)
      .query("update public.tasks set title = 'hijack' where id = $1 returning id", [id]);
    expect(upd).toHaveLength(0);
    expect(await db.anon.error("select id from public.tasks")).toMatch(/permission denied/);
  });

  it("new tasks start as todo; AI-origin fields can't be forged; transitions follow the table", async () => {
    expect(
      await db
        .user(owner)
        .error(
          "insert into public.tasks (event_id, title, status) values ($1, 'Already done', 'done')",
          [eventId],
        ),
    ).toMatch(/permission denied/);
    expect(
      await db
        .user(owner)
        .error(
          "insert into public.tasks (event_id, title, origin) values ($1, 'Fake AI', 'ai_plan')",
          [eventId],
        ),
    ).toMatch(/permission denied/);
    const id = await task(owner, "Order badges");
    await setStatus(owner, id, "cancelled");
    expect(
      await db.user(owner).error("update public.tasks set status = 'done' where id = $1", [id]),
    ).toMatch(/invalid_transition: cancelled -> done/);
    await setStatus(owner, id, "todo");
    await setStatus(owner, id, "done");
    const [row] = await db.sql<{ completed_at: string | null }>(
      "select completed_at from public.tasks where id = $1",
      [id],
    );
    expect(row.completed_at).not.toBeNull();
    await setStatus(owner, id, "in_progress");
    const [again] = await db.sql<{ completed_at: string | null }>(
      "select completed_at from public.tasks where id = $1",
      [id],
    );
    expect(again.completed_at).toBeNull();
  });

  it("a blocked task can't be marked done until its dependencies are done or cancelled", async () => {
    const a = await task(owner, "Venue contract");
    const b = await task(owner, "Floor plan");
    await depend(owner, b, a);
    expect(
      await db.user(owner).error("update public.tasks set status = 'done' where id = $1", [b]),
    ).toMatch(/task_blocked/);
    const [{ blocked }] = await db
      .user(viewer)
      .query<{ blocked: boolean }>("select public.task_is_blocked($1) as blocked", [b]);
    expect(blocked).toBe(true);
    await setStatus(owner, a, "cancelled");
    await setStatus(owner, b, "done");
  });

  it("rejects self, cross-event and cyclic dependencies (direct and indirect)", async () => {
    const a = await task(owner, "Task A");
    const b = await task(owner, "Task B");
    const c = await task(owner, "Task C");
    const foreign = await task(owner, "Foreign task", {}, otherEvent);
    expect(
      await db
        .user(owner)
        .error(
          "insert into public.task_dependencies (task_id, depends_on_task_id) values ($1, $1)",
          [a],
        ),
    ).toMatch(/no_self|dependency_cycle/);
    expect(
      await db
        .user(owner)
        .error(
          "insert into public.task_dependencies (task_id, depends_on_task_id) values ($1, $2)",
          [a, foreign],
        ),
    ).toMatch(/cross_event_dependency/);
    await depend(owner, b, a);
    await depend(owner, c, b);
    expect(
      await db
        .user(owner)
        .error(
          "insert into public.task_dependencies (task_id, depends_on_task_id) values ($1, $2)",
          [a, b],
        ),
    ).toMatch(/dependency_cycle/);
    expect(
      await db
        .user(owner)
        .error(
          "insert into public.task_dependencies (task_id, depends_on_task_id) values ($1, $2)",
          [a, c],
        ),
    ).toMatch(/dependency_cycle/);
    expect(
      await db
        .user(viewer)
        .error(
          "insert into public.task_dependencies (task_id, depends_on_task_id) values ($1, $2)",
          [c, a],
        ),
    ).toMatch(/row-level security/);
  });

  it("owners must be event managers", async () => {
    const id = await task(owner, "Judging rubric");
    await db
      .user(owner)
      .query("update public.tasks set owner_user_id = $2 where id = $1", [id, organizer]);
    expect(
      await db
        .user(owner)
        .error("update public.tasks set owner_user_id = $2 where id = $1", [id, viewer]),
    ).toMatch(/owner_not_event_manager/);
    expect(
      await db
        .user(owner)
        .error("update public.tasks set owner_user_id = $2 where id = $1", [id, outsider]),
    ).toMatch(/owner_not_event_manager/);
  });

  it("finished events are read-only", async () => {
    const ev = await createEvent(owner, "Finished Hack");
    const id = await task(owner, "Last task", {}, ev);
    await db.user(owner).query("update public.events set status = 'cancelled' where id = $1", [ev]);
    expect(
      await db.user(owner).error("update public.tasks set title = 'Changed' where id = $1", [id]),
    ).toMatch(/event_locked/);
    expect(
      await db
        .user(owner)
        .error("insert into public.tasks (event_id, title) values ($1, 'New one')", [ev]),
    ).toMatch(/event_locked/);
  });
});

describe("accepting a plan", () => {
  async function plan(event = eventId) {
    const tasks = [
      {
        key: "book_venue",
        payload: {
          tempId: "book_venue",
          title: "Book venue",
          description: "d",
          category: "venue",
          priority: "high",
          dueDate: day(5),
          proposedOwner: "Venue lead",
          dependsOn: [],
        },
      },
      {
        key: "catering",
        payload: {
          tempId: "catering",
          title: "Order catering",
          description: "d",
          category: "catering",
          priority: "medium",
          dueDate: day(8),
          proposedOwner: "Ops",
          dependsOn: ["book_venue"],
        },
      },
      {
        key: "signage",
        payload: {
          tempId: "signage",
          title: "Print signage",
          description: "d",
          category: "logistics",
          priority: "low",
          dueDate: day(9),
          proposedOwner: "Ops",
          dependsOn: ["catering"],
        },
      },
    ];
    const [{ id }] = await db
      .user(owner)
      .query<{ id: string }>(
        "select public.save_ai_plan($1, null, 'playbook', $2, 'university-hackathon', 2, '[]'::jsonb, $3::jsonb) as id",
        [event, HASH, JSON.stringify(tasks)],
      );
    return id;
  }

  it("creates tasks and dependencies, marks proposals accepted; partial accepts wire up later", async () => {
    const planId = await plan();
    const [{ id: catering }] = await db.sql<{ id: string }>(
      "select id from public.ai_suggestions where plan_id = $1 and item_key = 'catering'",
      [planId],
    );
    const [{ n }] = await db
      .user(organizer)
      .query<{ n: number }>("select public.accept_ai_plan($1, $2) as n", [planId, [catering]]);
    expect(n).toBe(1);
    const [{ n: rest }] = await db
      .user(organizer)
      .query<{ n: number }>("select public.accept_ai_plan($1) as n", [planId]);
    expect(rest).toBe(2);
    const rows = await db.sql<{
      title: string;
      origin: string;
      owner_label: string;
      due_date: string;
    }>(
      "select t.title, t.origin, t.owner_label, t.due_date::text from public.tasks t join public.ai_suggestions s on s.id = t.suggestion_id where s.plan_id = $1 order by t.title",
      [planId],
    );
    expect(rows.map((r) => r.title)).toEqual(["Book venue", "Order catering", "Print signage"]);
    expect(rows.every((r) => r.origin === "playbook_plan")).toBe(true);
    const deps = await db.sql(
      `select t.plan_item_key as task, d2.plan_item_key as on_task from public.task_dependencies d
         join public.tasks t on t.id = d.task_id join public.tasks d2 on d2.id = d.depends_on_task_id
        where t.event_id = $1 and t.plan_item_key is not null order by 1`,
      [eventId],
    );
    expect(deps).toEqual([
      { task: "catering", on_task: "book_venue" },
      { task: "signage", on_task: "catering" },
    ]);
    const statuses = await db.sql<{ status: string }>(
      "select distinct status from public.ai_suggestions where plan_id = $1",
      [planId],
    );
    expect(statuses).toEqual([{ status: "accepted" }]);
    expect(await db.user(owner).error("select public.accept_ai_plan($1)", [planId])).toMatch(
      /nothing_to_accept/,
    );
  });

  it("viewers can't accept; superseded plans can't be accepted", async () => {
    const first = await plan();
    expect(await db.user(viewer).error("select public.accept_ai_plan($1)", [first])).toMatch(
      /forbidden/,
    );
    await plan(); // supersedes `first`
    expect(await db.user(owner).error("select public.accept_ai_plan($1)", [first])).toMatch(
      /superseded/,
    );
  });
});

describe("timeline", () => {
  it("members (viewers included) see whitelisted changes; outsiders can't", async () => {
    const rows = await db
      .user(viewer)
      .query<{ entity_type: string; action: string; details: Record<string, unknown> }>(
        "select * from public.event_timeline($1, 200)",
        [eventId],
      );
    expect(rows.some((r) => r.entity_type === "tasks" && r.details.to === "done")).toBe(true);
    expect(rows.some((r) => r.entity_type === "task_dependencies")).toBe(true);
    expect(
      rows.some((r) => r.entity_type === "ai_suggestions" && r.details.to === "accepted"),
    ).toBe(true);
    for (const r of rows) {
      expect(
        Object.keys(r.details).every((k) =>
          [
            "title",
            "from",
            "to",
            "source",
            "kind",
            "role",
            "owner_changed",
            "due_from",
            "due_to",
            "simulated",
          ].includes(k),
        ),
      ).toBe(true);
    }
    expect(
      await db.user(outsider).error("select * from public.event_timeline($1)", [eventId]),
    ).toMatch(/forbidden/);
  });
});

describe("notifications", () => {
  it("deadlines and missing information notify managers once (dedupe); only the recipient reads them", async () => {
    const soon = await task(owner, "Confirm judges", { due_date: day(1) });
    await task(owner, "Far away task", { due_date: day(40) });
    await task(owner, "Assigned overdue", { due_date: day(-2), owner_user_id: organizer });
    const missing = JSON.stringify([{ key: "audience.level", label: "Who the hackathon is for" }]);
    const [{ n }] = await db
      .user(owner)
      .query<{ n: number }>("select public.refresh_event_notifications($1, $2::jsonb) as n", [
        eventId,
        missing,
      ]);
    expect(n).toBeGreaterThan(0);
    const [{ n: again }] = await db
      .user(owner)
      .query<{ n: number }>("select public.refresh_event_notifications($1, $2::jsonb) as n", [
        eventId,
        missing,
      ]);
    expect(again).toBe(0);

    const mine = await db
      .user(owner)
      .query<{ kind: string; title: string; delivery_status: string; channel: string }>(
        "select kind, title, delivery_status, channel from public.notifications where event_id = $1",
        [eventId],
      );
    expect(mine.some((r) => r.title === "Due soon: Confirm judges")).toBe(true);
    expect(mine.some((r) => r.title === "Due soon: Far away task")).toBe(false);
    expect(mine.some((r) => r.title === "Overdue: Assigned overdue")).toBe(false); // went to its owner only
    expect(mine.some((r) => r.kind === "missing_information")).toBe(true);
    expect(mine.some((r) => r.kind === "decision_required")).toBe(true); // plans created above
    expect(mine.every((r) => r.channel === "in_app" && r.delivery_status === "delivered")).toBe(
      true,
    );

    const theirs = await db
      .user(organizer)
      .query<{ title: string }>("select title from public.notifications");
    expect(theirs.some((r) => r.title === "Overdue: Assigned overdue")).toBe(true);
    expect(await db.user(viewer).query("select id from public.notifications")).toHaveLength(0);
    expect(
      await db.user(viewer).error("select public.refresh_event_notifications($1)", [eventId]),
    ).toMatch(/forbidden/);
    expect(
      await db
        .user(owner)
        .error("select public.refresh_event_notifications($1, $2::jsonb)", [
          eventId,
          JSON.stringify([{ key: "Bad Key", label: "x" }]),
        ]),
    ).toMatch(/invalid_missing/);
    expect(soon).toBeTruthy();
  });

  it("marking read changes delivery status for the caller's own rows only; no direct writes", async () => {
    const [{ n }] = await db
      .user(organizer)
      .query<{ n: number }>("select public.mark_notifications_read() as n");
    expect(n).toBeGreaterThan(0);
    const own = await db
      .user(organizer)
      .query<{ delivery_status: string }>("select delivery_status from public.notifications");
    expect(own.every((r) => r.delivery_status === "read")).toBe(true);
    const ownerUnread = await db
      .user(owner)
      .query("select id from public.notifications where read_at is null");
    expect(ownerUnread.length).toBeGreaterThan(0);
    expect(
      await db
        .user(owner)
        .error(
          "insert into public.notifications (user_id, kind, title) values ($1, 'decision_required', 'Fake one')",
          [organizer],
        ),
    ).toMatch(/permission denied/);
    expect(await db.user(owner).error("update public.notifications set title = 'x'")).toMatch(
      /permission denied/,
    );
  });
});

describe("rules parity", () => {
  it("task transitions in SQL match src/modules/tasks/rules.ts for every pair", async () => {
    const { TASK_TRANSITIONS } = await import("@/modules/tasks/rules");
    const statuses = Object.keys(TASK_TRANSITIONS) as (keyof typeof TASK_TRANSITIONS)[];
    for (const from of statuses) {
      for (const to of statuses) {
        const [{ ok }] = await db.sql<{ ok: boolean }>(
          "select public.task_status_transition_allowed($1, $2) as ok",
          [from, to],
        );
        expect(ok, `${from} -> ${to}`).toBe(TASK_TRANSITIONS[from].includes(to));
      }
    }
  });
});
