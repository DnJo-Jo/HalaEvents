import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";

let db: TestDb;
let organizer: string;
let viewer: string;
let venueOwner: string;
let catererOwner: string;
let otherProviderOwner: string;
let admin: string;
let venue: string;
let caterer: string;
let eventId: string;
let event2: string;

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

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
async function createEvent(name: string) {
  const [{ id }] = await db
    .user(organizer)
    .query<{ id: string }>(
      "insert into public.events (owner_id, name, starts_at, ends_at, capacity) values ($1, $2, $3, $4, 100) returning id",
      [organizer, name, future(30), future(31)],
    );
  return id;
}
async function requestAndQuote(
  event: string,
  provider: string,
  providerOwner: string,
  category: string,
  from = future(30),
  to = future(31),
) {
  const [{ id: requestId }] = await db
    .user(organizer)
    .query<{ id: string }>(
      `select public.create_service_request($1, $2, 'Need it', 'Requirements for the hackathon event.', $3, $4, 100, 20000, 'AED', null, $5) as id`,
      [event, category, from, to, [provider]],
    );
  const [{ id: quoteId }] = await db
    .user(providerOwner)
    .query<{ id: string }>(
      "select public.save_quote($1, $2, 9000, 'AED', 'Hall and chairs', null, 'Deposit 30%', $3, true) as id",
      [requestId, provider, future(14)],
    );
  return { requestId, quoteId };
}
const propose = (who: string, quote: string) =>
  db
    .user(who)
    .query<{ id: string }>("select public.propose_booking($1, 'Please hold the date') as id", [
      quote,
    ])
    .then((r) => r[0].id);
const bookingStatus = async (id: string) =>
  (await db.sql<{ status: string }>("select status from public.bookings where id = $1", [id]))[0]
    .status;
async function approveAndSend(bookingId: string) {
  const [{ id: approval }] = await db
    .user(organizer)
    .query<{ id: string }>("select public.request_booking_approval($1) as id", [bookingId]);
  await db.user(organizer).query("select public.decide_approval($1, true, null)", [approval]);
  const [{ r }] = await db
    .user(organizer)
    .query<{ r: string }>("select public.execute_booking_approval($1) as r", [approval]);
  return { approval, result: r };
}
const providerAction = (who: string, booking: string, to: string, reason: string | null = null) =>
  db.user(who).query("select public.provider_booking_action($1, $2, $3)", [booking, to, reason]);

beforeAll(async () => {
  db = await TestDb.create();
  organizer = await db.createMember("org@example.test", ["organizer"]);
  viewer = await db.createMember("viewer@example.test", ["organizer"]);
  venueOwner = await db.createMember("venue@example.test", ["venue_provider"]);
  catererOwner = await db.createMember("cater@example.test", ["service_provider"]);
  otherProviderOwner = await db.createMember("other@example.test", ["service_provider"]);
  admin = await db.createMember("admin@example.test", ["organizer"]);
  await db.makeAdmin(admin);
  venue = await createProvider(venueOwner, "venue", "venue", "Test Hall");
  caterer = await createProvider(catererOwner, "service", "catering", "Test Kitchen");
  await createProvider(otherProviderOwner, "service", "catering", "Other Kitchen");
  eventId = await createEvent("Booking Hack");
  event2 = await createEvent("Second Hack");
  await db
    .user(organizer)
    .query("insert into public.event_members (event_id, user_id, role) values ($1, $2, 'viewer')", [
      eventId,
      viewer,
    ]);
});
afterAll(() => db.close());

