import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";

// Venue-cancellation recovery (migration 20261022000008). Runs on PGlite with the real migrations:
// a local approach, not a live Supabase project.

let db: TestDb;
let admin: string;
let organizer: string;
let coOrganizer: string;
let viewer: string;
let outsider: string;
let venueOwner: string;
let catererOwner: string;
let altOwner: string;
let eventId: string;
let otherEvent: string;
let venueProvider: string;
let catererProvider: string;
let altVenue: string;
let venueBooking: string;
let catererBooking: string;
const task: Record<string, string> = {};
const check: Record<string, string> = {};

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const day = (days: number) => future(days).slice(0, 10);

async function createProvider(owner: string, kind: string, category: string, name: string) {
  const [{ id }] = await db
    .user(owner)
    .query<{ id: string }>(
      "select public.create_provider($1, $2, $3, 'desc', 'Dubai', '{Dubai}', 10, 500, 50, 150, 'AED', 'ops@example.test') as id",
      [kind, category, name],
    );
  await db.user(owner).query("select public.submit_provider_for_verification($1)", [id]);
  await db.user(admin).query("select public.set_provider_verification($1, 'verified', null)", [id]);
  return id;
}

async function confirmedBooking(
  event: string,
  provider: string,
  owner: string,
  category: string,
  confirm = true,
) {
  const [{ id: requestId }] = await db
    .user(organizer)
    .query<{ id: string }>(
      `select public.create_service_request($1, $2, 'Need it', 'Requirements for the hackathon event.', $3, $4, 100, 20000, 'AED', null, $5) as id`,
      [event, category, future(30), future(31), [provider]],
    );
  const [{ id: quoteId }] = await db
    .user(owner)
    .query<{ id: string }>(
      "select public.save_quote($1, $2, 9000, 'AED', 'Everything', null, 'Deposit 30%', $3, true) as id",
      [requestId, provider, future(14)],
    );
  const [{ id: bookingId }] = await db
    .user(organizer)
    .query<{ id: string }>("select public.propose_booking($1, null) as id", [quoteId]);
  const [{ id: approval }] = await db
    .user(organizer)
    .query<{ id: string }>("select public.request_booking_approval($1) as id", [bookingId]);
  await db.user(organizer).query("select public.decide_approval($1, true, null)", [approval]);
  await db.user(organizer).query("select public.execute_booking_approval($1)", [approval]);
  if (confirm) {
    await db
      .user(owner)
      .query("select public.provider_booking_action($1, 'confirmed', null)", [bookingId]);
  }
  return bookingId;
}

const simulate = (who: string, booking = venueBooking, key = "key-0000-0001", note = "Practice") =>
  db
    .user(who)
    .query<{ r: { id: string; created: boolean } }>(
      "select public.simulate_venue_cancellation($1, $2, $3, $4) as r",
      [eventId, booking, key, note],
    )
    .then((r) => r[0].r);

/** A successful 'recovery' AI run owned by `who`, as the service would record it. */
async function aiRun(who: string, status = "succeeded") {
  const [{ id }] = await db
    .user(who)
    .query<{ id: string }>(
      "select public.start_ai_run($1, 'recovery', 'mock', 'mock', $2, true) as id",
      [eventId, createHash("sha256").update(randomUUID()).digest("hex")],
    );
  await db
    .user(who)
    .query("select public.finish_ai_run($1, $2, null, 1, 1, 0, 0, 'mock')", [id, status]);
  return id;
}

const PROPOSAL = { summary: "A proposal for the practice scenario." };
const attendeeDraft = { subject: "Venue update", body: "We are looking at a new venue." };
const savePlan = (
  who: string,
  incident: string,
  run: string,
  changes: unknown[],
  inquiries: unknown[] = [],
) =>
  db
    .user(who)
    .query<{ id: string }>(
      "select public.save_recovery_plan($1, $2, $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb) as id",
      [
        incident,
        run,
        JSON.stringify(PROPOSAL),
        JSON.stringify(changes),
        JSON.stringify(inquiries),
        JSON.stringify(attendeeDraft),
      ],
    )
    .then((r) => r[0].id);
const taskStatusAndDue = async (id: string) =>
  (
    await db.sql<{ due_date: string }>(
      "select to_char(due_date, 'YYYY-MM-DD') as due_date from public.tasks where id = $1",
      [id],
    )
  )[0].due_date;
const requestApproval = (who: string, action: string, target: string) =>
  db
    .user(who)
    .query<{ id: string }>("select public.request_approval($1, $2) as id", [action, target])
    .then((r) => r[0].id);
