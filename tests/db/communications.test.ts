import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";

let db: TestDb;
let owner: string;
let organizer: string;
let viewer: string;
let outsider: string;
let eventId: string;
const att: Record<string, string> = {};

const SAVE = "select public.save_communication($1, $2, $3, $4, $5, $6, $7, null) as id";
const save = (
  who: string,
  id: string | null,
  subject: string,
  body = "Hello {{name}}, see you soon at {{event_name}}.",
  audience = "accepted",
) =>
  db
    .user(who)
    .query<{ id: string }>(SAVE, [id, eventId, "reminder", audience, null, subject, body])
    .then((r) => r[0].id);
const requestApproval = (who: string, id: string) =>
  db
    .user(who)
    .query<{ id: string }>("select public.request_approval('send_communication', $1) as id", [id])
    .then((r) => r[0].id);
const decide = (who: string, id: string, approve = true) =>
  db
    .user(who)
    .query<{ s: string }>("select public.decide_approval($1, $2, null) as s", [id, approve])
    .then((r) => r[0].s);
const claim = (who: string, id: string) =>
  db
    .user(who)
    .query<{ r: { status: string; payload?: { recipients: { attendee_id: string }[] } } }>(
      "select public.claim_approval($1) as r",
      [id],
    )
    .then((r) => r[0].r);
const finish = (who: string, id: string, transport: string, results: unknown[]) =>
  db
    .user(who)
    .query<{ s: string }>("select public.finish_communication($1, $2, $3::jsonb) as s", [
      id,
      transport,
      JSON.stringify(results),
    ])
    .then((r) => r[0].s);
async function status(table: string, id: string) {
  const [row] = await db.sql<{ status: string }>(
    `select status from public.${table} where id = $1`,
    [id],
  );
  return row.status;
}

beforeAll(async () => {
  db = await TestDb.create();
  owner = await db.createMember("owner@example.test");
  organizer = await db.createMember("co@example.test");
  viewer = await db.createMember("viewer@example.test");
  outsider = await db.createMember("outsider@example.test");
  const start = new Date(Date.now() + 20 * 86_400_000).toISOString();
  const end = new Date(Date.now() + 21 * 86_400_000).toISOString();
  [{ id: eventId }] = await db
    .user(owner)
    .query<{ id: string }>(
      "insert into public.events (owner_id, name, starts_at, ends_at, capacity) values ($1, 'Message Hack', $2, $3, 50) returning id",
      [owner, start, end],
    );
  await db
    .user(owner)
    .query(
      "insert into public.event_members (event_id, user_id, role) values ($1, $2, 'organizer'), ($1, $3, 'viewer')",
      [eventId, organizer, viewer],
    );
  for (const name of ["ali", "bea", "cyd"]) {
    const [{ id }] = await db
      .user(owner)
      .query<{ id: string }>("select public.add_attendee($1, $2, $3, null, true) as id", [
        eventId,
        `${name} Person`,
        `${name}@example.test`,
      ]);
    att[name] = id;
  }
  await db
    .user(owner)
    .query("select public.set_attendee_participation($1, 'accepted', null)", [att.ali]);
  await db
    .user(owner)
    .query("select public.set_attendee_participation($1, 'accepted', null)", [att.bea]);
});
afterAll(() => db.close());

