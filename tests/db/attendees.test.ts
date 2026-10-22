import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";

let db: TestDb;
let owner: string;
let viewer: string;
let outsider: string;
let eventId: string;
let appEvent: string;

const REGISTER = "select public.register_attendee($1, $2, $3, null, $4, true) as status";
const register = (slug: string, name: string, email: string, note: string | null = null) =>
  db.anon.query<{ status: string }>(REGISTER, [slug, name, email, note]).then((r) => r[0].status);
const participation = (who: string, id: string, status: string) =>
  db.user(who).query("select public.set_attendee_participation($1, $2, null)", [id, status]);
const participationError = (who: string, id: string, status: string) =>
  db.user(who).error("select public.set_attendee_participation($1, $2, null)", [id, status]);
async function attendee(email: string, event = eventId) {
  const [row] = await db.sql<{
    id: string;
    registration_status: string;
    review_status: string;
    participation_status: string;
  }>(
    "select id, registration_status, review_status, participation_status from public.attendees where event_id = $1 and email = $2 and registration_status <> 'withdrawn'",
    [event, email],
  );
  return row;
}

async function createEvent(
  name: string,
  slug: string,
  capacity: number,
  requiresApplication = false,
) {
  const start = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const end = new Date(Date.now() + 21 * 86_400_000).toISOString();
  const [{ id }] = await db
    .user(owner)
    .query<{ id: string }>(
      "insert into public.events (owner_id, name, starts_at, ends_at, capacity) values ($1, $2, $3, $4, $5) returning id",
      [owner, name, start, end, capacity],
    );
  await db
    .user(owner)
    .query(
      "update public.events set status = 'planning', registration_open = true, published_slug = $2, requires_application = $3 where id = $1",
      [id, slug, requiresApplication],
    );
  return id;
}

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createMember("owner@example.test");
  viewer = await db.createMember("viewer@example.test");
  outsider = await db.createMember("outsider@example.test");
  eventId = await createEvent("Small Hack", "small-hack", 2);
  appEvent = await createEvent("Selective Hack", "selective-hack", 1, true);
  await db
    .user(owner)
    .query("insert into public.event_members (event_id, user_id, role) values ($1, $2, 'viewer')", [
      eventId,
      viewer,
    ]);
});
afterAll(() => db.close());

describe("public registration", () => {
  it("accepts while places remain, then waitlists (capacity 2)", async () => {
    expect(await register("small-hack", "Amal One", "Amal@Example.test")).toBe("accepted");
    expect(await register("small-hack", "Badr Two", "badr@example.test")).toBe("accepted");
    expect(await register("small-hack", "Chen Three", "chen@example.test")).toBe("waitlisted");
    const [{ taken }] = await db.sql<{ taken: number }>(
      "select public.event_places_taken($1) as taken",
      [eventId],
    );
    expect(taken).toBe(2);
  });

  it("the public page sees only non-personal facts, and only while registration is open", async () => {
    const [ev] = await db.anon.query<{ name: string; places_left: number }>(
      "select * from public.public_event_by_slug('small-hack')",
    );
    expect(ev).toMatchObject({ name: "Small Hack", places_left: 0 });
    expect(Object.keys(ev).sort()).toEqual([
      "city",
      "ends_at",
      "name",
      "places_left",
      "requires_application",
      "starts_at",
      "timezone",
      "venue_type",
    ]);
    expect(await db.anon.query("select * from public.public_event_by_slug('nope')")).toHaveLength(
      0,
    );
  });

  it("refuses duplicates (case-insensitive) without changing anything", async () => {
    expect(await register("small-hack", "Amal Again", "AMAL@example.test")).toBe(
      "already_registered",
    );
    const rows = await db.sql(
      "select 1 from public.attendees where event_id = $1 and email = 'amal@example.test'",
      [eventId],
    );
    expect(rows).toHaveLength(1);
    expect(
      await db
        .user(owner)
        .error("select public.add_attendee($1, 'Amal', 'amal@example.test', null, true)", [
          eventId,
        ]),
    ).toMatch(/duplicate_registration/);
  });

  it("needs consent, an open registration and a valid email; anon can't read anything", async () => {
    expect(
      await db.anon.error(
        "select public.register_attendee('small-hack', 'No Consent', 'nc@example.test', null, null, false)",
      ),
    ).toMatch(/consent_required/);
    expect(
      await db.anon.error(REGISTER, ["no-such-event", "Someone", "s@example.test", null]),
    ).toMatch(/registration_closed/);
    expect(
      await db.anon.error(REGISTER, ["small-hack", "Bad Email", "not-an-email", null]),
    ).toMatch(/attendees_email_check/);
    expect(await db.anon.error("select id from public.attendees")).toMatch(/permission denied/);
    expect(
      await db.anon.error(
        "select public.set_attendee_participation(gen_random_uuid(), 'accepted', null)",
      ),
    ).toMatch(/permission denied/);
  });

  it("an invited person completes their registration through the form", async () => {
    await db
      .user(owner)
      .query("select public.add_attendee($1, 'Dana Invite', 'dana@example.test', null, false)", [
        eventId,
      ]);
    expect((await attendee("dana@example.test")).registration_status).toBe("invited");
    expect(await register("small-hack", "Dana Invite", "dana@example.test")).toBe("registered");
    expect(await attendee("dana@example.test")).toMatchObject({
      registration_status: "registered",
      participation_status: "pending",
    });
  });
});