const decide = (who: string, id: string, approve = true) =>
  db
    .user(who)
    .query<{ s: string }>("select public.decide_approval($1, $2, null) as s", [id, approve])
    .then((r) => r[0].s);

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createMember("admin@example.test", ["organizer"]);
  await db.makeAdmin(admin);
  organizer = await db.createMember("org@example.test", ["organizer"]);
  coOrganizer = await db.createMember("co@example.test", ["organizer"]);
  viewer = await db.createMember("viewer@example.test", ["organizer"]);
  outsider = await db.createMember("outsider@example.test", ["organizer"]);
  venueOwner = await db.createMember("venue@example.test", ["venue_provider"]);
  catererOwner = await db.createMember("cater@example.test", ["service_provider"]);
  altOwner = await db.createMember("alt@example.test", ["venue_provider"]);
  venueProvider = await createProvider(venueOwner, "venue", "venue", "Original Hall");
  catererProvider = await createProvider(catererOwner, "service", "catering", "Test Kitchen");
  altVenue = await createProvider(altOwner, "venue", "venue", "Alternative Hall");
  // A venue nobody verified must never be a candidate.
  const unverifiedOwner = await db.createMember("unverified@example.test", ["venue_provider"]);
  await db
    .user(unverifiedOwner)
    .query(
      "select public.create_provider('venue', 'venue', 'Unverified Hall', 'desc', 'Dubai', '{Dubai}', 10, 500, 50, 150, 'AED', 'x@example.test')",
    );

  for (const [key, name] of [
    ["eventId", "Recovery Hack"],
    ["otherEvent", "Other Hack"],
  ] as const) {
    const [{ id }] = await db
      .user(organizer)
      .query<{ id: string }>(
        "insert into public.events (owner_id, name, starts_at, ends_at, capacity, city) values ($1, $2, $3, $4, 100, 'Dubai') returning id",
        [organizer, name, future(30), future(31)],
      );
    if (key === "eventId") eventId = id;
    else otherEvent = id;
  }
  await db
    .user(organizer)
    .query(
      "insert into public.event_members (event_id, user_id, role) values ($1, $2, 'organizer'), ($1, $3, 'viewer')",
      [eventId, coOrganizer, viewer],
    );

  venueBooking = await confirmedBooking(eventId, venueProvider, venueOwner, "venue");
  catererBooking = await confirmedBooking(eventId, catererProvider, catererOwner, "catering");

  // Tasks: venue work, two that (transitively) depend on it, and two unrelated ones.
  const mk = async (
    key: string,
    event: string,
    title: string,
    category: string,
    status = "todo",
  ) => {
    const [{ id }] = await db.sql<{ id: string }>(
      "insert into public.tasks (event_id, title, category, status, due_date) values ($1, $2, $3, $4, $5) returning id",
      [event, title, category, status, day(20)],
    );
    task[key] = id;
  };
  await mk("hall", eventId, "Finalize hall layout", "venue");
  await mk("signage", eventId, "Print venue signage", "logistics");
  await mk("walk", eventId, "Final walkthrough", "logistics");
  await mk("menu", eventId, "Confirm lunch menu", "catering");
  await mk("done", eventId, "Collect floor plan", "venue", "todo");
  await mk("foreign", otherEvent, "Another venue task", "venue");
  await db.sql(
    "insert into public.task_dependencies (task_id, depends_on_task_id, event_id) values ($1, $2, $3), ($4, $1, $3)",
    [task.signage, task.hall, eventId, task.walk],
  );
  await db.sql("update public.tasks set status = 'in_progress' where id = $1", [task.done]);

  const mkCheck = async (
    key: string,
    topic: string,
    category: string,
    title: string,
    status: string,
  ) => {
    const [{ id }] = await db.sql<{ id: string }>(
      `insert into public.compliance_checks (event_id, topic_key, category, title, reason, origin, status)
       values ($1, $2, $3, $4, 'because of the practice scenario', 'rule', $5) returning id`,
      [eventId, topic, category, title, status],
    );
    check[key] = id;
  };
  await mkCheck("permit", "event_permit", "permit", "Event permit", "under_review");
  await mkCheck("access", "venue_access", "other", "Venue access and fire exits", "cleared");
  await mkCheck("media", "photo_consent", "privacy_media", "Photo consent", "needs_information");
  await mkCheck("closedPermit", "old_permit", "permit", "Closed permit item", "closed");

  for (const name of ["ali", "bea"]) {
    const [{ id }] = await db
      .user(organizer)
      .query<{ id: string }>("select public.add_attendee($1, $2, $3, null, true) as id", [
        eventId,
        `${name} Person`,
        `${name}@example.test`,
      ]);
    await db
      .user(organizer)
      .query("select public.set_attendee_participation($1, 'accepted', null)", [id]);
  }
}, 60_000);
afterAll(() => db.close());

