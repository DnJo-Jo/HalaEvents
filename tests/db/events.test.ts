import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EVENT_TRANSITIONS, canTransition } from "@/modules/events/rules";
import { EventStatus } from "@/modules/events/schemas";
import { TestDb } from "./harness";

let db: TestDb;
let owner: string;
let organizer: string;
let viewer: string;
let outsider: string;
let provider: string;
let eventId: string;

const insertEvent = (ownerId: string, extra = "") =>
  `insert into public.events (owner_id, name, starts_at, ends_at, capacity${extra ? ", " + extra.split("=")[0] : ""})
   values ('${ownerId}', 'Campus Hackathon', '2026-12-01T09:00:00+04', '2026-12-02T18:00:00+04', 100${extra ? ", " + extra.split("=")[1] : ""})
   returning id`;

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createMember("owner@example.test", ["organizer"]);
  organizer = await db.createMember("co@example.test", ["organizer"]);
  viewer = await db.createMember("viewer@example.test", ["organizer"]);
  outsider = await db.createMember("outsider@example.test", ["organizer"]);
  provider = await db.createMember("provider@example.test", ["service_provider"]);
  [{ id: eventId }] = await db.user(owner).query<{ id: string }>(insertEvent(owner));
  await db
    .user(owner)
    .query(
      "insert into public.event_members (event_id, user_id, role) values ($1, $2, 'organizer'), ($1, $3, 'viewer')",
      [eventId, organizer, viewer],
    );
});
afterAll(() => db.close());

describe("event creation", () => {
  it("the creator becomes the single owner; status starts as draft", async () => {
    const members = await db.sql<{ user_id: string; role: string }>(
      "select user_id, role from public.event_members where event_id = $1 and role = 'owner'",
      [eventId],
    );
    expect(members).toEqual([{ user_id: owner, role: "owner" }]);
    const [e] = await db.sql<{ status: string }>("select status from public.events where id = $1", [
      eventId,
    ]);
    expect(e.status).toBe("draft");
  });

  it("requires the organizer role", async () => {
    expect(await db.user(provider).error(insertEvent(provider))).toMatch(/row-level security/);
  });

  it("cannot be created on behalf of another user (owner_id must be the caller)", async () => {
    expect(await db.user(outsider).error(insertEvent(owner))).toMatch(/row-level security/);
  });

  it("cannot be created with a non-draft status", async () => {
    expect(await db.user(owner).error(insertEvent(owner, "status='live'"))).toMatch(
      /permission denied/,
    );
  });

  it("rejects end before start, zero capacity and unknown timezones", async () => {
    expect(
      await db
        .user(owner)
        .error(
          `insert into public.events (owner_id, name, starts_at, ends_at, capacity) values ('${owner}', 'Bad', '2026-12-02', '2026-12-01', 10)`,
        ),
    ).toMatch(/events_time_order/);
    expect(
      await db
        .user(owner)
        .error(
          `insert into public.events (owner_id, name, starts_at, ends_at, capacity) values ('${owner}', 'Bad', '2026-12-01', '2026-12-02', 0)`,
        ),
    ).toMatch(/capacity_check/);
    expect(
      await db
        .user(owner)
        .error(
          `insert into public.events (owner_id, name, starts_at, ends_at, capacity, timezone) values ('${owner}', 'Bad', '2026-12-01', '2026-12-02', 10, 'Mars/Olympus')`,
        ),
    ).toMatch(/invalid_timezone/);
  });

  it("anon cannot read or create events", async () => {
    expect(await db.anon.error("select * from public.events")).toMatch(/permission denied/);
    expect(await db.anon.error(insertEvent(owner))).toMatch(/permission denied/);
  });
});

