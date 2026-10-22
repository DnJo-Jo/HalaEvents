import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";

// Post-event reviews (migration 20261022000009). PGlite with the real migrations: a local approach,
// not a live Supabase project.

let db: TestDb;
let admin: string;
let organizer: string;
let coOrganizer: string;
let viewer: string;
let outsider: string;
let otherOrganizer: string;
let venueOwner: string;
let venueStaff: string;
let otherProviderOwner: string;
let venue: string;
let otherProvider: string;
let eventA: string;
let eventB: string;
let bookingA: string; // completed
let bookingB: string; // completed (second event, same provider)
let bookingOpen: string; // confirmed, not completed
let bookingOther: string; // completed, another provider
const reviews: Record<string, string> = {};

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
const past = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

async function createProvider(owner: string, name: string) {
  const [{ id }] = await db
    .user(owner)
    .query<{ id: string }>(
      "select public.create_provider('venue', 'venue', $1, 'desc', 'Dubai', '{Dubai}', 10, 500, 50, 150, 'AED', 'ops@example.test') as id",
      [name],
    );
  await db.user(owner).query("select public.submit_provider_for_verification($1)", [id]);
  await db.user(admin).query("select public.set_provider_verification($1, 'verified', null)", [id]);
  return id;
}
async function createEvent(name: string) {
  const [{ id }] = await db
    .user(organizer)
    .query<{ id: string }>(
      "insert into public.events (owner_id, name, starts_at, ends_at, capacity, city) values ($1, $2, $3, $4, 100, 'Dubai') returning id",
      [organizer, name, future(30), future(31)],
    );
  return id;
}
async function booking(event: string, provider: string, owner: string, complete: boolean) {
  const [{ id: requestId }] = await db
    .user(organizer)
    .query<{ id: string }>(
      `select public.create_service_request($1, 'venue', 'Need it', 'Requirements for the hackathon event.', $2, $3, 100, 20000, 'AED', null, $4) as id`,
      [event, future(30), future(31), [provider]],
    );
  const [{ id: quoteId }] = await db
    .user(owner)
    .query<{ id: string }>(
      "select public.save_quote($1, $2, 9000, 'AED', 'Hall', null, 'Deposit', $3, true) as id",
      [requestId, provider, future(14)],
    );
  const [{ id }] = await db
    .user(organizer)
    .query<{ id: string }>("select public.propose_booking($1, null) as id", [quoteId]);
  const [{ id: approval }] = await db
    .user(organizer)
    .query<{ id: string }>("select public.request_booking_approval($1) as id", [id]);
  await db.user(organizer).query("select public.decide_approval($1, true, null)", [approval]);
  await db.user(organizer).query("select public.execute_booking_approval($1)", [approval]);
  await db.user(owner).query("select public.provider_booking_action($1, 'confirmed', null)", [id]);
  if (complete) {
    // The service period is over (fixture), then the organizer marks it completed.
    await db.sql("update public.bookings set service_from = $2, service_to = $3 where id = $1", [
      id,
      past(3),
      past(2),
    ]);
    await db
      .user(organizer)
      .query("select public.organizer_booking_action($1, 'completed', null)", [id]);
  }
  return id;
}

const review = (
  who: string,
  b: string,
  direction: string,
  rating = 5,
  body = "Great venue, smooth day.",
) =>
  db
    .user(who)
    .query<{ id: string }>("select public.create_review($1, $2, $3, $4) as id", [
      b,
      direction,
      rating,
      body,
    ])
    .then((r) => r[0].id);
const tryReview = (
  who: string,
  b: string,
  direction: string,
  rating = 4,
  body = "Solid and professional.",
) =>
  db.user(who).error("select public.create_review($1, $2, $3, $4)", [b, direction, rating, body]);
const summary = (who: string, provider: string) =>
  db
    .user(who)
    .query<{ review_count: number; average: string | null; stars_5: number; stars_1: number }>(
      "select * from public.provider_rating_summary($1)",
      [provider],
    );
const list = (who: string, provider: string) =>
  db.user(who).query<{
    id: string;
    rating: number;
    reviewer_name: string;
    response_body: string | null;
    verified: boolean;
  }>("select * from public.provider_reviews($1)", [provider]);