describe("simulation: authorization and idempotency", () => {
  let incident: string;

  it("only event managers can simulate; viewers and outsiders cannot", async () => {
    for (const who of [viewer, outsider, venueOwner]) {
      expect(
        await db
          .user(who)
          .error("select public.simulate_venue_cancellation($1, $2, 'key-0000-0001', null)", [
            eventId,
            venueBooking,
          ]),
      ).toMatch(/forbidden/);
    }
    expect(
      await db.anon.error(
        "select public.simulate_venue_cancellation($1, $2, 'key-0000-0001', null)",
        [eventId, venueBooking],
      ),
    ).toMatch(/permission denied/);
  });

  it("only a venue booking can be simulated; the caterer's cannot", async () => {
    expect(
      await db
        .user(organizer)
        .error("select public.simulate_venue_cancellation($1, $2, 'key-0000-0009', null)", [
          eventId,
          catererBooking,
        ]),
    ).toMatch(/not_a_venue_booking/);
  });

  it("a repeated request returns the same incident and creates nothing new", async () => {
    const first = await simulate(organizer);
    const again = await simulate(organizer);
    const byOther = await simulate(coOrganizer, venueBooking, "different-key-001");
    incident = first.id;
    expect(first.created).toBe(true);
    expect(again).toEqual({ id: incident, created: false });
    expect(byOther).toEqual({ id: incident, created: false });
    const [{ n }] = await db.sql<{ n: string }>("select count(*) as n from public.incidents");
    expect(Number(n)).toBe(1);
  });

  it("the same key for another booking is a conflict, not a second incident", async () => {
    expect(
      await db
        .user(organizer)
        .error("select public.simulate_venue_cancellation($1, $2, 'key-0000-0001', null)", [
          eventId,
          catererBooking,
        ]),
    ).toMatch(/idempotency_conflict/);
  });

  it("records the simulation flag and timestamp, and never touches the booking", async () => {
    const [i] = await db.sql<{
      is_simulated: boolean;
      simulated_at: string;
      status: string;
      note: string;
    }>("select is_simulated, simulated_at, status, note from public.incidents where id = $1", [
      incident,
    ]);
    expect(i).toMatchObject({ is_simulated: true, status: "assessing", note: "Practice" });
    expect(i.simulated_at).toBeTruthy();
    const [b] = await db.sql<{ status: string }>(
      "select status from public.bookings where id = $1",
      [venueBooking],
    );
    expect(b.status).toBe("confirmed");
    const audit = await db.sql("select 1 from public.audit_log where entity_id = $1", [incident]);
    expect(audit.length).toBeGreaterThan(0);
  });

  it("a real (non-simulated) incident cannot be stored at all", async () => {
    expect(
      await db.pg
        .query(
          "insert into public.incidents (event_id, booking_id, idempotency_key, is_simulated, impact) values ($1, $2, 'real-key-0001', false, '{}')",
          [eventId, venueBooking],
        )
        .then(
          () => "inserted",
          (e: Error) => e.message,
        ),
    ).toMatch(/is_simulated|violates check/);
  });

  it("clients cannot write the recovery tables directly", async () => {
    expect(
      await db.user(organizer).error("update public.incidents set status = 'resolved'"),
    ).toMatch(/permission denied/);
    expect(await db.user(organizer).error("delete from public.recovery_changes")).toMatch(
      /permission denied/,
    );
    expect(
      await db
        .user(organizer)
        .error(
          "insert into public.recovery_flags (incident_id, event_id, entity_type, entity_id, action, reason) values ($1, $2, 'task', $1, 'review', 'xxx')",
          [incident, eventId],
        ),
    ).toMatch(/permission denied/);
  });

  it("outsiders and viewers cannot read incidents; managers can", async () => {
    expect((await db.user(outsider).query("select id from public.incidents")).length).toBe(0);
    expect((await db.user(viewer).query("select id from public.incidents")).length).toBe(0);
    expect((await db.user(coOrganizer).query("select id from public.incidents")).length).toBe(1);
  });
});

describe("deterministic impact analysis", () => {
  let impact: {
    affected_tasks: { id: string; reason: string }[];
    plan_tasks: { id: string }[];
    services: { booking_id: string; provider_name: string }[];
    compliance: { id: string }[];
    candidates: { provider_id: string; availability: string; quote: unknown }[];
    venue: { booking_id: string };
  };
  beforeAll(async () => {
    const [i] = await db.sql<{ impact: typeof impact }>("select impact from public.incidents");
    impact = i.impact;
  });

  it("finds venue tasks and everything that transitively depends on them, in this event only", () => {
    const ids = impact.affected_tasks.map((t) => t.id).sort();
    expect(ids).toEqual([task.hall, task.signage, task.walk, task.done].sort());
    expect(impact.affected_tasks.find((t) => t.id === task.walk)?.reason).toBe(
      "depends_on_venue_work",
    );
    expect(impact.affected_tasks.find((t) => t.id === task.hall)?.reason).toBe("venue_task");
    expect(ids).not.toContain(task.menu);
    expect(ids).not.toContain(task.foreign);
    expect(impact.plan_tasks.map((t) => t.id)).not.toContain(task.foreign);
  });

  it("lists service bookings for review but never as cancelled", async () => {
    expect(impact.services.map((s) => s.booking_id)).toEqual([catererBooking]);
    expect(impact.venue.booking_id).toBe(venueBooking);
    const [b] = await db.sql<{ status: string }>(
      "select status from public.bookings where id = $1",
      [catererBooking],
    );
    expect(b.status).toBe("confirmed");
  });

  it("finds unresolved venue-related compliance, including a cleared one to reassess", () => {
    const ids = impact.compliance.map((c) => c.id).sort();
    expect(ids).toEqual([check.permit, check.access].sort());
    expect(ids).not.toContain(check.media);
    expect(ids).not.toContain(check.closedPermit);
  });

  it("offers only verified, active, other venues as candidates and never claims availability", () => {
    expect(impact.candidates.map((c) => c.provider_id)).toEqual([altVenue]);
    expect(impact.candidates[0].availability).toBe("unknown");
    expect(impact.candidates[0].quote).toBeNull();
  });
});

