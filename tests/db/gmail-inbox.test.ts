import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";

let db: TestDb;
let owner: string;
let organizer: string;
let viewer: string;
let outsider: string;
let ev: string;

const REPLY = `insert into public.vendor_replies
  (event_id, category, place_id, reference, gmail_message_id, from_email, subject, body, received_at)
  values ($1, 'catering', 'p1', 'HE-ABCD1234', $2, 'v@gmail.com', 's', 'b', now())`;

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createMember("owner@example.test");
  organizer = await db.createMember("org@example.test");
  viewer = await db.createMember("viewer@example.test");
  outsider = await db.createMember("out@example.test");
  [{ id: ev }] = await db.user(owner).query<{ id: string }>(
    `insert into public.events (owner_id, name, starts_at, ends_at, capacity)
       values ($1, 'Campus Hackathon', '2026-12-01T09:00:00+04', '2026-12-02T18:00:00+04', 100) returning id`,
    [owner],
  );
  for (const [u, role] of [
    [organizer, "organizer"],
    [viewer, "viewer"],
  ])
    await db
      .user(owner)
      .query("insert into public.event_members (event_id, user_id, role) values ($1,$2,$3)", [
        ev,
        u,
        role,
      ]);
});
afterAll(async () => db.close());

describe("vendor_replies and gmail_connections (20261024000006)", () => {
  it("owners and organizers store and read replies; each Gmail message once", async () => {
    await db.user(organizer).query(REPLY, [ev, "m1"]);
    expect(await db.user(organizer).error(REPLY, [ev, "m1"])).toMatch(/duplicate key|unique/);
    const rows = await db
      .user(owner)
      .query("select id from public.vendor_replies where event_id = $1", [ev]);
    expect(rows).toHaveLength(1);
  });

  it("viewers, outsiders and anon can't read or write replies", async () => {
    expect(await db.user(viewer).query("select id from public.vendor_replies")).toEqual([]);
    expect(await db.user(outsider).query("select id from public.vendor_replies")).toEqual([]);
    for (const who of [viewer, outsider])
      expect(await db.user(who).error(REPLY, [ev, "m2"])).toMatch(/row-level security/);
    expect(await db.anon.error("select 1 from public.vendor_replies")).toMatch(/permission denied/);
  });

  it("only the analysis can be changed afterwards, and only by organizers", async () => {
    const upd =
      "update public.vendor_replies set analysis = '{\"price\":null}'::jsonb, analyzed_at = now() where event_id = $1";
    await db.user(organizer).query(upd, [ev]);
    expect(
      await db
        .user(owner)
        .error("update public.vendor_replies set body = 'x' where event_id = $1", [ev]),
    ).toMatch(/permission denied/);
    expect(await db.user(viewer).query("select 1 from public.vendor_replies")).toEqual([]);
  });

  it("a Gmail connection belongs to one user and is invisible to others", async () => {
    const ins =
      "insert into public.gmail_connections (user_id, email, refresh_token_enc) values ($1, 'o@gmail.com', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa')";
    await db.user(organizer).query(ins, [organizer]);
    expect(await db.user(owner).error(ins, [organizer])).toMatch(/row-level security/);
    expect(await db.user(owner).query("select 1 from public.gmail_connections")).toEqual([]);
    expect(await db.user(organizer).query("select 1 from public.gmail_connections")).toHaveLength(
      1,
    );
    expect(await db.anon.error("select 1 from public.gmail_connections")).toMatch(
      /permission denied/,
    );
  });
});