beforeAll(async () => {
  db = await TestDb.create();
  admin = await db.createMember("admin@example.test", ["organizer"]);
  await db.makeAdmin(admin);
  organizer = await db.createMember("org@example.test", ["organizer"]);
  coOrganizer = await db.createMember("co@example.test", ["organizer"]);
  viewer = await db.createMember("viewer@example.test", ["organizer"]);
  outsider = await db.createMember("outsider@example.test", ["organizer"]);
  otherOrganizer = await db.createMember("other-org@example.test", ["organizer"]);
  venueOwner = await db.createMember("venue@example.test", ["venue_provider"]);
  venueStaff = await db.createMember("staff@example.test", ["venue_provider"]);
  otherProviderOwner = await db.createMember("other-prov@example.test", ["venue_provider"]);
  venue = await createProvider(venueOwner, "Review Hall");
  otherProvider = await createProvider(otherProviderOwner, "Other Hall");
  await db.sql(
    "insert into public.provider_members (provider_id, user_id, role) values ($1, $2, 'staff')",
    [venue, venueStaff],
  );
  eventA = await createEvent("Review Hack A");
  eventB = await createEvent("Review Hack B");
  await db
    .user(organizer)
    .query(
      "insert into public.event_members (event_id, user_id, role) values ($1, $2, 'organizer'), ($1, $3, 'viewer')",
      [eventA, coOrganizer, viewer],
    );
  bookingA = await booking(eventA, venue, venueOwner, true);
  bookingB = await booking(eventB, venue, venueOwner, true);
  bookingOpen = await booking(await createEvent("Review Hack C"), venue, venueOwner, false);
  bookingOther = await booking(
    await createEvent("Review Hack D"),
    otherProvider,
    otherProviderOwner,
    true,
  );
}, 90_000);
afterAll(() => db.close());

describe("eligibility", () => {
  it("only a completed booking can be reviewed", async () => {
    expect(await tryReview(organizer, bookingOpen, "organizer_to_provider")).toMatch(
      /not_eligible/,
    );
    const [{ r }] = await db
      .user(organizer)
      .query<{ r: string | null }>("select public.review_check($1, 'organizer_to_provider') as r", [
        bookingOpen,
      ])
      .catch(() => [{ r: "no-grant" }]);
    expect(r).toBe("no-grant"); // the check function itself is not callable by clients
  });

  it("only owners and organizers of the booking's event; never viewers, outsiders or other events' organizers", async () => {
    for (const who of [viewer, outsider, otherOrganizer, venueOwner]) {
      expect(await tryReview(who, bookingA, "organizer_to_provider")).toMatch(/forbidden/);
    }
    expect(
      await db.anon.error(
        "select public.create_review($1, 'organizer_to_provider', 5, 'Great venue, smooth day.')",
        [bookingA],
      ),
    ).toMatch(/permission denied/);
  });

  it("a suspended account can't review", async () => {
    await db.sql("update public.profiles set account_status = 'suspended' where user_id = $1", [
      coOrganizer,
    ]);
    expect(await tryReview(coOrganizer, bookingA, "organizer_to_provider")).toMatch(/forbidden/);
    await db.sql("update public.profiles set account_status = 'active' where user_id = $1", [
      coOrganizer,
    ]);
  });

  it("an unknown booking or direction is not found", async () => {
    expect(
      await tryReview(organizer, "00000000-0000-4000-8000-000000000000", "organizer_to_provider"),
    ).toMatch(/not_found/);
    expect(await tryReview(organizer, bookingA, "sideways")).toMatch(/not_found/);
  });

  it("you can't be on both sides of the booking", async () => {
    // An organizer who is also a member of the provider.
    await db.sql(
      "insert into public.provider_members (provider_id, user_id, role) values ($1, $2, 'staff')",
      [venue, coOrganizer],
    );
    expect(await tryReview(coOrganizer, bookingA, "organizer_to_provider")).toMatch(
      /conflict_of_interest/,
    );
    await db.sql("delete from public.provider_members where provider_id = $1 and user_id = $2", [
      venue,
      coOrganizer,
    ]);
  });

  it("the verified indicator cannot be claimed: clients can't write reviews directly", async () => {
    expect(
      await db
        .user(organizer)
        .error(
          "insert into public.reviews (booking_id, event_id, provider_id, direction, rating, body) values ($1, $2, $3, 'organizer_to_provider', 5, 'Fabricated review text')",
          [bookingOpen, eventA, venue],
        ),
    ).toMatch(/permission denied/);
    expect(await db.user(organizer).error("update public.reviews set rating = 5")).toMatch(
      /permission denied/,
    );
  });
});