describe("saving a proposal: the database re-checks what the model referenced", () => {
  let incident: string;
  beforeAll(async () => {
    [{ id: incident }] = await db.sql<{ id: string }>("select id from public.incidents");
  });

  it("rejects a task outside the impact snapshot (unrelated or from another event)", async () => {
    for (const bad of [task.menu, task.foreign, "00000000-0000-4000-8000-000000000000"]) {
      const run = await aiRun(organizer);
      expect(
        await db
          .user(organizer)
          .error(
            "select public.save_recovery_plan($1, $2, $3::jsonb, $4::jsonb, '[]', $5::jsonb)",
            [
              incident,
              run,
              JSON.stringify(PROPOSAL),
              JSON.stringify([
                {
                  kind: "reschedule_task",
                  entity_type: "task",
                  entity_id: bad,
                  payload: { due_date: day(25) },
                },
              ]),
              JSON.stringify(attendeeDraft),
            ],
          ),
      ).toMatch(/invalid_plan/);
    }
  });

  it("rejects a flag on something outside the incident, an unknown kind, and a bad date", async () => {
    const cases = [
      {
        kind: "flag_review",
        entity_type: "booking",
        entity_id: venueBooking,
        payload: { action: "review", reason: "check it" },
      },
      {
        kind: "flag_review",
        entity_type: "compliance_check",
        entity_id: check.media,
        payload: { action: "reassess", reason: "check it" },
      },
      { kind: "cancel_booking", entity_type: "booking", entity_id: catererBooking, payload: {} },
    ];
    for (const c of cases) {
      const run = await aiRun(organizer);
      expect(
        await db
          .user(organizer)
          .error(
            "select public.save_recovery_plan($1, $2, $3::jsonb, $4::jsonb, '[]', $5::jsonb)",
            [
              incident,
              run,
              JSON.stringify(PROPOSAL),
              JSON.stringify([c]),
              JSON.stringify(attendeeDraft),
            ],
          ),
      ).toMatch(/invalid_plan/);
    }
    const run = await aiRun(organizer);
    expect(
      await db
        .user(organizer)
        .error("select public.save_recovery_plan($1, $2, $3::jsonb, $4::jsonb, '[]', $5::jsonb)", [
          incident,
          run,
          JSON.stringify(PROPOSAL),
          JSON.stringify([
            {
              kind: "reschedule_task",
              entity_type: "task",
              entity_id: task.hall,
              payload: { due_date: "not-a-date" },
            },
          ]),
          JSON.stringify(attendeeDraft),
        ]),
    ).toBeTruthy();
  });

  it("rejects an inquiry to a provider that is not part of this incident", async () => {
    const run = await aiRun(organizer);
    const stranger = await db.createMember("stranger-provider@example.test", ["service_provider"]);
    const strangerProvider = await createProvider(stranger, "service", "av", "Stranger AV");
    expect(
      await db
        .user(organizer)
        .error("select public.save_recovery_plan($1, $2, $3::jsonb, '[]', $4::jsonb, $5::jsonb)", [
          incident,
          run,
          JSON.stringify(PROPOSAL),
          JSON.stringify([
            {
              provider_id: strangerProvider,
              booking_id: "",
              purpose: "service_reconfirmation",
              subject: "Hello there",
              body: "Please reconfirm your booking details.",
            },
          ]),
          JSON.stringify(attendeeDraft),
        ]),
    ).toMatch(/invalid_plan/);
  });

  it("requires a successful, own, unused recovery run; viewers cannot save", async () => {
    const change = [
      {
        kind: "reschedule_task",
        entity_type: "task",
        entity_id: task.hall,
        payload: { due_date: day(25) },
      },
    ];
    expect(
      await db
        .user(organizer)
        .error("select public.save_recovery_plan($1, $2, $3::jsonb, $4::jsonb, '[]', $5::jsonb)", [
          incident,
          "00000000-0000-4000-8000-000000000001",
          JSON.stringify(PROPOSAL),
          JSON.stringify(change),
          JSON.stringify(attendeeDraft),
        ]),
    ).toMatch(/run_not_usable/);
    const failed = await aiRun(organizer, "invalid_output");
    expect(
      await db
        .user(organizer)
        .error("select public.save_recovery_plan($1, $2, $3::jsonb, $4::jsonb, '[]', $5::jsonb)", [
          incident,
          failed,
          JSON.stringify(PROPOSAL),
          JSON.stringify(change),
          JSON.stringify(attendeeDraft),
        ]),
    ).toMatch(/run_not_usable/);
    const others = await aiRun(coOrganizer);
    expect(
      await db
        .user(organizer)
        .error("select public.save_recovery_plan($1, $2, $3::jsonb, $4::jsonb, '[]', $5::jsonb)", [
          incident,
          others,
          JSON.stringify(PROPOSAL),
          JSON.stringify(change),
          JSON.stringify(attendeeDraft),
        ]),
    ).toMatch(/run_not_usable/);
    const run = await aiRun(organizer);
    expect(
      await db
        .user(viewer)
        .error("select public.save_recovery_plan($1, $2, $3::jsonb, $4::jsonb, '[]', $5::jsonb)", [
          incident,
          run,
          JSON.stringify(PROPOSAL),
          JSON.stringify(change),
          JSON.stringify(attendeeDraft),
        ]),
    ).toMatch(/forbidden/);
    // Nothing was stored by any of the rejected attempts.
    const [{ n }] = await db.sql<{ n: string }>("select count(*) as n from public.recovery_plans");
    expect(Number(n)).toBe(0);
  });
});

