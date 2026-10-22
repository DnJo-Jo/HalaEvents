import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";

let db: TestDb;
let owner: string;
let organizer: string;
let viewer: string;
let outsider: string;
let admin: string;
let eventId: string;

const ITEMS = [
  {
    topicKey: "event_permit",
    category: "permit",
    title: "Event permit or activity approval",
    reason: "The venue is not on campus and the audience is the open public.",
    severity: "concern",
    status: "conditional",
    applicability: "likely_applies",
    nextAction: "Ask the venue and DET whether this event needs a permit.",
    channelSourceKey: "det_event_permit",
    sourceKeys: ["det_event_permit", "dda_event_permit"],
  },
  {
    topicKey: "minors_safeguarding",
    category: "minors_safeguarding",
    title: "Safeguarding of minors",
    reason: "School students take part, and guardian consent is not decided.",
    severity: "info",
    status: "needs_information",
    applicability: "applies",
    nextAction: "Decide who collects guardian consent.",
    sourceKeys: [],
  },
];

const sync = (who: string, items: unknown[] = ITEMS) =>
  db
    .user(who)
    .query<{ n: number }>("select public.sync_compliance_checks($1, $2::jsonb) as n", [
      eventId,
      JSON.stringify(items),
    ]);
async function checkId(topic: string): Promise<string> {
  const [{ id }] = await db.sql<{ id: string }>(
    "select id from public.compliance_checks where event_id = $1 and topic_key = $2",
    [eventId, topic],
  );
  return id;
}
const setStatus = (who: string, id: string, status: string, reason: string | null = null) =>
  db.user(who).query("select public.set_compliance_status($1, $2, $3)", [id, status, reason]);
const setStatusError = (who: string, id: string, status: string, reason: string | null = null) =>
  db.user(who).error("select public.set_compliance_status($1, $2, $3)", [id, status, reason]);

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createMember("owner@example.test");
  organizer = await db.createMember("co@example.test");
  viewer = await db.createMember("viewer@example.test");
  outsider = await db.createMember("outsider@example.test");
  admin = await db.createMember("admin@example.test");
  await db.makeAdmin(admin);
  const start = new Date(Date.now() + 40 * 86_400_000).toISOString();
  const end = new Date(Date.now() + 41 * 86_400_000).toISOString();
  [{ id: eventId }] = await db
    .user(owner)
    .query<{ id: string }>(
      "insert into public.events (owner_id, name, starts_at, ends_at, capacity) values ($1, 'Compliance Hack', $2, $3, 80) returning id",
      [owner, start, end],
    );
  await db
    .user(owner)
    .query(
      "insert into public.event_members (event_id, user_id, role) values ($1, $2, 'organizer'), ($1, $3, 'viewer')",
      [eventId, organizer, viewer],
    );
});
afterAll(() => db.close());

describe("source registry", () => {
  it("is curated, readable by signed-in users, and nothing is pre-verified", async () => {
    const rows = await db.user(viewer).query<{
      key: string;
      url: string;
      last_verified_at: string | null;
      retrieval_status: string;
    }>("select key, url, last_verified_at, retrieval_status from public.knowledge_sources order by key");
    expect(rows.map((r) => r.key)).toContain("det_event_permit");
    expect(rows.every((r) => r.url.startsWith("https://"))).toBe(true);
    expect(rows.every((r) => r.last_verified_at === null)).toBe(true);
    expect(await db.anon.error("select key from public.knowledge_sources")).toMatch(
      /permission denied/,
    );
    expect(
      await db.user(owner).error("update public.knowledge_sources set last_verified_at = now()"),
    ).toMatch(/permission denied/);
  });

  it("only platform admins mark a source verified, with a note saying what was checked", async () => {
    const [{ id }] = await db.sql<{ id: string }>(
      "select id from public.knowledge_sources where key = 'dda_event_permit'",
    );
    expect(
      await db
        .user(owner)
        .error("select public.set_source_verification($1, true, 'Checked the live page today')", [
          id,
        ]),
    ).toMatch(/forbidden/);
    expect(
      await db.user(admin).error("select public.set_source_verification($1, true, 'ok')", [id]),
    ).toMatch(/note_required/);
    await db
      .user(admin)
      .query(
        "select public.set_source_verification($1, true, 'Checked the live DDA page on 2026-10-22')",
        [id],
      );
    const [row] = await db.sql<{ verified_by: string }>(
      "select verified_by from public.knowledge_sources where id = $1",
      [id],
    );
    expect(row.verified_by).toBe(admin);
  });
});