describe("from quote to confirmed booking", () => {
  let bookingId: string;
  let quoteId: string;

  it("a proposal snapshots the quote; nothing is booked yet", async () => {
    ({ quoteId } = await requestAndQuote(eventId, venue, venueOwner, "venue"));
    bookingId = await propose(organizer, quoteId);
    const [b] = await db.sql<{
      status: string;
      amount: string;
      provider_name: string;
      confirmed_by: string | null;
    }>("select status, amount, provider_name, confirmed_by from public.bookings where id = $1", [
      bookingId,
    ]);
    expect(b).toMatchObject({
      status: "proposed",
      amount: "9000.00",
      provider_name: "Test Hall",
      confirmed_by: null,
    });
    // The provider can't act on a proposal that hasn't been sent.
    expect(
      await db
        .user(venueOwner)
        .error("select public.provider_booking_action($1, 'confirmed', null)", [bookingId]),
    ).toMatch(/invalid_transition/);
  });

  it("one live booking per request; viewers can't propose", async () => {
    expect(
      await db.user(organizer).error("select public.propose_booking($1, null)", [quoteId]),
    ).toMatch(/booking_exists/);
    expect(
      await db.user(viewer).error("select public.propose_booking($1, null)", [quoteId]),
    ).toMatch(/forbidden/);
  });

  it("the request goes through approval; the provider sees it only once sent", async () => {
    const { result } = await approveAndSend(bookingId);
    expect(result).toBe("executed");
    expect(await bookingStatus(bookingId)).toBe("awaiting_provider");
    const notes = await db
      .user(venueOwner)
      .query<{ title: string }>("select title from public.notifications");
    expect(notes.some((n) => n.title.startsWith("Booking request"))).toBe(true);
  });

  it("only a member of the booked provider confirms; the organizer can't", async () => {
    expect(
      await db
        .user(organizer)
        .error("select public.provider_booking_action($1, 'confirmed', null)", [bookingId]),
    ).toMatch(/forbidden/);
    expect(
      await db
        .user(otherProviderOwner)
        .error("select public.provider_booking_action($1, 'confirmed', null)", [bookingId]),
    ).toMatch(/forbidden/);
    expect(
      await db
        .user(organizer)
        .error("select public.organizer_booking_action($1, 'confirmed', null)", [bookingId]),
    ).toMatch(/organizers can't set/);
    await providerAction(venueOwner, bookingId, "confirmed");
    const [b] = await db.sql<{ status: string; confirmed_by: string }>(
      "select status, confirmed_by from public.bookings where id = $1",
      [bookingId],
    );
    expect(b).toEqual({ status: "confirmed", confirmed_by: venueOwner });
    expect(
      await db.user(organizer).error("update public.bookings set status = 'completed'"),
    ).toMatch(/permission denied/);
  });

  it("cancelling a confirmed booking needs its own approval and a reason; completion only after the service period", async () => {
    expect(
      await db
        .user(organizer)
        .error("select public.organizer_booking_action($1, 'cancelled', 'Changed plans')", [
          bookingId,
        ]),
    ).toMatch(/approval_required/);
    expect(
      await db
        .user(organizer)
        .error("select public.organizer_booking_action($1, 'completed', null)", [bookingId]),
    ).toMatch(/not_finished/);
    expect(
      await db
        .user(organizer)
        .error("select public.request_approval('cancel_booking', $1)", [bookingId]),
    ).toMatch(/with a reason/);
    const [{ id: approval }] = await db
      .user(organizer)
      .query<{ id: string }>(
        "select public.request_booking_cancellation($1, 'Event moved online') as id",
        [bookingId],
      );
    await db
      .user(organizer)
      .query("select public.decide_approval($1, false, 'Keep it for now')", [approval]);
    expect(await bookingStatus(bookingId)).toBe("confirmed");
  });

  it("disputes are raised by either party and resolved only by a platform admin", async () => {
    expect(
      await db
        .user(venueOwner)
        .error("select public.provider_booking_action($1, 'disputed', 'no')", [bookingId]),
    ).toMatch(/reason_required/);
    await providerAction(venueOwner, bookingId, "disputed", "Organizer changed the layout");
    expect(
      await db
        .user(organizer)
        .error("select public.resolve_booking_dispute($1, 'confirmed', 'Settled between us')", [
          bookingId,
        ]),
    ).toMatch(/forbidden/);
    await db
      .user(admin)
      .query(
        "select public.resolve_booking_dispute($1, 'confirmed', 'Both parties agreed by email')",
        [bookingId],
      );
    expect(await bookingStatus(bookingId)).toBe("confirmed");
  });
});

describe("conflicts and changed payloads", () => {
  it("a venue can't confirm two overlapping bookings; a caterer can serve two events", async () => {
    const { quoteId } = await requestAndQuote(
      event2,
      venue,
      venueOwner,
      "venue",
      future(30.5),
      future(32),
    );
    const booking = await propose(organizer, quoteId);
    await approveAndSend(booking);
    expect(
      await db
        .user(venueOwner)
        .error("select public.provider_booking_action($1, 'confirmed', null)", [booking]),
    ).toMatch(/provider_conflict/);
    await providerAction(venueOwner, booking, "declined_by_provider", "Already booked that day");
    expect(await bookingStatus(booking)).toBe("declined_by_provider");

    const c1 = await requestAndQuote(eventId, caterer, catererOwner, "catering");
    const c2 = await requestAndQuote(event2, caterer, catererOwner, "catering");
    for (const q of [c1.quoteId, c2.quoteId]) {
      const b = await propose(organizer, q);
      await approveAndSend(b);
      await providerAction(catererOwner, b, "confirmed");
      expect(await bookingStatus(b)).toBe("confirmed");
    }
  });

  it("withdrawn or expired quotes can't be booked", async () => {
    const { requestId, quoteId } = await requestAndQuote(event2, caterer, catererOwner, "catering");
    await db.user(catererOwner).query("select public.withdraw_quote($1)", [quoteId]);
    expect(
      await db.user(organizer).error("select public.propose_booking($1, null)", [quoteId]),
    ).toMatch(/quote_not_bookable/);
    expect(requestId).toBeTruthy();
  });

  it("an approval whose booking changed since review is superseded, never executed", async () => {
    const { quoteId } = await requestAndQuote(eventId, caterer, catererOwner, "catering");
    const booking = await propose(organizer, quoteId);
    const [{ id: approval }] = await db
      .user(organizer)
      .query<{ id: string }>("select public.request_booking_approval($1) as id", [booking]);
    await db.user(organizer).query("select public.decide_approval($1, true, null)", [approval]);
    // Simulate a change to the reviewed terms (no API path allows this; the migration owner can).
    await db.sql("update public.bookings set amount = 1 where id = $1", [booking]);
    const [{ r }] = await db
      .user(organizer)
      .query<{ r: string }>("select public.execute_booking_approval($1) as r", [approval]);
    expect(r).toBe("superseded");
    expect(await bookingStatus(booking)).toBe("proposed");
    expect(await db.user(organizer).error("select public.claim_approval($1)", [approval])).toMatch(
      /execute_booking_approval/,
    );
  });
});

describe("visibility", () => {
  it("bookings are visible to the event's managers and the booked provider only", async () => {
    expect(
      (await db.user(organizer).query("select id from public.bookings")).length,
    ).toBeGreaterThan(0);
    expect(await db.user(viewer).query("select id from public.bookings")).toHaveLength(0);
    const theirs = await db.user(otherProviderOwner).query("select id from public.bookings");
    expect(theirs).toHaveLength(0);
    const venueRows = await db
      .user(venueOwner)
      .query<{ provider_id: string }>("select provider_id from public.bookings");
    expect(venueRows.every((r) => r.provider_id === venue)).toBe(true);
  });
});

describe("rules parity", () => {
  it("booking transitions in SQL match src/modules/bookings/booking-rules.ts for every (from, to, actor)", async () => {
    const { BOOKING_TRANSITIONS, BOOKING_ACTORS } =
      await import("@/modules/bookings/booking-rules");
    const states = Object.keys(BOOKING_TRANSITIONS) as (keyof typeof BOOKING_TRANSITIONS)[];
    for (const from of states)
      for (const to of states)
        for (const actor of BOOKING_ACTORS) {
          const [{ ok }] = await db.sql<{ ok: boolean }>(
            "select public.booking_transition_allowed($1, $2, $3) as ok",
            [from, to, actor],
          );
          expect(ok, `${from} -> ${to} (${actor})`).toBe(
            BOOKING_TRANSITIONS[from].some((t) => t.to === to && t.actor === actor),
          );
        }
  });
});