describe("applying a plan: nothing happens before approval, and only the approved subset is applied", () => {
  let incident: string;
  let plan: string;
  let changes: { id: string; kind: string; entity_id: string | null }[];
  const original = {} as Record<string, string>;

  beforeAll(async () => {
    [{ id: incident }] = await db.sql<{ id: string }>("select id from public.incidents");
    for (const k of ["hall", "signage", "walk"]) original[k] = await taskStatusAndDue(task[k]);
    const run = await aiRun(organizer);
    plan = await savePlan(
      organizer,
      incident,
      run,
      [
        {
          kind: "reschedule_task",
          entity_type: "task",
          entity_id: task.hall,
          payload: { due_date: day(40) },
        },
        {
          kind: "reschedule_task",
          entity_type: "task",
          entity_id: task.signage,
          payload: { due_date: day(41) },
        },
        {
          kind: "add_task",
          entity_type: null,
          entity_id: null,
          payload: {
            title: "Visit replacement venue",
            description: "See it first",
            category: "venue",
            priority: "high",
            due_date: day(10),
          },
        },
        {
          kind: "flag_review",
          entity_type: "booking",
          entity_id: catererBooking,
          payload: { action: "reconfirm", reason: "Venue changes the catering address." },
        },
        {
          kind: "flag_review",
          entity_type: "compliance_check",
          entity_id: check.permit,
          payload: { action: "reassess", reason: "Permit names the old venue." },
        },
      ],
      [
        {
          provider_id: catererProvider,
          booking_id: catererBooking,
          purpose: "service_reconfirmation",
          subject: "Please reconfirm",
          body: "Please reconfirm your booking once the venue is known.",
        },
        {
          provider_id: altVenue,
          booking_id: "",
          purpose: "replacement_venue_availability",
          subject: "Availability inquiry",
          body: "Is your hall free on the event date?",
        },
      ],
    );
    changes = await db.sql(
      "select id, kind, entity_id from public.recovery_changes where plan_id = $1 order by seq",
      [plan],
    );
  });

  it("storing a proposal changes no task, booking or check and sends nothing", async () => {
    for (const k of ["hall", "signage", "walk"])
      expect(await taskStatusAndDue(task[k])).toBe(original[k]);
    const [b] = await db.sql<{ status: string }>(
      "select status from public.bookings where id = $1",
      [catererBooking],
    );
    expect(b.status).toBe("confirmed");
    const [{ n }] = await db.sql<{ n: string }>(
      "select count(*) as n from public.tasks where title = 'Visit replacement venue'",
    );
    expect(Number(n)).toBe(0);
    expect((await db.sql("select 1 from public.recovery_flags")).length).toBe(0);
    const [i] = await db.sql<{ status: string }>(
      "select status from public.incidents where id = $1",
      [incident],
    );
    expect(i.status).toBe("replan_proposed");
    const [p] = await db.sql<{ status: string }>(
      "select status from public.recovery_plans where id = $1",
      [plan],
    );
    expect(p.status).toBe("proposed");
  });

  it("drafts for providers and attendees exist as drafts, labelled as simulations, with no delivery", async () => {
    const inquiries = await db.sql<{ status: string; subject: string; body: string }>(
      "select status, subject, body from public.recovery_inquiries where plan_id = $1",
      [plan],
    );
    expect(inquiries).toHaveLength(2);
    for (const q of inquiries) {
      expect(q.status).toBe("draft");
      expect(q.subject.startsWith("[SIMULATION]")).toBe(true);
      expect(q.body).toMatch(/^SIMULATED DEMO/);
    }
    const [c] = await db.sql<{ status: string; subject: string; kind: string; drafted_by: string }>(
      "select status, subject, kind, drafted_by from public.communications where recovery_plan_id = $1",
      [plan],
    );
    expect(c).toMatchObject({ status: "draft", kind: "venue_update", drafted_by: "ai" });
    expect(c.subject.startsWith("[SIMULATION]")).toBe(true);
    expect((await db.sql("select 1 from public.communication_deliveries")).length).toBe(0);
  });

  it("an approval needs at least one selected change, and only managers can request or decide", async () => {
    await db.user(organizer).query("select public.set_recovery_selection($1, '{}')", [plan]);
    expect(
      await db
        .user(organizer)
        .error("select public.request_approval('apply_recovery', $1)", [plan]),
    ).toMatch(/nothing_selected/);
    expect(
      await db.user(viewer).error("select public.request_approval('apply_recovery', $1)", [plan]),
    ).toMatch(/forbidden/);
    expect(
      await db.user(outsider).error("select public.set_recovery_selection($1, '{}')", [plan]),
    ).toMatch(/forbidden/);
  });

  it("a change id from another plan cannot be selected", async () => {
    expect(
      await db
        .user(organizer)
        .error("select public.set_recovery_selection($1, $2)", [
          plan,
          ["00000000-0000-4000-8000-000000000009"],
        ]),
    ).toMatch(/not_found/);
  });

  it("approving a subset applies exactly that subset", async () => {
    const pick = [changes[0].id, changes[2].id, changes[3].id]; // reschedule hall, add task, flag caterer booking
    await db.user(organizer).query("select public.set_recovery_selection($1, $2)", [plan, pick]);
    const approval = await requestApproval(organizer, "apply_recovery", plan);
    // Approved but not yet executed: still nothing applied.
    expect(await decide(coOrganizer, approval)).toBe("approved");
    expect(await taskStatusAndDue(task.hall)).toBe(original.hall);
    expect(
      await db.user(viewer).error("select public.execute_recovery_approval($1)", [approval]),
    ).toMatch(/forbidden/);

    const [{ r }] = await db
      .user(organizer)
      .query<{ r: string }>("select public.execute_recovery_approval($1) as r", [approval]);
    expect(r).toBe("executed");
    expect(await taskStatusAndDue(task.hall)).toBe(day(40));
    expect(await taskStatusAndDue(task.signage)).toBe(original.signage); // not selected
    expect(await taskStatusAndDue(task.walk)).toBe(original.walk);
    const [{ n }] = await db.sql<{ n: string }>(
      "select count(*) as n from public.tasks where title = 'Visit replacement venue'",
    );
    expect(Number(n)).toBe(1);
    const flags = await db.sql<{ entity_id: string; action: string }>(
      "select entity_id, action from public.recovery_flags",
    );
    expect(flags).toEqual([{ entity_id: catererBooking, action: "reconfirm" }]);
    // The flagged booking itself is untouched: only its provider can change it.
    const [b] = await db.sql<{ status: string }>(
      "select status from public.bookings where id = $1",
      [catererBooking],
    );
    expect(b.status).toBe("confirmed");
    const states = await db.sql<{ status: string }>(
      "select status from public.recovery_changes where plan_id = $1 order by seq",
      [plan],
    );
    expect(states.map((s) => s.status)).toEqual([
      "applied",
      "skipped",
      "applied",
      "applied",
      "skipped",
    ]);
    const [p] = await db.sql<{ status: string; applied_by: string }>(
      "select status, applied_by from public.recovery_plans where id = $1",
      [plan],
    );
    expect(p).toEqual({ status: "partially_approved", applied_by: organizer });
    const [a] = await db.sql<{ status: string; result: { applied: number; skipped: number } }>(
      "select status, result from public.approvals where id = $1",
      [approval],
    );
    expect(a).toMatchObject({ status: "executed", result: { applied: 3, skipped: 2 } });
    const audit = await db.sql("select 1 from public.audit_log where entity_id = $1", [plan]);
    expect(audit.length).toBeGreaterThan(0);
  });

  it("executes exactly once, and an applied plan cannot be selected or approved again", async () => {
    const [a] = await db.sql<{ id: string }>(
      "select id from public.approvals where action_type = 'apply_recovery'",
    );
    expect(
      await db.user(organizer).error("select public.execute_recovery_approval($1)", [a.id]),
    ).toMatch(/already_executed/);
    expect(
      await db.user(organizer).error("select public.set_recovery_selection($1, '{}')", [plan]),
    ).toMatch(/invalid_transition/);
    expect(
      await db
        .user(organizer)
        .error("select public.request_approval('apply_recovery', $1)", [plan]),
    ).toMatch(/invalid_transition/);
    const [{ n }] = await db.sql<{ n: string }>(
      "select count(*) as n from public.tasks where title = 'Visit replacement venue'",
    );
    expect(Number(n)).toBe(1);
  });

  it("the incident cannot be resolved without a note, and only after a plan was applied", async () => {
    expect(
      await db
        .user(organizer)
        .error("select public.close_incident($1, 'resolved', 'ok')", [incident]),
    ).toMatch(/reason_required/);
    await db
      .user(organizer)
      .query("select public.close_incident($1, 'resolved', 'Moved to a new hall.')", [incident]);
    const [i] = await db.sql<{ status: string; closed_by: string }>(
      "select status, closed_by from public.incidents where id = $1",
      [incident],
    );
    expect(i).toEqual({ status: "resolved", closed_by: organizer });
    expect(
      await db
        .user(organizer)
        .error("select public.close_incident($1, 'dismissed', 'Changed my mind')", [incident]),
    ).toMatch(/invalid_transition/);
  });
});

