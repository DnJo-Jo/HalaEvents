import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";

let db: TestDb;
let owner: string;
let organizer: string;
let viewer: string;
let outsider: string;
let a: string;
let b: string;

const SERVICES = "select public.save_event_services($1, $2::text[])";
const SHORTLIST = "select public.shortlist_vendor($1, $2, $3, $4, $5, $6, $7, $8, $9)";
const vendor = (event: string, placeId = "p1", category = "catering") => [
  event,
  category,
  placeId,
  "Cafe One",
  "Dubai",
  null,
  "https://cafe.example",
  25.2,
  55.3,
];
const services = async (id: string) =>
  (await db.sql<{ s: string[] }>("select services as s from public.events where id = $1", [id]))[0]
    .s;
const shortlist = (who: string, event: string) =>
  db
    .user(who)
    .query<{ place_id: string; note: string | null }>(
      "select place_id, note from public.event_vendor_shortlist where event_id = $1 order by place_id",
      [event],
    );

async function createEvent(ownerId: string): Promise<string> {
  const [{ id }] = await db.user(ownerId).query<{ id: string }>(
    `insert into public.events (owner_id, name, starts_at, ends_at, capacity)
       values ($1, 'Campus Hackathon', '2026-12-01T09:00:00+04', '2026-12-02T18:00:00+04', 100) returning id`,
    [ownerId],
  );
  return id;
}
const addMember = (id: string, user: string, role: string) =>
  db
    .user(owner)
    .query("insert into public.event_members (event_id, user_id, role) values ($1, $2, $3)", [
      id,
      user,
      role,
    ]);

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createMember("owner@example.test");
  organizer = await db.createMember("org@example.test");
  viewer = await db.createMember("viewer@example.test");
  outsider = await db.createMember("out@example.test");
  a = await createEvent(owner);
  b = await createEvent(owner);
  await addMember(a, organizer, "organizer");
  await addMember(a, viewer, "viewer");
});
afterAll(async () => db.close());

describe("event services and vendor shortlist (20261024000005)", () => {
  it("existing events have no services; owners and organizers set any subset", async () => {
    expect(await services(a)).toEqual([]);
    await db.user(owner).query(SERVICES, [a, ["transport", "venue", "venue"]]);
    expect(await services(a)).toEqual(["transport", "venue"]);
    await db.user(organizer).query(SERVICES, [a, []]);
    expect(await services(a)).toEqual([]);
  });

  it("viewers, outsiders and anon can't write; unknown services and direct writes are refused", async () => {
    for (const who of [viewer, outsider])
      expect(await db.user(who).error(SERVICES, [a, ["venue"]])).toMatch(/forbidden/);
    expect(await db.anon.error(SERVICES, [a, ["venue"]])).toMatch(/permission denied/);
    expect(await db.user(owner).error(SERVICES, [a, ["helicopter"]])).toMatch(/violates check/);
    expect(
      await db
        .user(owner)
        .error("update public.events set services = '{venue}' where id = $1", [a]),
    ).toMatch(/permission denied/);
  });

  it("shortlisting is per event; members read it, others don't see it", async () => {
    await db.user(organizer).query(SHORTLIST, vendor(a));
    await db.user(organizer).query(SHORTLIST, vendor(a)); // idempotent
    await db.user(owner).query(SHORTLIST, vendor(b, "p2"));
    expect((await shortlist(viewer, a)).map((r) => r.place_id)).toEqual(["p1"]);
    expect((await shortlist(owner, b)).map((r) => r.place_id)).toEqual(["p2"]);
    expect(await shortlist(outsider, a)).toEqual([]);
    expect(await db.user(viewer).error(SHORTLIST, vendor(a, "p3"))).toMatch(/forbidden/);
    expect(await db.user(outsider).error(SHORTLIST, vendor(a, "p3"))).toMatch(/forbidden/);
    expect(await db.anon.error(SHORTLIST, vendor(a, "p3"))).toMatch(/permission denied/);
    expect(
      await db
        .user(owner)
        .error(
          "insert into public.event_vendor_shortlist (event_id, category, place_id, name, latitude, longitude) values ($1,'venue','x','n',1,1)",
          [a],
        ),
    ).toMatch(/permission denied/);
  });

  it("notes are saved by organizers; removal only touches that event's entry", async () => {
    await db
      .user(organizer)
      .query("select public.set_vendor_note($1, 'catering', 'p1', $2)", [a, "  halal menu  "]);
    expect((await shortlist(owner, a))[0].note).toBe("halal menu");
    expect(
      await db.user(viewer).error("select public.set_vendor_note($1, 'catering', 'p1', 'x')", [a]),
    ).toMatch(/forbidden/);
    await db
      .user(owner)
      .query("select public.remove_shortlisted_vendor($1, 'catering', 'p1')", [b]);
    expect(await shortlist(owner, a)).toHaveLength(1);
    await db
      .user(organizer)
      .query("select public.remove_shortlisted_vendor($1, 'catering', 'p1')", [a]);
    expect(await shortlist(owner, a)).toEqual([]);
  });

  it("rejects bad snapshots (category, coordinates, non-http website) and closed events", async () => {
    expect(await db.user(owner).error(SHORTLIST, vendor(a, "q", "hotels"))).toMatch(
      /violates check/,
    );
    expect(
      await db.user(owner).error(SHORTLIST, [a, "venue", "q", "n", null, null, null, 95, 0]),
    ).toMatch(/violates check/);
    expect(
      await db
        .user(owner)
        .error(SHORTLIST, [a, "venue", "q", "n", null, null, "javascript:x", 1, 1]),
    ).toMatch(/violates check/);
    await db.sql("update public.events set status = 'cancelled' where id = $1", [a]);
    expect(await db.user(owner).error(SHORTLIST, vendor(a, "z"))).toMatch(/interview_locked/);
    expect(await db.user(owner).error(SERVICES, [a, ["venue"]])).toMatch(/interview_locked/);
  });

  it("the shortlist is deleted with its event", async () => {
    await db.user(owner).query("delete from public.events where id = $1", [b]);
    expect(
      await db.sql("select 1 from public.event_vendor_shortlist where event_id = $1", [b]),
    ).toEqual([]);
  });
});