describe("submitting and duplicates", () => {
  it("validates rating and text", async () => {
    expect(await tryReview(organizer, bookingA, "organizer_to_provider", 0)).toMatch(
      /invalid_rating/,
    );
    expect(await tryReview(organizer, bookingA, "organizer_to_provider", 6)).toMatch(
      /invalid_rating/,
    );
    expect(await tryReview(organizer, bookingA, "organizer_to_provider", 5, "short")).toMatch(
      /violates check constraint|reviews_body_check/,
    );
  });

  it("an organizer reviews the provider once; the team can't add a second", async () => {
    reviews.a = await review(
      organizer,
      bookingA,
      "organizer_to_provider",
      5,
      "Great venue, smooth day.",
    );
    expect(await tryReview(organizer, bookingA, "organizer_to_provider")).toMatch(
      /duplicate_review/,
    );
    expect(await tryReview(coOrganizer, bookingA, "organizer_to_provider")).toMatch(
      /duplicate_review/,
    );
    const rows = await db.sql<{ n: string }>(
      "select count(*) as n from public.reviews where booking_id = $1",
      [bookingA],
    );
    expect(Number(rows[0].n)).toBe(1);
  });

  it("a second booking can be reviewed separately", async () => {
    reviews.b = await review(
      organizer,
      bookingB,
      "organizer_to_provider",
      4,
      "Good space, some delays.",
    );
    const [b] = await db.sql<{ rating: number; status: string; reviewer_user_id: string }>(
      "select rating, status, reviewer_user_id from public.reviews where id = $1",
      [reviews.b],
    );
    expect(b).toEqual({ rating: 4, status: "published", reviewer_user_id: organizer });
  });

  it("the database also forbids duplicates at the table level", async () => {
    await expect(
      db.pg.query(
        "insert into public.reviews (booking_id, event_id, provider_id, direction, rating, body) values ($1, $2, $3, 'organizer_to_provider', 3, 'Another attempt at it')",
        [bookingA, eventA, venue],
      ),
    ).rejects.toThrow(/duplicate key|reviews_booking_id_direction_key/);
  });

  it("an audit entry exists", async () => {
    const rows = await db.sql(
      "select 1 from public.audit_log where entity_type = 'reviews' and entity_id = $1",
      [reviews.a],
    );
    expect(rows.length).toBe(1);
  });
});