describe("compliance checks", () => {
  it("rules create checks with references and the official channel; viewers can't run them", async () => {
    const [{ n }] = await sync(owner);
    expect(n).toBe(2);
    const refs = await db.user(viewer).query<{ key: string }>(
      `select s.key from public.compliance_references r join public.knowledge_sources s on s.id = r.source_id
        where r.event_id = $1 order by s.key`,
      [eventId],
    );
    expect(refs.map((r) => r.key)).toEqual(["dda_event_permit", "det_event_permit"]);
    const [permit] = await db
      .user(viewer)
      .query<{ status: string; origin: string; official_channel_id: string | null }>(
        "select status, origin, official_channel_id from public.compliance_checks where topic_key = 'event_permit'",
      );
    expect(permit).toMatchObject({ status: "conditional", origin: "rule" });
    expect(permit.official_channel_id).not.toBeNull();
    expect(
      await db
        .user(viewer)
        .error("select public.sync_compliance_checks($1, '[]'::jsonb)", [eventId]),
    ).toMatch(/forbidden/);
    expect(await db.user(outsider).query("select id from public.compliance_checks")).toHaveLength(
      0,
    );
  });

  it("rules may only propose automatic states and never overwrite a human decision", async () => {
    expect(
      await db
        .user(owner)
        .error("select public.sync_compliance_checks($1, $2::jsonb)", [
          eventId,
          JSON.stringify([{ ...ITEMS[0], status: "cleared" }]),
        ]),
    ).toMatch(/invalid_items/);
    const id = await checkId("minors_safeguarding");
    await setStatus(organizer, id, "conditional", "Consent form drafted, school to confirm.");
    await sync(owner, [{ ...ITEMS[1], status: "needs_information", reason: "Changed rule text" }]);
    const [row] = await db.sql<{ status: string; reason: string }>(
      "select status, reason from public.compliance_checks where id = $1",
      [id],
    );
    expect(row).toEqual({ status: "conditional", reason: ITEMS[1].reason });
  });

  it("invalid transitions are refused", async () => {
    const id = await checkId("event_permit");
    expect(await setStatusError(owner, id, "cleared", "We think it's fine")).toMatch(
      /invalid_transition: conditional -> cleared/,
    );
    expect(await setStatusError(owner, id, "awaiting_official_response")).toMatch(
      /invalid_transition/,
    );
  });

  it("source_supported needs a referenced source a person verified", async () => {
    const id = await checkId("minors_safeguarding"); // no references
    expect(await setStatusError(owner, id, "source_supported")).toMatch(/source_not_verified/);
    const permit = await checkId("event_permit"); // references DDA, verified above
    await setStatus(owner, permit, "source_supported");
  });

  it("human review: reviewer required, only the reviewer/admin decides, clearing needs real evidence and a reason", async () => {
    const id = await checkId("event_permit");
    expect(await setStatusError(owner, id, "under_review")).toMatch(/reviewer_required/);
    expect(
      await db.user(owner).error("select public.assign_compliance_reviewer($1, $2)", [id, viewer]),
    ).toMatch(/reviewer_not_event_manager/);
    await db.user(owner).query("select public.assign_compliance_reviewer($1, $2)", [id, organizer]);
    await setStatus(owner, id, "under_review");
    expect(await setStatusError(owner, id, "cleared", "Looks fine to me")).toMatch(/reviewer_only/);
    expect(
      await setStatusError(organizer, id, "cleared", "Venue confirmed no permit needed"),
    ).toMatch(/evidence_required/);

    // Simulated evidence doesn't count for clearing.
    await setStatus(
      organizer,
      id,
      "action_required",
      "Need to ask DET whether a permit is needed.",
    );
    await db.user(owner).query("select public.simulate_official_submission($1)", [id]);
    await setStatus(owner, id, "awaiting_official_response");
    await setStatus(owner, id, "under_review");
    expect(await setStatusError(organizer, id, "cleared", "Simulated reply says fine")).toMatch(
      /evidence_required/,
    );

    await db
      .user(owner)
      .query(
        "select public.add_compliance_evidence($1, 'reference_number', 'Venue letter REF-2026-114')",
        [id],
      );
    expect(await setStatusError(organizer, id, "cleared", "x")).toMatch(/reason_required/);
    await setStatus(organizer, id, "cleared", "Venue letter confirms the venue holds the permit.");
    const [row] = await db.sql<{ status: string; status_set_by: string }>(
      "select status, status_set_by from public.compliance_checks where id = $1",
      [id],
    );
    expect(row).toEqual({ status: "cleared", status_set_by: organizer });
  });

  it("platform admins can decide as reviewers; viewers can't change or add anything", async () => {
    const id = await checkId("minors_safeguarding");
    await db.user(owner).query("select public.assign_compliance_reviewer($1, $2)", [id, owner]);
    await setStatus(owner, id, "under_review");
    await setStatus(admin, id, "rejected", "Only university students attend; flagged by mistake.");
    expect(await setStatusError(viewer, id, "under_review")).toMatch(/forbidden/);
    expect(
      await db
        .user(viewer)
        .error("select public.add_compliance_evidence($1, 'note', 'viewer note')", [id]),
    ).toMatch(/forbidden/);
    expect(
      await db
        .user(outsider)
        .error(
          "select public.create_compliance_check($1, 'custom.x', 'other', 'Title', '', 'Reason')",
          [eventId],
        ),
    ).toMatch(/forbidden/);
  });

  it("organizer checks need custom.* keys; evidence links must be https; no direct writes", async () => {
    const [{ id }] = await db
      .user(owner)
      .query<{ id: string }>(
        "select public.create_compliance_check($1, 'custom.drone_footage', 'privacy_media', 'Drone footage', '', 'A sponsor wants drone shots.') as id",
        [eventId],
      );
    expect(id).toBeTruthy();
    expect(
      await db
        .user(owner)
        .error(
          "select public.create_compliance_check($1, 'event_permit_2', 'permit', 'Permit', '', 'Reason')",
          [eventId],
        ),
    ).toMatch(/custom_key/);
    expect(
      await db
        .user(owner)
        .error("select public.add_compliance_evidence($1, 'link', 'javascript:alert(1)')", [id]),
    ).toMatch(/compliance_evidence_link/);
    expect(
      await db
        .user(owner)
        .error("update public.compliance_checks set status = 'cleared' where id = $1", [id]),
    ).toMatch(/permission denied/);
    expect(
      await db
        .user(owner)
        .error(
          "insert into public.compliance_evidence (check_id, event_id, kind, value) values ($1, $2, 'note', 'forged')",
          [id, eventId],
        ),
    ).toMatch(/permission denied/);
  });
});