describe("approvals are tied to the exact reviewed content", () => {
  let incident: string;
  let plan: string;
  let changeId: string;

  beforeAll(async () => {
    // A second event/booking so the first incident's history stays intact.
    const booking2 = await confirmedBooking(eventId, altVenue, altOwner, "venue");
    const r = await db
      .user(organizer)
      .query<{ r: { id: string } }>(
        "select public.simulate_venue_cancellation($1, $2, 'second-key-001', null) as r",
        [eventId, booking2],
      );
    incident = r[0].r.id;
    const run = await aiRun(organizer);
    plan = await savePlan(organizer, incident, run, [
      {
        kind: "reschedule_task",
        entity_type: "task",
        entity_id: task.walk,
        payload: { due_date: day(45) },
      },
    ]);
    [{ id: changeId }] = await db.sql<{ id: string }>(
      "select id from public.recovery_changes where plan_id = $1",
      [plan],
    );
  });

  it("a task that changes after approval supersedes the approval; nothing is applied", async () => {
    const approval = await requestApproval(organizer, "apply_recovery", plan);
    await decide(organizer, approval);
    await db.sql("update public.tasks set due_date = due_date + 3 where id = $1", [task.walk]);
    const [{ r }] = await db
      .user(organizer)
      .query<{ r: string }>("select public.execute_recovery_approval($1) as r", [approval]);
    expect(r).toBe("superseded");
    const [{ d }] = await db.sql<{ d: string }>(
      "select to_char(due_date, 'YYYY-MM-DD') as d from public.tasks where id = $1",
      [task.walk],
    );
    expect(d).not.toBe(day(45));
    const [p] = await db.sql<{ status: string }>(
      "select status from public.recovery_plans where id = $1",
      [plan],
    );
    expect(p.status).toBe("proposed");
  });

  it("changing the selection supersedes an open approval; a rejected approval applies nothing", async () => {
    await db.sql("update public.tasks set due_date = due_date - 3 where id = $1", [task.walk]);
    const approval = await requestApproval(organizer, "apply_recovery", plan);
    await db
      .user(organizer)
      .query("select public.set_recovery_selection($1, $2)", [plan, [changeId]]);
    const [a] = await db.sql<{ status: string; failure_reason: string }>(
      "select status, failure_reason from public.approvals where id = $1",
      [approval],
    );
    expect(a).toEqual({ status: "superseded", failure_reason: "selection_changed" });
    expect(
      await db.user(organizer).error("select public.execute_recovery_approval($1)", [approval]),
    ).toMatch(/not_approved/);

    const second = await requestApproval(organizer, "apply_recovery", plan);
    expect(await decide(organizer, second, false)).toBe("rejected");
    expect(
      await db.user(organizer).error("select public.execute_recovery_approval($1)", [second]),
    ).toMatch(/not_approved/);
  });

  it("an approval cannot be executed before it is decided", async () => {
    const approval = await requestApproval(organizer, "apply_recovery", plan);
    expect(
      await db.user(organizer).error("select public.execute_recovery_approval($1)", [approval]),
    ).toMatch(/not_approved/);
  });

  it("a proposal that is rejected withdraws its drafts and open approvals", async () => {
    await db
      .user(organizer)
      .query("select public.reject_recovery_plan($1, 'Not workable at all')", [plan]);
    const [p] = await db.sql<{ status: string }>(
      "select status from public.recovery_plans where id = $1",
      [plan],
    );
    expect(p.status).toBe("rejected");
    const open = await db.sql(
      "select 1 from public.approvals where target_id = $1 and status in ('pending','approved')",
      [plan],
    );
    expect(open).toHaveLength(0);
    const [c] = await db.sql<{ status: string }>(
      "select status from public.communications where recovery_plan_id = $1",
      [plan],
    );
    expect(c.status).toBe("cancelled");
    const [i] = await db.sql<{ status: string }>(
      "select status from public.incidents where id = $1",
      [incident],
    );
    expect(i.status).toBe("assessing");
  });

  it("a rejected plan cannot be approved", async () => {
    expect(
      await db
        .user(organizer)
        .error("select public.request_approval('apply_recovery', $1)", [plan]),
    ).toMatch(/invalid_transition/);
  });
});