describe("provider reviews of organizers follow platform policy", () => {
  it("are off by default; only an administrator can switch them on", async () => {
    expect(await tryReview(venueOwner, bookingA, "provider_to_organizer")).toMatch(/not_eligible/);
    expect(
      await db
        .user(organizer)
        .error("select public.set_platform_setting('provider_reviews_of_organizers', true)"),
    ).toMatch(/forbidden/);
    expect(
      await db
        .user(venueOwner)
        .error("select public.set_platform_setting('provider_reviews_of_organizers', true)"),
    ).toMatch(/forbidden/);
    expect(
      await db.user(admin).error("select public.set_platform_setting('nonsense', true)"),
    ).toBeTruthy();
    const audit = await db.sql(
      "select 1 from public.audit_log where entity_type = 'platform_settings'",
    );
    expect(audit).toHaveLength(0);
  });

  it("once enabled, only a member of the booked provider may review, and only a completed booking", async () => {
    await db
      .user(admin)
      .query("select public.set_platform_setting('provider_reviews_of_organizers', true)");
    expect(
      (await db.sql("select 1 from public.audit_log where entity_type = 'platform_settings'"))
        .length,
    ).toBe(1);
    expect(await tryReview(venueOwner, bookingOpen, "provider_to_organizer")).toMatch(
      /not_eligible/,
    );
    expect(await tryReview(otherProviderOwner, bookingA, "provider_to_organizer")).toMatch(
      /forbidden/,
    );
    expect(await tryReview(outsider, bookingA, "provider_to_organizer")).toMatch(/forbidden/);
    expect(await tryReview(organizer, bookingA, "provider_to_organizer")).toMatch(/forbidden/);
    reviews.p = await review(
      venueStaff,
      bookingA,
      "provider_to_organizer",
      3,
      "Late payment but friendly team.",
    );
    expect(await tryReview(venueOwner, bookingA, "provider_to_organizer")).toMatch(
      /duplicate_review/,
    );
    const [r] = await db.sql<{ target_user_id: string; direction: string }>(
      "select target_user_id, direction from public.reviews where id = $1",
      [reviews.p],
    );
    expect(r).toEqual({ target_user_id: organizer, direction: "provider_to_organizer" });
  });

  it("a provider member who is also on the event's team has a conflict", async () => {
    await db.sql(
      "insert into public.event_members (event_id, user_id, role) values ($1, $2, 'viewer')",
      [eventB, venueOwner],
    );
    expect(await tryReview(venueOwner, bookingB, "provider_to_organizer")).toMatch(
      /conflict_of_interest/,
    );
    await db.sql("delete from public.event_members where event_id = $1 and user_id = $2", [
      eventB,
      venueOwner,
    ]);
  });

  it("the organizer's own rating is visible to the organizer, providers and admins only", async () => {
    const q = "select review_count, average from public.organizer_rating_summary($1)";
    expect(await db.user(organizer).query(q, [organizer])).toEqual([
      { review_count: 1, average: "3.00" },
    ]);
    expect(await db.user(venueOwner).query(q, [organizer])).toEqual([
      { review_count: 1, average: "3.00" },
    ]);
    expect(await db.user(admin).query(q, [organizer])).toHaveLength(1);
    expect(await db.user(outsider).query(q, [organizer])).toEqual([]);
    expect(
      await db.user(outsider).query("select * from public.organizer_reviews($1)", [organizer]),
    ).toEqual([]);
    const reviewsSeen = await db
      .user(otherProviderOwner)
      .query<{ provider_name: string; verified: boolean }>(
        "select * from public.organizer_reviews($1)",
        [organizer],
      );
    expect(reviewsSeen).toMatchObject([{ provider_name: "Review Hall", verified: true }]);
  });
});

describe("displayed averages come from persisted, eligible reviews", () => {
  it("a provider with no reviews has 0 reviews and no average", async () => {
    expect(await summary(outsider, otherProvider)).toEqual([
      {
        review_count: 0,
        average: null,
        stars_1: 0,
        stars_2: 0,
        stars_3: 0,
        stars_4: 0,
        stars_5: 0,
      },
    ]);
    expect(await list(outsider, otherProvider)).toEqual([]);
  });

  it("averages the published reviews of completed bookings", async () => {
    const [s] = await summary(outsider, venue);
    expect(s).toMatchObject({ review_count: 2, average: "4.50", stars_5: 1, stars_4: 1 });
    const rows = await list(outsider, venue);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.verified)).toBe(true);
    expect(rows.map((r) => r.reviewer_name)).toEqual(["org", "org"]);
  });

  it("provider-to-organizer reviews never count toward the provider's rating", async () => {
    const [s] = await summary(outsider, venue);
    expect(s.review_count).toBe(2);
  });

  it("a review of a booking that is no longer completed is excluded", async () => {
    await db.sql("update public.bookings set status = 'disputed' where id = $1", [bookingB]);
    expect((await summary(outsider, venue))[0]).toMatchObject({ review_count: 1, average: "5.00" });
    await db.sql("update public.bookings set status = 'completed' where id = $1", [bookingB]);
    expect((await summary(outsider, venue))[0]).toMatchObject({ review_count: 2, average: "4.50" });
  });

  it("a provider the public can't see has no summary for outsiders, but its own members do", async () => {
    await db.sql("update public.providers set is_listed = false where id = $1", [venue]);
    expect(await summary(outsider, venue)).toEqual([]);
    expect(await list(outsider, venue)).toEqual([]);
    expect((await summary(venueOwner, venue))[0].review_count).toBe(2);
    await db.sql("update public.providers set is_listed = true where id = $1", [venue]);
  });

  it("signed-out callers get nothing", async () => {
    expect(
      await db.anon.error("select * from public.provider_rating_summary($1)", [venue]),
    ).toMatch(/permission denied/);
  });
});