describe("drafts and approval requests", () => {
  it("the approval stores the exact payload (content + recipients) and its hash", async () => {
    const msg = await save(owner, null, "Reminder");
    const approval = await requestApproval(organizer, msg);
    const [a] = await db.sql<{
      payload: { subject: string; recipients: { email: string }[] };
      payload_hash: string;
      requested_by: string;
      status: string;
    }>("select payload, payload_hash, requested_by, status from public.approvals where id = $1", [
      approval,
    ]);
    expect(a.status).toBe("pending");
    expect(a.requested_by).toBe(organizer);
    expect(a.payload.subject).toBe("Reminder");
    expect(a.payload.recipients.map((r) => r.email)).toEqual([
      "ali@example.test",
      "bea@example.test",
    ]);
    const [{ h }] = await db.sql<{ h: string }>(
      "select public.payload_hash(payload) as h from public.approvals where id = $1",
      [approval],
    );
    expect(a.payload_hash).toBe(h);
    expect(await status("communications", msg)).toBe("awaiting_approval");
    expect(
      await db.user(owner).error("select public.request_approval('send_communication', $1)", [msg]),
    ).toMatch(/only drafts/);
  });

  it("editing the draft supersedes the open approval: fresh approval required", async () => {
    const msg = await save(owner, null, "Venue change");
    const first = await requestApproval(owner, msg);
    await save(owner, msg, "Venue change (edited)");
    expect(await status("approvals", first)).toBe("superseded");
    expect(await status("communications", msg)).toBe("draft");
    expect(
      await db.user(owner).error("select public.decide_approval($1, true, null)", [first]),
    ).toMatch(/invalid_transition/);
    const second = await requestApproval(owner, msg);
    expect(await decide(owner, second)).toBe("approved");
  });

  it("a changed recipient list between request and decision supersedes instead of approving", async () => {
    const msg = await save(owner, null, "Recipients change");
    const approval = await requestApproval(owner, msg);
    await db
      .user(owner)
      .query("select public.set_attendee_participation($1, 'accepted', null)", [att.cyd]);
    expect(await decide(owner, approval)).toBe("superseded");
    expect(await status("communications", msg)).toBe("draft");
    // Restore for later tests.
    await db
      .user(owner)
      .query("select public.set_attendee_participation($1, 'cancelled', null)", [att.cyd]);
  });

  it("a changed recipient list after approval blocks execution", async () => {
    const msg = await save(owner, null, "Late change");
    const approval = await requestApproval(owner, msg);
    await decide(owner, approval);
    await db.user(owner).query("select public.withdraw_attendee($1, null)", [att.bea]);
    expect((await claim(owner, approval)).status).toBe("superseded");
    expect(await status("approvals", approval)).toBe("superseded");
    // Put Bea back for later tests (new registration row).
    const [{ id }] = await db
      .user(owner)
      .query<{ id: string }>(
        "select public.add_attendee($1, 'bea Person', 'bea@example.test', null, true) as id",
        [eventId],
      );
    att.bea = id;
    await db
      .user(owner)
      .query("select public.set_attendee_participation($1, 'accepted', null)", [att.bea]);
  });

  it("no recipients → no approval; viewers/outsiders can't draft, approve or send", async () => {
    const empty = await save(
      owner,
      null,
      "Nobody",
      "Hello {{name}}, nobody is waitlisted.",
      "waitlisted",
    );
    expect(
      await db
        .user(owner)
        .error("select public.request_approval('send_communication', $1)", [empty]),
    ).toMatch(/no_recipients/);
    expect(
      await db
        .user(viewer)
        .error(SAVE, [null, eventId, "reminder", "accepted", null, "Hi", "Body text here"]),
    ).toMatch(/forbidden/);
    const msg = await save(owner, null, "Guarded");
    const approval = await requestApproval(owner, msg);
    expect(
      await db.user(viewer).error("select public.decide_approval($1, true, null)", [approval]),
    ).toMatch(/forbidden/);
    expect(
      await db.user(outsider).error("select public.decide_approval($1, true, null)", [approval]),
    ).toMatch(/forbidden/);
    await decide(owner, approval);
    expect(await db.user(viewer).error("select public.claim_approval($1)", [approval])).toMatch(
      /forbidden/,
    );
    expect(await db.user(viewer).query("select id from public.communications")).toHaveLength(0);
    expect(
      await db
        .user(owner)
        .error("update public.communications set body = 'x' where id = $1", [msg]),
    ).toMatch(/permission denied/);
    expect(await db.user(owner).error("update public.approvals set status = 'approved'")).toMatch(
      /permission denied/,
    );
  });
});