describe("ownership boundaries", () => {
  it("outsiders cannot see the event or its members", async () => {
    expect(
      await db.user(outsider).query("select id from public.events where id = $1", [eventId]),
    ).toEqual([]);
    expect(
      await db
        .user(outsider)
        .query("select * from public.event_members where event_id = $1", [eventId]),
    ).toEqual([]);
  });

  it("outsider updates and deletes affect nothing", async () => {
    await db
      .user(outsider)
      .query("update public.events set name = 'Hijacked' where id = $1", [eventId]);
    await db.user(outsider).query("delete from public.events where id = $1", [eventId]);
    const [e] = await db.sql<{ name: string }>("select name from public.events where id = $1", [
      eventId,
    ]);
    expect(e.name).toBe("Campus Hackathon");
  });

  it("viewers can read but not edit", async () => {
    expect(
      await db.user(viewer).query("select id from public.events where id = $1", [eventId]),
    ).toHaveLength(1);
    await db
      .user(viewer)
      .query("update public.events set name = 'Viewer edit' where id = $1", [eventId]);
    const [e] = await db.sql<{ name: string }>("select name from public.events where id = $1", [
      eventId,
    ]);
    expect(e.name).toBe("Campus Hackathon");
  });

  it("organizers can edit the event", async () => {
    await db
      .user(organizer)
      .query("update public.events set capacity = 120 where id = $1", [eventId]);
    const [e] = await db.sql<{ capacity: number }>(
      "select capacity from public.events where id = $1",
      [eventId],
    );
    expect(e.capacity).toBe(120);
  });

  it("owner_id cannot be changed by anyone through the API", async () => {
    expect(
      await db
        .user(owner)
        .error("update public.events set owner_id = $2 where id = $1", [eventId, organizer]),
    ).toMatch(/permission denied/);
  });

  it("organizers cannot manage members; owner cannot touch the owner row", async () => {
    expect(
      await db
        .user(organizer)
        .error(
          "insert into public.event_members (event_id, user_id, role) values ($1, $2, 'viewer')",
          [eventId, outsider],
        ),
    ).toMatch(/row-level security/);
    expect(
      await db
        .user(owner)
        .error(
          "insert into public.event_members (event_id, user_id, role) values ($1, $2, 'owner')",
          [eventId, outsider],
        ),
    ).toMatch(/row-level security/);
    await db
      .user(owner)
      .query("delete from public.event_members where event_id = $1 and role = 'owner'", [eventId]);
    expect(
      await db.sql("select 1 from public.event_members where event_id = $1 and role = 'owner'", [
        eventId,
      ]),
    ).toHaveLength(1);
    expect(
      await db
        .user(owner)
        .error(
          "update public.event_members set role = 'owner' where event_id = $1 and user_id = $2",
          [eventId, organizer],
        ),
    ).toMatch(/row-level security/);
  });
});

describe("lifecycle", () => {
  it("rejects invalid transitions and audits valid ones", async () => {
    expect(
      await db
        .user(owner)
        .error("update public.events set status = 'live' where id = $1", [eventId]),
    ).toMatch(/invalid_transition: draft -> live/);
    await db
      .user(owner)
      .query("update public.events set status = 'planning' where id = $1", [eventId]);
    const audit = await db
      .user(owner)
      .query<{ actor_user_id: string; before: { status: string }; after: { status: string } }>(
        "select actor_user_id, before, after from public.audit_log where event_id = $1 and entity_type = 'events' and action = 'update'",
        [eventId],
      );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_user_id: owner,
      before: { status: "draft" },
      after: { status: "planning" },
    });
  });

  it("only draft events can be deleted, and only by the owner", async () => {
    await db.user(owner).query("delete from public.events where id = $1", [eventId]);
    expect(await db.sql("select 1 from public.events where id = $1", [eventId])).toHaveLength(1);
  });

  it("audit entries of an event are visible to its managers, not to viewers or outsiders", async () => {
    expect(
      (
        await db
          .user(organizer)
          .query("select 1 from public.audit_log where event_id = $1", [eventId])
      ).length,
    ).toBeGreaterThan(0);
    expect(
      await db.user(viewer).query("select 1 from public.audit_log where event_id = $1", [eventId]),
    ).toEqual([]);
    expect(
      await db
        .user(outsider)
        .query("select 1 from public.audit_log where event_id = $1", [eventId]),
    ).toEqual([]);
  });

  it("database transitions match EVENT_TRANSITIONS for every pair", async () => {
    const statuses = EventStatus.options;
    for (const from of statuses) {
      for (const to of statuses) {
        const [{ ok }] = await db.sql<{ ok: boolean }>(
          "select public.event_status_transition_allowed($1, $2) as ok",
          [from, to],
        );
        expect(ok, `${from} -> ${to}`).toBe(canTransition(from, to));
      }
    }
    expect(Object.keys(EVENT_TRANSITIONS).sort()).toEqual([...statuses].sort());
  });
});

describe("suspended accounts", () => {
  it("cannot create events", async () => {
    const admin = await db.createMember("admin@example.test", ["organizer"]);
    await db.makeAdmin(admin);
    await db
      .user(admin)
      .query(`select public.set_account_status('${outsider}', 'suspended', 'abuse')`);
    expect(await db.user(outsider).error(insertEvent(outsider))).toMatch(/row-level security/);
  });
});