describe("responses, reports and disputes", () => {
  it("only the reviewed side responds, once", async () => {
    expect(
      await db
        .user(organizer)
        .error("select public.respond_to_review($1, 'Thanks for staying with us.')", [reviews.a]),
    ).toMatch(/forbidden/);
    expect(
      await db
        .user(outsider)
        .error("select public.respond_to_review($1, 'Thanks for staying with us.')", [reviews.a]),
    ).toMatch(/forbidden/);
    await db
      .user(venueStaff)
      .query("select public.respond_to_review($1, 'Thanks for staying with us.')", [reviews.a]);
    expect(
      await db
        .user(venueOwner)
        .error("select public.respond_to_review($1, 'A second response here.')", [reviews.a]),
    ).toMatch(/duplicate_response/);
    const rows = await list(outsider, venue);
    expect(rows.find((r) => r.id === reviews.a)?.response_body).toBe("Thanks for staying with us.");
    expect(rows.find((r) => r.id === reviews.b)?.response_body).toBeNull();
  });

  it("the reviewed organizer can respond to a provider's review of them", async () => {
    await db
      .user(coOrganizer)
      .query("select public.respond_to_review($1, 'We have fixed our payment process.')", [
        reviews.p,
      ]);
    expect(
      await db
        .user(venueOwner)
        .error("select public.respond_to_review($1, 'I should not respond to myself.')", [
          reviews.p,
        ]),
    ).toMatch(/forbidden|duplicate_response/);
  });

  it("anyone else can report a public review; reviewers can't report their own; duplicates are refused", async () => {
    expect(
      await db
        .user(organizer)
        .error("select public.report_review($1, 'report', 'spam', 'This looks like spam to me')", [
          reviews.a,
        ]),
    ).toMatch(/your own review/);
    const id = await db
      .user(outsider)
      .query<{ id: string }>(
        "select public.report_review($1, 'report', 'inaccurate', 'The review has wrong facts.') as id",
        [reviews.a],
      );
    expect(id[0].id).toBeTruthy();
    expect(
      await db
        .user(outsider)
        .error("select public.report_review($1, 'report', 'spam', 'Reporting the same thing')", [
          reviews.a,
        ]),
    ).toMatch(/duplicate_report/);
    expect(
      await db.anon.error(
        "select public.report_review($1, 'report', 'spam', 'Reporting anonymously')",
        [reviews.a],
      ),
    ).toMatch(/permission denied/);
  });

  it("only the reviewed party can dispute; a dispute is a separate record from a report", async () => {
    expect(
      await db
        .user(outsider)
        .error("select public.report_review($1, 'dispute', 'inaccurate', 'It is not about me')", [
          reviews.a,
        ]),
    ).toMatch(/only the reviewed party/);
    expect(
      await db
        .user(organizer)
        .error("select public.report_review($1, 'dispute', 'inaccurate', 'My own review')", [
          reviews.a,
        ]),
    ).toMatch(/forbidden/);
    await db
      .user(venueOwner)
      .query(
        "select public.report_review($1, 'dispute', 'inaccurate', 'The dates in this review are wrong.')",
        [reviews.a],
      );
    expect(
      await db
        .user(venueOwner)
        .error(
          "select public.report_review($1, 'dispute', 'abusive', 'Disputing the same review again')",
          [reviews.a],
        ),
    ).toMatch(/duplicate_report/);
    const kinds = await db.sql<{ kind: string }>(
      "select kind from public.review_reports where review_id = $1 order by kind",
      [reviews.a],
    );
    expect(kinds.map((k) => k.kind)).toEqual(["dispute", "report"]);
  });

  it("reporters see their own reports only; admins see all", async () => {
    expect((await db.user(outsider).query("select id from public.review_reports")).length).toBe(1);
    expect((await db.user(venueOwner).query("select id from public.review_reports")).length).toBe(
      1,
    );
    expect((await db.user(organizer).query("select id from public.review_reports")).length).toBe(0);
    expect((await db.user(admin).query("select id from public.review_reports")).length).toBe(2);
  });
});