describe("sending", () => {
  it("can't send without approval; executes once; mock results are recorded as simulated", async () => {
    const msg = await save(owner, null, "Mock send");
    const approval = await requestApproval(owner, msg);
    expect(await db.user(owner).error("select public.claim_approval($1)", [approval])).toMatch(
      /not_approved/,
    );
    await decide(organizer, approval);
    const claimed = await claim(owner, approval);
    expect(claimed.status).toBe("executing");
    expect(await status("communications", msg)).toBe("sending");
    expect(await db.user(owner).error("select public.claim_approval($1)", [approval])).toMatch(
      /already_executed/,
    );

    const results = claimed.payload!.recipients.map((r) => ({
      attendee_id: r.attendee_id,
      status: "simulated",
    }));
    expect(
      await db
        .user(organizer)
        .error("select public.finish_communication($1, 'mock', $2::jsonb)", [
          approval,
          JSON.stringify(results),
        ]),
    ).toMatch(/invalid_transition/); // only the executor finishes
    expect(await finish(owner, approval, "mock", results)).toBe("sent");
    const deliveries = await db.sql<{ status: string; is_simulated: boolean; transport: string }>(
      "select status, is_simulated, transport from public.communication_deliveries where approval_id = $1",
      [approval],
    );
    expect(deliveries).toHaveLength(2);
    expect(
      deliveries.every((d) => d.status === "simulated" && d.is_simulated && d.transport === "mock"),
    ).toBe(true);
    const [a] = await db.sql<{ status: string; result: { simulated: boolean } }>(
      "select status, result from public.approvals where id = $1",
      [approval],
    );
    expect(a).toMatchObject({ status: "executed", result: { simulated: true } });
    expect(await db.user(owner).error("select public.claim_approval($1)", [approval])).toMatch(
      /already_executed/,
    );
  });

  it("mock can't report 'accepted', a real transport can't report 'simulated', results must match the approved recipients", async () => {
    const msg = await save(owner, null, "Real send");
    const approval = await requestApproval(owner, msg);
    await decide(owner, approval);
    const claimed = await claim(owner, approval);
    const ids = claimed.payload!.recipients.map((r) => r.attendee_id);
    const mk = (status: string) => ids.map((attendee_id) => ({ attendee_id, status }));
    expect(
      await db
        .user(owner)
        .error("select public.finish_communication($1, 'mock', $2::jsonb)", [
          approval,
          JSON.stringify(mk("accepted")),
        ]),
    ).toMatch(/invalid_results/);
    expect(
      await db
        .user(owner)
        .error("select public.finish_communication($1, 'resend', $2::jsonb)", [
          approval,
          JSON.stringify(mk("simulated")),
        ]),
    ).toMatch(/invalid_results/);
    expect(
      await db
        .user(owner)
        .error("select public.finish_communication($1, 'resend', $2::jsonb)", [
          approval,
          JSON.stringify(mk("delivered")),
        ]),
    ).toMatch(/invalid_results/); // API acceptance is not delivery
    const intruder = [
      { attendee_id: att.cyd, status: "accepted" },
      { attendee_id: ids[1], status: "accepted" },
    ];
    expect(
      await db
        .user(owner)
        .error("select public.finish_communication($1, 'resend', $2::jsonb)", [
          approval,
          JSON.stringify(intruder),
        ]),
    ).toMatch(/unknown recipient/);
    const results = [
      {
        attendee_id: ids[0],
        status: "accepted",
        provider_message_id: "re_123",
        provider_response: { id: "re_123" },
      },
      { attendee_id: ids[1], status: "failed", error: "422 invalid recipient" },
    ];
    expect(await finish(owner, approval, "resend", results)).toBe("partially_failed");
    const rows = await db.sql<{
      status: string;
      is_simulated: boolean;
      provider_message_id: string | null;
    }>(
      "select status, is_simulated, provider_message_id from public.communication_deliveries where approval_id = $1 order by status",
      [approval],
    );
    expect(rows).toEqual([
      { status: "accepted", is_simulated: false, provider_message_id: "re_123" },
      { status: "failed", is_simulated: false, provider_message_id: null },
    ]);
  });

  it("delivery results never change attendee status", async () => {
    const [row] = await db.sql<{ participation_status: string }>(
      "select participation_status from public.attendees where id = $1",
      [att.ali],
    );
    expect(row.participation_status).toBe("accepted");
  });

  it("sent messages can't be edited or cancelled; approvals are audited", async () => {
    const [{ id }] = await db.sql<{ id: string }>(
      "select id from public.communications where subject = 'Mock send'",
    );
    expect(
      await db
        .user(owner)
        .error(SAVE, [id, eventId, "reminder", "accepted", null, "Changed", "Changed body text"]),
    ).toMatch(/invalid_transition/);
    expect(await db.user(owner).error("select public.cancel_communication($1)", [id])).toMatch(
      /invalid_transition/,
    );
    const audit = await db.sql("select 1 from public.audit_log where entity_type = 'approvals'");
    expect(audit.length).toBeGreaterThan(5);
  });
});
