import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { INTERVIEW_EDITABLE_STATUSES } from "@/modules/events/interview-rules";
import { EventStatus } from "@/modules/events/schemas";
import { TestDb } from "./harness";

let db: TestDb;
let owner: string;
let organizer: string;
let viewer: string;
let outsider: string;
let eventId: string;

const SAVE =
  "select public.save_interview_answers($1, 'university-hackathon', 1, $2::jsonb, $3::text[]) as n";
const save = (who: string, answers: unknown, remove: string[] = [], event = eventId) =>
  db.user(who).query<{ n: number }>(SAVE, [event, JSON.stringify(answers), remove]);
const saveError = (who: string, answers: unknown, remove: string[] = [], event = eventId) =>
  db.user(who).error(SAVE, [event, JSON.stringify(answers), remove]);
const stored = async (event = eventId) =>
  Object.fromEntries(
    (
      await db.sql<{ question_key: string; answer: unknown }>(
        "select question_key, answer from public.interview_answers where event_id = $1",
        [event],
      )
    ).map((r) => [r.question_key, r.answer]),
  );

async function createEvent(ownerId: string): Promise<string> {
  const [{ id }] = await db.user(ownerId).query<{ id: string }>(
    `insert into public.events (owner_id, name, starts_at, ends_at, capacity)
       values ($1, 'Campus Hackathon', '2026-12-01T09:00:00+04', '2026-12-02T18:00:00+04', 100) returning id`,
    [ownerId],
  );
  return id;
}

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

describe("saving answers", () => {
  it("owners and organizers save answers; JSON null records a skipped question", async () => {
    expect(
      await save(owner, { "audience.level": "school_students", "catering.dietary": null }),
    ).toEqual([{ n: 2 }]);
    await save(organizer, { "format.team_size": 4, "catering.provided": true });
    expect(await stored()).toEqual({
      "audience.level": "school_students",
      "catering.dietary": null,
      "format.team_size": 4,
      "catering.provided": true,
    });
  });

  it("re-saving a key updates it in place and records who answered under which playbook version", async () => {
    await save(organizer, { "audience.level": "mixed" });
    const rows = await db.sql<{
      answer: unknown;
      answered_by: string;
      source: string;
      playbook_version: number;
    }>(
      "select answer, answered_by, source, playbook_version from public.interview_answers where event_id = $1 and question_key = 'audience.level'",
      [eventId],
    );
    expect(rows).toEqual([
      { answer: "mixed", answered_by: organizer, source: "organizer", playbook_version: 1 },
    ]);
  });

  it("removes answers whose question no longer applies, in the same call", async () => {
    await save(owner, { "audience.min_age": 12 });
    await save(owner, { "audience.level": "university_students" }, ["audience.min_age"]);
    expect(await stored()).not.toHaveProperty("audience.min_age");
  });

  it("refuses a key that is both saved and removed", async () => {
    expect(await saveError(owner, { "a.b": 1 }, ["a.b"])).toMatch(/answer_and_remove_overlap/);
  });

  it("validates key format, value type, size and payload shape", async () => {
    expect(await saveError(owner, { NotDotted: 1 })).toMatch(/question_key_check/);
    expect(await saveError(owner, { "a.b": { nested: true } })).toMatch(/answer_check/);
    expect(await saveError(owner, { "a.b": "x".repeat(5000) })).toMatch(/answer_check/);
    expect(await saveError(owner, ["not", "an", "object"])).toMatch(/answers_not_object/);
    const many = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k.k${i}`, i]));
    expect(await saveError(owner, many)).toMatch(/too_many_answers/);
    expect(
      await db
        .user(owner)
        .error(`select public.save_interview_answers($1, 'Bad Id', 1, '{"a.b": 1}'::jsonb)`, [
          eventId,
        ]),
    ).toMatch(/playbook_id_check/);
  });
});

describe("authorization", () => {
  it("viewers read answers but cannot save them", async () => {
    expect(
      (
        await db
          .user(viewer)
          .query("select 1 from public.interview_answers where event_id = $1", [eventId])
      ).length,
    ).toBeGreaterThan(0);
    expect(await saveError(viewer, { "audience.level": "mixed" })).toMatch(/forbidden/);
  });

  it("outsiders can neither read nor save", async () => {
    expect(
      await db
        .user(outsider)
        .query("select 1 from public.interview_answers where event_id = $1", [eventId]),
    ).toEqual([]);
    expect(await saveError(outsider, { "audience.level": "mixed" })).toMatch(/forbidden/);
  });

  it("an unknown event id is refused without revealing anything", async () => {
    expect(
      await saveError(
        owner,
        { "audience.level": "mixed" },
        [],
        "00000000-0000-4000-8000-000000000000",
      ),
    ).toMatch(/forbidden/);
  });

  it("there is no direct write path: insert, update and delete are denied", async () => {
    expect(
      await db
        .user(owner)
        .error(
          "insert into public.interview_answers (event_id, question_key, answer, playbook_id, playbook_version) values ($1, 'a.b', '1', 'x', 1)",
          [eventId],
        ),
    ).toMatch(/permission denied/);
    expect(
      await db
        .user(owner)
        .error("update public.interview_answers set answer = '2' where event_id = $1", [eventId]),
    ).toMatch(/permission denied/);
    expect(
      await db
        .user(owner)
        .error("delete from public.interview_answers where event_id = $1", [eventId]),
    ).toMatch(/permission denied/);
  });

  it("anon can't read answers or execute the RPC", async () => {
    expect(await db.anon.error("select * from public.interview_answers")).toMatch(
      /permission denied/,
    );
    expect(await db.anon.error(SAVE, [eventId, "{}", []])).toMatch(/permission denied/);
  });

  it("suspended organizers can't save", async () => {
    const admin = await db.createMember("admin@example.test");
    await db.makeAdmin(admin);
    const suspended = await db.createMember("suspended@example.test");
    const own = await createEvent(suspended);
    await db
      .user(admin)
      .query(`select public.set_account_status('${suspended}', 'suspended', 'abuse')`);
    expect(await saveError(suspended, { "audience.level": "mixed" }, [], own)).toMatch(/forbidden/);
  });
});

describe("event state", () => {
  it("answers lock once the event leaves planning (matches INTERVIEW_EDITABLE_STATUSES)", async () => {
    const id = await createEvent(owner);
    await save(owner, { "audience.level": "mixed" }, [], id);
    // draft → planning → ready → live: editable until live.
    for (const status of ["planning", "ready", "live"] as const) {
      await db
        .user(owner)
        .query("update public.events set status = $2 where id = $1", [id, status]);
      const editable = INTERVIEW_EDITABLE_STATUSES.includes(status);
      if (editable) await save(owner, { "format.team_size": 3 }, [], id);
      else
        expect(await saveError(owner, { "format.team_size": 5 }, [], id)).toMatch(
          /interview_locked: live/,
        );
    }
    expect(await stored(id)).toEqual({ "audience.level": "mixed", "format.team_size": 3 });
    expect(EventStatus.options.filter((s) => INTERVIEW_EDITABLE_STATUSES.includes(s))).toEqual([
      "draft",
      "planning",
      "ready",
    ]);
  });

  it("answers are deleted with their event", async () => {
    const id = await createEvent(owner);
    await save(owner, { "audience.level": "mixed" }, [], id);
    await db.user(owner).query("delete from public.events where id = $1", [id]);
    expect(await stored(id)).toEqual({});
  });
});