describe("moderation", () => {
  it("only administrators moderate, and they must say why", async () => {
    for (const who of [organizer, venueOwner, outsider]) {
      expect(
        await db
          .user(who)
          .error("select public.moderate_review($1, 'hidden', 'No reason given here')", [
            reviews.b,
          ]),
      ).toMatch(/forbidden/);
    }
    expect(
      await db.user(admin).error("select public.moderate_review($1, 'hidden', 'no')", [reviews.b]),
    ).toMatch(/reason_required/);
    expect(
      await db
        .user(admin)
        .error("select public.moderate_review($1, 'deleted', 'Some valid reason')", [reviews.b]),
    ).toMatch(/invalid_transition/);
  });

  it("a hidden review leaves lists and averages but stays visible to its two sides and admins", async () => {
    await db
      .user(admin)
      .query("select public.moderate_review($1, 'hidden', 'Contains personal details')", [
        reviews.b,
      ]);
    expect((await summary(outsider, venue))[0]).toMatchObject({ review_count: 1, average: "5.00" });
    expect((await list(outsider, venue)).map((r) => r.id)).toEqual([reviews.a]);
    for (const who of [organizer, venueOwner, admin]) {
      const rows = await db
        .user(who)
        .query<{ status: string }>("select status from public.reviews where id = $1", [reviews.b]);
      expect(rows).toEqual([{ status: "hidden" }]);
    }
    expect(
      await db.user(outsider).query("select id from public.reviews where id = $1", [reviews.b]),
    ).toEqual([]);
    expect(
      await db
        .user(outsider)
        .error("select public.report_review($1, 'report', 'spam', 'Cannot see this review')", [
          reviews.b,
        ]),
    ).toMatch(/not_found/);
    const [m] = await db.sql<{ moderated_by: string; moderation_note: string }>(
      "select moderated_by, moderation_note from public.reviews where id = $1",
      [reviews.b],
    );
    expect(m).toEqual({ moderated_by: admin, moderation_note: "Contains personal details" });
  });

  it("restoring a review counts it again", async () => {
    await db
      .user(admin)
      .query("select public.moderate_review($1, 'published', 'Checked: no personal details')", [
        reviews.b,
      ]);
    expect((await summary(outsider, venue))[0]).toMatchObject({ review_count: 2, average: "4.50" });
  });

  it("the average is correct when every review is hidden", async () => {
    await db
      .user(admin)
      .query("select public.moderate_review($1, 'hidden', 'Hidden while we investigate')", [
        reviews.a,
      ]);
    await db
      .user(admin)
      .query("select public.moderate_review($1, 'hidden', 'Hidden while we investigate')", [
        reviews.b,
      ]);
    expect((await summary(outsider, venue))[0]).toMatchObject({ review_count: 0, average: null });
    await db
      .user(admin)
      .query("select public.moderate_review($1, 'published', 'Investigation finished')", [
        reviews.a,
      ]);
    await db
      .user(admin)
      .query("select public.moderate_review($1, 'published', 'Investigation finished')", [
        reviews.b,
      ]);
  });

  it("resolving a report: only admins, once; upholding can hide the review", async () => {
    const reports = await db.sql<{ id: string; kind: string }>(
      "select id, kind from public.review_reports where review_id = $1",
      [reviews.a],
    );
    const dispute = reports.find((r) => r.kind === "dispute")!;
    const report = reports.find((r) => r.kind === "report")!;
    expect(
      await db
        .user(venueOwner)
        .error("select public.resolve_review_report($1, 'upheld', 'I say it is wrong', true)", [
          dispute.id,
        ]),
    ).toMatch(/forbidden/);
    await db
      .user(admin)
      .query("select public.resolve_review_report($1, 'dismissed', 'Facts check out', false)", [
        report.id,
      ]);
    expect(
      (
        await db.sql<{ status: string }>("select status from public.reviews where id = $1", [
          reviews.a,
        ])
      )[0].status,
    ).toBe("published");
    expect(
      await db
        .user(admin)
        .error("select public.resolve_review_report($1, 'upheld', 'Resolving again', true)", [
          report.id,
        ]),
    ).toMatch(/invalid_transition/);
    await db
      .user(admin)
      .query("select public.resolve_review_report($1, 'upheld', 'Dates were indeed wrong', true)", [
        dispute.id,
      ]);
    const [r] = await db.sql<{ status: string }>(
      "select status from public.reviews where id = $1",
      [reviews.a],
    );
    expect(r.status).toBe("hidden");
    const [d] = await db.sql<{ status: string; resolved_by: string }>(
      "select status, resolved_by from public.review_reports where id = $1",
      [dispute.id],
    );
    expect(d).toEqual({ status: "upheld", resolved_by: admin });
    expect((await summary(outsider, venue))[0]).toMatchObject({ review_count: 1, average: "4.00" });
  });
});