describe("simulated official submissions", () => {
  it("are always labelled simulated with a DEMO reference; a real one can't be stored", async () => {
    const subs = await db
      .user(viewer)
      .query<{ reference: string; is_simulated: boolean; authority: string }>(
        "select reference, is_simulated, authority from public.official_submissions",
      );
    expect(subs).toHaveLength(1);
    expect(subs[0].reference).toMatch(/^DEMO-[A-F0-9]{8}$/);
    expect(subs[0].is_simulated).toBe(true);
    expect(subs[0].authority).toMatch(/DET/);
    const ev = await db
      .user(viewer)
      .query<{ value: string; is_simulated: boolean }>(
        "select value, is_simulated from public.compliance_evidence where kind = 'submission_reference'",
      );
    expect(ev[0]).toMatchObject({ is_simulated: true });
    expect(ev[0].value).toMatch(/nothing was sent/);
    const [{ id: check }] = await db.sql<{ id: string }>(
      "select check_id as id from public.official_submissions limit 1",
    );
    // Even the migration owner (bypassing RLS and grants) can't store a non-simulated submission.
    await expect(
      db.sql(
        "insert into public.official_submissions (check_id, event_id, authority, reference, is_simulated) values ($1, $2, 'DET', 'DEMO-ABCDEF12', false)",
        [check, eventId],
      ),
    ).rejects.toThrow(/official_submissions_is_simulated_check/);
  });

  it("a simulated response is recorded once, as simulated evidence", async () => {
    const [{ id }] = await db.sql<{ id: string }>(
      "select id from public.official_submissions limit 1",
    );
    await db
      .user(owner)
      .query(
        "select public.record_simulated_response($1, 'Demo: no permit needed for this venue')",
        [id],
      );
    expect(
      await db.user(owner).error("select public.record_simulated_response($1, 'again')", [id]),
    ).toMatch(/invalid_transition/);
    const rows = await db.sql<{ is_simulated: boolean }>(
      "select is_simulated from public.compliance_evidence where kind = 'official_response'",
    );
    expect(rows).toEqual([{ is_simulated: true }]);
  });
});