describe("provider inquiries and attendee updates", () => {
  let plan: string;
  let inquiry: string;
  let comm: string;

  beforeAll(async () => {
    const [i] = await db.sql<{ id: string }>(
      "select id from public.incidents where status = 'assessing'",
    );
    const run = await aiRun(organizer);
    plan = await savePlan(
      organizer,
      i.id,
      run,
      [
        {
          kind: "flag_review",
          entity_type: "booking",
          entity_id: catererBooking,
          payload: { action: "reconfirm", reason: "Check the address." },
        },
      ],
      [
        {
          provider_id: catererProvider,
          booking_id: catererBooking,
          purpose: "service_reconfirmation",
          subject: "Please reconfirm",
          body: "Please reconfirm your booking once the venue is known.",
        },
      ],
    );
    [{ id: inquiry }] = await db.sql<{ id: string }>(
      "select id from public.recovery_inquiries where plan_id = $1",
      [plan],
    );
    [{ id: comm }] = await db.sql<{ id: string }>(
      "select id from public.communications where recovery_plan_id = $1",
      [plan],
    );
  });

  it("an inquiry is only 'sent' (as simulated) after approval, and the provider is not notified", async () => {
    const approval = await requestApproval(organizer, "send_provider_inquiry", inquiry);
    expect(
      (
        await db.sql<{ status: string }>(
          "select status from public.recovery_inquiries where id = $1",
          [inquiry],
        )
      )[0].status,
    ).toBe("awaiting_approval");
    expect(
      await db.user(organizer).error("select public.execute_inquiry_approval($1)", [approval]),
    ).toMatch(/not_approved/);
    await decide(coOrganizer, approval);
    const [{ r }] = await db
      .user(organizer)
      .query<{ r: string }>("select public.execute_inquiry_approval($1) as r", [approval]);
    expect(r).toBe("executed");
    const [q] = await db.sql<{ status: string; sent_at: string }>(
      "select status, sent_at from public.recovery_inquiries where id = $1",
      [inquiry],
    );
    expect(q.status).toBe("sent_simulated");
    expect(q.sent_at).toBeTruthy();
    const [a] = await db.sql<{ result: { contacted: boolean } }>(
      "select result from public.approvals where id = $1",
      [approval],
    );
    expect(a.result.contacted).toBe(false);
    const notes = await db
      .user(catererOwner)
      .query(
        "select 1 from public.notifications where title ilike '%inquiry%' or title ilike '%reconfirm%'",
      );
    expect(notes).toHaveLength(0);
    expect(
      await db.user(organizer).error("select public.execute_inquiry_approval($1)", [approval]),
    ).toMatch(/already_executed/);
  });

  it("editing an inquiry after approval withdraws the approval", async () => {
    const [i2] = await db.sql<{ id: string }>(
      "select id from public.recovery_inquiries where plan_id = $1",
      [plan],
    );
    expect(
      await db
        .user(organizer)
        .error(
          "select public.update_recovery_inquiry($1, 'New subject', 'A new body that is long enough.')",
          [i2.id],
        ),
    ).toMatch(/invalid_transition/); // already sent
  });

  it("the attendee update goes through the normal send approval and can only use the mock transport", async () => {
    const approval = await requestApproval(organizer, "send_communication", comm);
    await decide(organizer, approval);
    const [{ r }] = await db
      .user(organizer)
      .query<{ r: { status: string } }>("select public.claim_approval($1) as r", [approval]);
    expect(r.status).toBe("executing");
    const results = [{ status: "accepted", provider_message_id: "x" }];
    const recipients = await db
      .sql<{ attendee_id: string }>("select attendee_id from public.communication_recipients($1)", [
        comm,
      ])
      .catch(() => []);
    void recipients;
    const [{ payload }] = await db.sql<{ payload: { recipients: { attendee_id: string }[] } }>(
      "select payload from public.approvals where id = $1",
      [approval],
    );
    const real = payload.recipients.map((x) => ({ ...results[0], attendee_id: x.attendee_id }));
    expect(
      await db
        .user(organizer)
        .error("select public.finish_communication($1, 'resend', $2::jsonb)", [
          approval,
          JSON.stringify(real),
        ]),
    ).toMatch(/simulated_only/);
    const simulated = payload.recipients.map((x) => ({
      status: "simulated",
      attendee_id: x.attendee_id,
    }));
    const [{ s }] = await db
      .user(organizer)
      .query<{ s: string }>("select public.finish_communication($1, 'mock', $2::jsonb) as s", [
        approval,
        JSON.stringify(simulated),
      ]);
    expect(s).toBe("sent");
  });
});

describe("one active recovery per booking", () => {
  it("a closed incident lets the booking be simulated again; an active one blocks it", async () => {
    const list = await db
      .user(organizer)
      .query<{ booking_id: string }>(
        "select booking_id from public.simulatable_venue_bookings($1)",
        [eventId],
      );
    expect(list.map((b) => b.booking_id)).toContain(venueBooking); // the first incident is resolved
    const r = await simulate(organizer, venueBooking, "third-key-0001");
    expect(r.created).toBe(true);
    const again = await simulate(organizer, venueBooking, "fourth-key-001");
    expect(again).toEqual({ id: r.id, created: false });
    const after = await db
      .user(organizer)
      .query<{ booking_id: string }>(
        "select booking_id from public.simulatable_venue_bookings($1)",
        [eventId],
      );
    expect(after.map((b) => b.booking_id)).not.toContain(venueBooking);
  });
});