describe("capacity and participation", () => {
  it("accepting beyond capacity fails; a freed place can be filled from the waitlist", async () => {
    const chen = await attendee("chen@example.test");
    expect(await participationError(owner, chen.id, "accepted")).toMatch(/capacity_full/);
    const badr = await attendee("badr@example.test");
    await db.user(owner).query("select public.withdraw_attendee($1, 'Cannot attend')", [badr.id]);
    await participation(owner, chen.id, "accepted");
    const [{ taken }] = await db.sql<{ taken: number }>(
      "select public.event_places_taken($1) as taken",
      [eventId],
    );
    expect(taken).toBe(2);
  });

  it("follows the participation table (confirm, check in; no skipping, no reviving)", async () => {
    const amal = await attendee("amal@example.test");
    expect(await participationError(owner, amal.id, "checked_in")).toMatch(/invalid_transition/);
    await participation(owner, amal.id, "confirmed");
    await participation(owner, amal.id, "checked_in");
    const [row] = await db.sql<{ confirmed_at: string | null; checked_in_at: string | null }>(
      "select confirmed_at, checked_in_at from public.attendees where id = $1",
      [amal.id],
    );
    expect(row.confirmed_at && row.checked_in_at).toBeTruthy();
    expect(
      await db.user(owner).error("select public.withdraw_attendee($1, null)", [amal.id]),
    ).toMatch(/invalid_transition/);
  });

  it("invited people can't hold a place", async () => {
    const [{ id }] = await db
      .user(owner)
      .query<{ id: string }>(
        "select public.add_attendee($1, 'Eve Invite', 'eve@example.test', null, false) as id",
        [eventId],
      );
    expect(await participationError(owner, id, "waitlisted")).toMatch(/not_registered/);
  });
});

describe("many registrations at once", () => {
  it("20 registrations for 10 places → exactly 10 accepted, 10 waitlisted", async () => {
    // PGlite runs one connection, so these are serialized: this checks the counting, not row locking
    // under real concurrency (that needs a multi-connection Postgres; see event.md §20.5).
    await createEvent("Busy Hack", "busy-hack", 10);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        register("busy-hack", `Person ${i}`, `p${i}@example.test`),
      ),
    );
    expect(results.filter((r) => r === "accepted")).toHaveLength(10);
    expect(results.filter((r) => r === "waitlisted")).toHaveLength(10);
  });
});

describe("application review", () => {
  it("is separate from participation, and only approved applications can be accepted", async () => {
    expect(
      await register("selective-hack", "Farah App", "farah@example.test", "I build robots"),
    ).toBe("pending");
    const farah = await attendee("farah@example.test", appEvent);
    expect(farah).toMatchObject({
      review_status: "pending",
      participation_status: "pending",
      registration_status: "registered",
    });
    expect(await participationError(owner, farah.id, "accepted")).toMatch(/review_not_approved/);
    await db
      .user(owner)
      .query("select public.set_attendee_review($1, 'needs_information', 'Which university?')", [
        farah.id,
      ]);
    expect(await participationError(owner, farah.id, "accepted")).toMatch(/review_not_approved/);
    await db
      .user(owner)
      .query("select public.set_attendee_review($1, 'approved', null)", [farah.id]);
    await participation(owner, farah.id, "accepted");
    expect(await attendee("farah@example.test", appEvent)).toMatchObject({
      review_status: "approved",
      participation_status: "accepted",
    });
    expect(
      await db
        .user(owner)
        .error("select public.set_attendee_review($1, 'needs_information', null)", [farah.id]),
    ).toMatch(/invalid_transition/);
  });
});

describe("access control", () => {
  it("viewers and outsiders can't read personal data or decide; counts are visible to members", async () => {
    expect(await db.user(viewer).query("select id from public.attendees")).toHaveLength(0);
    expect(await db.user(outsider).query("select id from public.attendees")).toHaveLength(0);
    const amal = await attendee("chen@example.test");
    expect(await participationError(viewer, amal.id, "confirmed")).toMatch(/forbidden/);
    expect(
      await db
        .user(viewer)
        .error("select public.add_attendee($1, 'X Y', 'xy@example.test', null, true)", [eventId]),
    ).toMatch(/forbidden/);
    const [summary] = await db
      .user(viewer)
      .query<{ capacity: number; taken: number }>(
        "select * from public.event_attendance_summary($1)",
        [eventId],
      );
    expect(summary).toMatchObject({ capacity: 2, taken: 2 });
    expect(
      await db.user(outsider).error("select * from public.event_attendance_summary($1)", [eventId]),
    ).toMatch(/forbidden/);
    expect(
      await db.user(owner).error("update public.attendees set participation_status = 'accepted'"),
    ).toMatch(/permission denied/);
  });
});

describe("rules parity", () => {
  it("participation and review transitions in SQL match src/modules/attendees/rules.ts", async () => {
    const { PARTICIPATION_TRANSITIONS, REVIEW_TRANSITIONS } =
      await import("@/modules/attendees/rules");
    for (const [table, fn] of [
      [PARTICIPATION_TRANSITIONS, "participation_transition_allowed"],
      [REVIEW_TRANSITIONS, "review_transition_allowed"],
    ] as const) {
      const states = Object.keys(table);
      for (const from of states) {
        for (const to of states) {
          const [{ ok }] = await db.sql<{ ok: boolean }>(`select public.${fn}($1, $2) as ok`, [
            from,
            to,
          ]);
          expect(ok, `${fn} ${from} -> ${to}`).toBe(
            (table as Record<string, readonly string[]>)[from].includes(to),
          );
        }
      }
    }
  });
});