describe("what each side can see", () => {
  it("the review candidate list shows eligibility, reasons and existing reviews per side", async () => {
    const mine = await db.user(organizer).query<{
      booking_id: string;
      side: string;
      eligible: boolean;
      reason: string | null;
      review_id: string | null;
    }>("select * from public.review_candidates()");
    const a = mine.find((c) => c.booking_id === bookingA && c.side === "organizer")!;
    expect(a).toMatchObject({ eligible: false, reason: "duplicate", review_id: reviews.a });
    expect(mine.find((c) => c.booking_id === bookingOpen)).toBeUndefined(); // not completed → not listed
    const prov = await db
      .user(venueStaff)
      .query<{ booking_id: string; side: string; eligible: boolean; reason: string | null }>(
        "select * from public.review_candidates()",
      );
    expect(prov.every((c) => c.side === "provider")).toBe(true);
    expect(prov.find((c) => c.booking_id === bookingB)).toMatchObject({
      eligible: true,
      reason: null,
    });
    expect(prov.find((c) => c.booking_id === bookingA)).toMatchObject({
      eligible: false,
      reason: "duplicate",
    });
    expect(await db.user(outsider).query("select * from public.review_candidates()")).toEqual([]);
  });

  it("reviews of bookings from another event/provider are not visible", async () => {
    expect(await db.user(otherProviderOwner).query("select id from public.reviews")).toEqual([]);
    expect(await db.user(otherOrganizer).query("select id from public.reviews")).toEqual([]);
    expect((await db.user(admin).query("select id from public.reviews")).length).toBe(3);
  });

  it("clients cannot write responses, reports or settings directly", async () => {
    expect(
      await db
        .user(venueOwner)
        .error(
          "insert into public.review_responses (review_id, body) values ($1, 'Direct insert here')",
          [reviews.b],
        ),
    ).toMatch(/permission denied/);
    expect(
      await db.user(outsider).error("update public.review_reports set status = 'upheld'"),
    ).toMatch(/permission denied/);
    expect(
      await db.user(admin).error("update public.platform_settings set enabled = true"),
    ).toMatch(/permission denied/);
  });

  it("completed other-provider booking can be reviewed by its organizer, not mixed with another provider's", async () => {
    const id = await review(
      organizer,
      bookingOther,
      "organizer_to_provider",
      2,
      "Not what we expected.",
    );
    expect((await summary(outsider, otherProvider))[0]).toMatchObject({
      review_count: 1,
      average: "2.00",
    });
    expect((await summary(outsider, venue))[0].review_count).toBe(1);
    expect(id).toBeTruthy();
  });
});

describe("my reviews", () => {
  it("lists reviews the caller is on either side of, with side, response and own reports", async () => {
    const mine = await db
      .user(organizer)
      .query<{ id: string; side: string; direction: string; my_report_kinds: string[] }>(
        "select id, side, direction, my_report_kinds from public.my_reviews()",
      );
    expect(mine.find((r) => r.id === reviews.a)).toMatchObject({
      side: "reviewer",
      direction: "organizer_to_provider",
    });
    expect(mine.find((r) => r.id === reviews.p)).toMatchObject({
      side: "reviewee",
      direction: "provider_to_organizer",
    });
    const prov = await db
      .user(venueStaff)
      .query<{ id: string; side: string; response_body: string | null; my_report_kinds: string[] }>(
        "select id, side, response_body, my_report_kinds from public.my_reviews()",
      );
    expect(prov.find((r) => r.id === reviews.a)).toMatchObject({
      side: "reviewee",
      response_body: "Thanks for staying with us.",
    });
    const owner = await db
      .user(venueOwner)
      .query<{ id: string; my_report_kinds: string[] }>(
        "select id, my_report_kinds from public.my_reviews()",
      );
    expect(owner.find((r) => r.id === reviews.a)?.my_report_kinds).toEqual(["dispute"]);
    expect(await db.user(outsider).query("select id from public.my_reviews()")).toEqual([]);
    expect(await db.anon.error("select id from public.my_reviews()")).toMatch(/permission denied/);
  });
});