describe("notifications and audit", () => {
  it("concerns, status changes and review requests create in-app notifications", async () => {
    const own = await db
      .user(owner)
      .query<{ kind: string }>("select kind from public.notifications where event_id = $1", [
        eventId,
      ]);
    expect(own.some((r) => r.kind === "compliance_concern")).toBe(true);
    expect(own.some((r) => r.kind === "missing_information")).toBe(true);
    const org = await db
      .user(organizer)
      .query<{ kind: string }>("select kind from public.notifications where event_id = $1", [
        eventId,
      ]);
    expect(org.some((r) => r.kind === "compliance_status_changed")).toBe(true);
    expect(org.some((r) => r.kind === "decision_required")).toBe(true);
  });

  it("every status change and evidence record is in the audit log", async () => {
    const id = await checkId("event_permit");
    const rows = await db.sql<{ action: string; to: string | null }>(
      "select action, after ->> 'status' as to from public.audit_log where entity_type = 'compliance_checks' and entity_id = $1 order by id",
      [id],
    );
    expect(rows.map((r) => r.to)).toEqual([
      "conditional",
      "source_supported",
      "source_supported", // reviewer assigned
      "under_review",
      "action_required",
      "awaiting_official_response",
      "under_review",
      "cleared",
    ]);
    const evidence = await db.sql(
      "select 1 from public.audit_log where entity_type = 'compliance_evidence' and entity_id = $1",
      [id],
    );
    expect(evidence.length).toBeGreaterThanOrEqual(2);
  });
});

describe("rules parity", () => {
  it("compliance transitions in SQL match src/modules/compliance/rules.ts for every pair", async () => {
    const { COMPLIANCE_TRANSITIONS } = await import("@/modules/compliance/rules");
    const statuses = Object.keys(COMPLIANCE_TRANSITIONS) as (keyof typeof COMPLIANCE_TRANSITIONS)[];
    for (const from of statuses) {
      for (const to of statuses) {
        const [{ ok }] = await db.sql<{ ok: boolean }>(
          "select public.compliance_transition_allowed($1, $2) as ok",
          [from, to],
        );
        expect(ok, `${from} -> ${to}`).toBe(COMPLIANCE_TRANSITIONS[from].includes(to));
      }
    }
  });
});
