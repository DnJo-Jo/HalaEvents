import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  QUOTE_TRANSITIONS,
  SERVICE_REQUEST_TRANSITIONS,
  canTransitionQuote,
  canTransitionRequest,
} from "@/modules/bookings/rules";
import { QuoteStatus, ServiceRequestStatus } from "@/modules/bookings/schemas";
import { TestDb } from "./harness";

// Marketplace: listings, visibility, shortlists, service requests, question threads, quotes.
// Runs on PGlite with the real migrations + seed (local test approach, not a live Supabase).

let db: TestDb;
let venueOwner: string; // owns provider A (venue)
let catererB: string; // owns provider B (catering)
let catererC: string; // owns provider C (catering)
let draftOwner: string; // owns provider D (never verified)
let organizer: string; // owns event E
let viewer: string; // viewer on event E
let outsider: string; // unrelated organizer
let admin: string;
let A: string, B: string, C: string, D: string;
let eventId: string;
let requestId: string;

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

async function createProvider(owner: string, kind: string, category: string, name: string) {
  const [{ id }] = await db
    .user(owner)
    .query<{ id: string }>(
      "select public.create_provider($1, $2, $3, 'desc', 'Dubai', '{Dubai}', 10, 500, 50, 150, 'AED', 'ops@example.test') as id",
      [kind, category, name],
    );
  return id;
}

async function verify(providerId: string, owner: string) {
  await db.user(owner).query(`select public.submit_provider_for_verification('${providerId}')`);
  await db
    .user(admin)
    .query(`select public.set_provider_verification('${providerId}', 'verified', null)`);
}

const createRequest = (who: string, providers: string[], extra: { respondBy?: string } = {}) =>
  db.user(who).query<{ id: string }>(
    `select public.create_service_request($1, 'catering', 'Hackathon meals', 'Meals for 120 people over 24 hours, halal.',
       $2, $3, 120, 15000, 'AED', $4, $5) as id`,
    [eventId, future(30), future(31), extra.respondBy ?? null, providers],
  );

const saveQuote = (
  who: string,
  provider: string,
  amount: number,
  submit: boolean,
  validUntil = future(14),
) =>
  db
    .user(who)
    .query<{ id: string }>(
      "select public.save_quote($1, $2, $3, 'AED', 'Four meals per person', 'Cutlery', '50% deposit', $4, $5) as id",
      [requestId, provider, amount, validUntil, submit],
    );

beforeAll(async () => {
  db = await TestDb.create({ seed: true });
  venueOwner = await db.createMember("venue@example.test", ["venue_provider"]);
  catererB = await db.createMember("b@example.test", ["service_provider"]);
  catererC = await db.createMember("c@example.test", ["service_provider"]);
  draftOwner = await db.createMember("d@example.test", ["service_provider"]);
  organizer = await db.createMember("org@example.test", ["organizer"]);
  viewer = await db.createMember("viewer@example.test", ["organizer"]);
  outsider = await db.createMember("outsider@example.test", ["organizer"]);
  admin = await db.createMember("admin@example.test", ["organizer"]);
  await db.makeAdmin(admin);

  A = await createProvider(venueOwner, "venue", "venue", "Test Hall A");
  B = await createProvider(catererB, "service", "catering", "Test Caterer B");
  C = await createProvider(catererC, "service", "catering", "Test Caterer C");
  D = await createProvider(draftOwner, "service", "catering", "Draft Caterer D");
  await verify(A, venueOwner);
  await verify(B, catererB);
  await verify(C, catererC);

  [{ id: eventId }] = await db.user(organizer).query<{ id: string }>(
    `insert into public.events (owner_id, name, starts_at, ends_at, capacity)
     values ($1, 'Campus Hackathon', $2, $3, 120) returning id`,
    [organizer, future(30), future(31)],
  );
  await db
    .user(organizer)
    .query("insert into public.event_members (event_id, user_id, role) values ($1, $2, 'viewer')", [
      eventId,
      viewer,
    ]);
});
afterAll(() => db.close());

describe("seeded demo data", () => {
  it("is clearly labelled, verified, and has no members (cannot receive requests)", async () => {
    const rows = await db.sql<{ name: string; is_demo: boolean; members: number }>(
      `select p.name, p.is_demo, (select count(*)::int from public.provider_members m where m.provider_id = p.id) as members
         from public.providers p where p.is_demo`,
    );
    expect(rows).toHaveLength(8);
    for (const r of rows) {
      expect(r.name.startsWith("Demo ")).toBe(true);
      expect(r.members).toBe(0);
    }
    const demoId = "d0000000-0000-4000-8000-000000000003";
    expect(await createRequest(organizer, [demoId]).catch((e) => (e as Error).message)).toMatch(
      /provider_not_available/,
    );
  });
});

describe("directory visibility and search", () => {
  const search = (who: string, args: string) =>
    db
      .user(who)
      .query<{ id: string; name: string }>(`select id, name from public.search_providers(${args})`);

  it("returns verified, listed, unmoderated providers only — never drafts", async () => {
    const ids = (await search(outsider, "")).map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining([A, B, C]));
    expect(ids).not.toContain(D);
    expect(
      await db.user(outsider).query("select id from public.providers where id = $1", [D]),
    ).toEqual([]);
  });

  it("filters by category (provider or service category), city, attendance and budget", async () => {
    const catering = (await search(outsider, "p_category => 'catering'")).map((r) => r.name);
    expect(catering).toEqual(
      expect.arrayContaining(["Test Caterer B", "Test Caterer C", "Demo Falcon Catering"]),
    );
    expect(catering).not.toContain("Test Hall A");

    const sharjah = (await search(outsider, "p_city => 'sharjah'")).map((r) => r.name);
    expect(sharjah).toContain("Demo Courtyard Pavilion");
    expect(sharjah).not.toContain("Test Hall A");

    const big = (await search(outsider, "p_attendance => 1000")).map((r) => r.name);
    expect(big).toContain("Demo Shield Event Security");
    expect(big).not.toContain("Demo Atrium Hall");

    const cheap = (await search(outsider, "p_budget => 40")).map((r) => r.name);
    expect(cheap).not.toContain("Test Caterer B"); // indicative minimum 50
    expect(cheap).toContain("Demo Pixel AV Rentals"); // price on request is not excluded
  });

  it("treats LIKE wildcards in the query as literal text", async () => {
    expect(await search(outsider, "p_query => '%'")).toEqual([]);
    expect((await search(outsider, "p_query => 'caterer b'")).map((r) => r.id)).toEqual([B]);
  });

  it("an owner pausing the listing or an admin hiding it removes it from the directory", async () => {
    await db
      .user(catererC)
      .query("update public.providers set is_listed = false where id = $1", [C]);
    expect((await search(outsider, "")).map((r) => r.id)).not.toContain(C);
    expect(
      await db.user(catererC).query("select id from public.providers where id = $1", [C]),
    ).toHaveLength(1);
    await db
      .user(catererC)
      .query("update public.providers set is_listed = true where id = $1", [C]);

    await db
      .user(admin)
      .query(`select public.set_provider_moderation('${C}', 'hidden', 'Duplicate listing check')`);
    expect((await search(outsider, "")).map((r) => r.id)).not.toContain(C);
    await db.user(admin).query(`select public.set_provider_moderation('${C}', 'active', null)`);
  });
});

describe("listings management", () => {
  it("owners manage their own services; others cannot", async () => {
    await db
      .user(catererB)
      .query(
        "insert into public.provider_services (provider_id, category, title, pricing_model, price_from, price_to) values ($1, 'catering', 'Buffet', 'per_person', 60, 90)",
        [B],
      );
    expect(
      await db
        .user(catererC)
        .error(
          "insert into public.provider_services (provider_id, category, title) values ($1, 'catering', 'Fake')",
          [B],
        ),
    ).toMatch(/row-level security/);
    await db
      .user(catererC)
      .query("update public.provider_services set title = 'Hijacked' where provider_id = $1", [B]);
    const titles = await db.sql<{ title: string }>(
      "select title from public.provider_services where provider_id = $1",
      [B],
    );
    expect(titles.map((t) => t.title)).toEqual(["Buffet"]);
  });

  it("'price on request' services cannot carry a price", async () => {
    expect(
      await db
        .user(catererB)
        .error(
          "insert into public.provider_services (provider_id, category, title, pricing_model, price_from) values ($1, 'catering', 'X', 'quote_only', 10)",
          [B],
        ),
    ).toMatch(/provider_services_quote_only_no_price/);
  });

  it("inactive services are visible to the owner only", async () => {
    await db
      .user(catererB)
      .query(
        "insert into public.provider_services (provider_id, category, title, is_active) values ($1, 'catering', 'Secret menu', false)",
        [B],
      );
    expect(
      await db
        .user(outsider)
        .query("select 1 from public.provider_services where title = 'Secret menu'"),
    ).toEqual([]);
    expect(
      await db
        .user(catererB)
        .query("select 1 from public.provider_services where title = 'Secret menu'"),
    ).toHaveLength(1);
  });

  it("venue details only exist for venues", async () => {
    await db
      .user(venueOwner)
      .query(
        "insert into public.venue_profiles (provider_id, setting, seated_capacity, accessibility, suitability) values ($1, 'indoor', 200, '{step_free}', '{hackathon}')",
        [A],
      );
    expect(
      await db
        .user(catererB)
        .error("insert into public.venue_profiles (provider_id) values ($1)", [B]),
    ).toMatch(/venue_profile_requires_venue/);
    expect(
      await db
        .user(venueOwner)
        .error(
          "update public.venue_profiles set accessibility = '{teleporter}' where provider_id = $1",
          [A],
        ),
    ).toMatch(/venue_profiles_accessibility_check/);
  });

  it("credentials are private to the provider and admins; edits reset the review", async () => {
    const [{ id: docId }] = await db
      .user(catererB)
      .query<{ id: string }>(
        "insert into public.provider_documents (provider_id, kind, title, reference_number) values ($1, 'food_safety', 'Food safety certificate', 'FS-123') returning id",
        [B],
      );
    expect(
      await db
        .user(organizer)
        .query("select * from public.provider_documents where provider_id = $1", [B]),
    ).toEqual([]);
    expect(
      await db
        .user(catererC)
        .query("select * from public.provider_documents where provider_id = $1", [B]),
    ).toEqual([]);
    expect(
      await db
        .user(catererB)
        .error("update public.provider_documents set review_status = 'accepted' where id = $1", [
          docId,
        ]),
    ).toMatch(/permission denied/);
    expect(
      await db
        .user(catererB)
        .error(`select public.review_provider_document('${docId}', 'accepted', null)`),
    ).toMatch(/forbidden/);

    await db
      .user(admin)
      .query(`select public.review_provider_document('${docId}', 'accepted', null)`);
    await db
      .user(catererB)
      .query("update public.provider_documents set reference_number = 'FS-999' where id = $1", [
        docId,
      ]);
    const [doc] = await db.sql<{ review_status: string; reviewed_by: string | null }>(
      "select review_status, reviewed_by from public.provider_documents where id = $1",
      [docId],
    );
    expect(doc).toEqual({ review_status: "submitted", reviewed_by: null });
  });
});

describe("shortlists", () => {
  it("event managers shortlist listed providers; viewers read; outsiders and unlisted providers are refused", async () => {
    await db
      .user(organizer)
      .query(
        "insert into public.event_shortlists (event_id, provider_id, note) values ($1, $2, 'Nice hall')",
        [eventId, A],
      );
    expect(
      await db
        .user(viewer)
        .query("select provider_id from public.event_shortlists where event_id = $1", [eventId]),
    ).toEqual([{ provider_id: A }]);
    expect(
      await db
        .user(viewer)
        .error("insert into public.event_shortlists (event_id, provider_id) values ($1, $2)", [
          eventId,
          B,
        ]),
    ).toMatch(/row-level security/);
    expect(
      await db
        .user(outsider)
        .error("insert into public.event_shortlists (event_id, provider_id) values ($1, $2)", [
          eventId,
          B,
        ]),
    ).toMatch(/row-level security/);
    expect(
      await db
        .user(organizer)
        .error("insert into public.event_shortlists (event_id, provider_id) values ($1, $2)", [
          eventId,
          D,
        ]),
    ).toMatch(/row-level security/);
    expect(
      await db
        .user(outsider)
        .query("select * from public.event_shortlists where event_id = $1", [eventId]),
    ).toEqual([]);
  });
});

describe("service requests", () => {
  it("only event owners/organizers can create them, for listed providers, within limits", async () => {
    expect(await createRequest(viewer, [B]).catch((e) => (e as Error).message)).toMatch(
      /forbidden/,
    );
    expect(await createRequest(outsider, [B]).catch((e) => (e as Error).message)).toMatch(
      /forbidden/,
    );
    expect(await createRequest(organizer, [D]).catch((e) => (e as Error).message)).toMatch(
      /provider_not_available/,
    );
    expect(await createRequest(organizer, []).catch((e) => (e as Error).message)).toMatch(
      /providers_required/,
    );
    expect(
      await createRequest(organizer, [B], {
        respondBy: new Date(Date.now() - 1000).toISOString(),
      }).catch((e) => (e as Error).message),
    ).toMatch(/respond_by_in_past/);
    expect(
      await db.anon.error(
        `select public.create_service_request('${eventId}', 'catering', 'x', 'y', now(), now(), 1, null, 'AED', null, '{}')`,
      ),
    ).toMatch(/permission denied/);

    [{ id: requestId }] = await createRequest(organizer, [B, C], { respondBy: future(7) });
    const [r] = await db.sql<{ status: string; created_by: string }>(
      "select status, created_by from public.service_requests where id = $1",
      [requestId],
    );
    expect(r).toEqual({ status: "open", created_by: organizer });
  });

  it("cannot be written directly", async () => {
    expect(
      await db
        .user(organizer)
        .error("update public.service_requests set status = 'closed' where id = $1", [requestId]),
    ).toMatch(/permission denied/);
    expect(
      await db
        .user(organizer)
        .error(
          "insert into public.service_request_invites (request_id, provider_id) values ($1, $2)",
          [requestId, A],
        ),
    ).toMatch(/permission denied/);
  });

  it("is visible to managers and invited providers only; providers see only their own invite", async () => {
    for (const who of [organizer, catererB, catererC]) {
      expect(
        await db
          .user(who)
          .query("select id from public.service_requests where id = $1", [requestId]),
        who,
      ).toHaveLength(1);
    }
    for (const who of [venueOwner, outsider, viewer, draftOwner]) {
      expect(
        await db
          .user(who)
          .query("select id from public.service_requests where id = $1", [requestId]),
        who,
      ).toEqual([]);
    }
    const invitesSeenByB = await db
      .user(catererB)
      .query<{ provider_id: string }>(
        "select provider_id from public.service_request_invites where request_id = $1",
        [requestId],
      );
    expect(invitesSeenByB.map((i) => i.provider_id)).toEqual([B]);
    const invitesSeenByOrganizer = await db
      .user(organizer)
      .query("select 1 from public.service_request_invites where request_id = $1", [requestId]);
    expect(invitesSeenByOrganizer).toHaveLength(2);
  });
});

describe("questions (per-provider threads)", () => {
  it("a provider asks, the organizer answers; other providers see nothing and cannot post", async () => {
    await db
      .user(catererB)
      .query(
        `select public.post_request_message('${requestId}', '${B}', 'provider', 'Any allergies?')`,
      );
    await db
      .user(organizer)
      .query(`select public.post_request_message('${requestId}', '${B}', 'organizer', 'Nuts.')`);
    expect(
      await db
        .user(catererC)
        .error(`select public.post_request_message('${requestId}', '${B}', 'provider', 'spy')`),
    ).toMatch(/forbidden/);
    expect(
      await db
        .user(catererC)
        .error(`select public.post_request_message('${requestId}', '${B}', 'organizer', 'spy')`),
    ).toMatch(/forbidden/);
    expect(
      await db
        .user(catererC)
        .query("select * from public.service_request_messages where request_id = $1", [requestId]),
    ).toEqual([]);
    expect(
      await db
        .user(viewer)
        .query("select * from public.service_request_messages where request_id = $1", [requestId]),
    ).toEqual([]);
    const thread = await db
      .user(catererB)
      .query<{ author_side: string; body: string }>(
        "select author_side, body from public.service_request_messages where request_id = $1 order by created_at",
        [requestId],
      );
    expect(thread).toEqual([
      { author_side: "provider", body: "Any allergies?" },
      { author_side: "organizer", body: "Nuts." },
    ]);
  });
});

describe("quotes", () => {
  it("drafts are private to the provider; submitted quotes reach the organizer only", async () => {
    await saveQuote(catererB, B, 14000, false);
    expect(
      await db
        .user(organizer)
        .query("select 1 from public.quotes where request_id = $1", [requestId]),
    ).toEqual([]);

    await saveQuote(catererB, B, 13500, true);
    const seen = await db
      .user(organizer)
      .query<{ amount: string; status: string; revision: number }>(
        "select amount::text, status, revision from public.quotes where request_id = $1",
        [requestId],
      );
    expect(seen).toEqual([{ amount: "13500.00", status: "submitted", revision: 1 }]);

    for (const who of [catererC, viewer, outsider, venueOwner]) {
      expect(
        await db.user(who).query("select 1 from public.quotes where provider_id = $1", [B]),
        who,
      ).toEqual([]);
    }
  });

  it("each provider sees only its own quote even when both quoted", async () => {
    await saveQuote(catererC, C, 12000, true);
    expect(
      (
        await db
          .user(catererC)
          .query<{ provider_id: string }>("select provider_id from public.quotes")
      ).map((q) => q.provider_id),
    ).toEqual([C]);
    expect(
      await db
        .user(organizer)
        .query("select 1 from public.quotes where request_id = $1", [requestId]),
    ).toHaveLength(2);
  });

  it("revisions bump the revision counter", async () => {
    await saveQuote(catererB, B, 13000, true);
    const [q] = await db.sql<{ revision: number; amount: string }>(
      "select revision, amount::text from public.quotes where provider_id = $1",
      [B],
    );
    expect(q).toEqual({ revision: 2, amount: "13000.00" });
  });

  it("rejects quotes from non-members, for past validity, and direct table writes", async () => {
    expect(await saveQuote(catererC, B, 1, true).catch((e) => (e as Error).message)).toMatch(
      /forbidden/,
    );
    expect(await saveQuote(organizer, B, 1, true).catch((e) => (e as Error).message)).toMatch(
      /forbidden/,
    );
    expect(
      await saveQuote(catererB, B, 1, true, new Date(Date.now() - 60_000).toISOString()).catch(
        (e) => (e as Error).message,
      ),
    ).toMatch(/valid_until_in_past/);
    expect(
      await db
        .user(catererB)
        .error("update public.quotes set amount = 1 where provider_id = $1", [B]),
    ).toMatch(/permission denied/);
    expect(
      await db
        .user(organizer)
        .error("update public.quotes set status = 'declined' where provider_id = $1", [B]),
    ).toMatch(/permission denied/);
  });

  it("enforces transitions: withdraw, resubmit, decline, and nothing after decline", async () => {
    const [{ id: quoteB }] = await db.sql<{ id: string }>(
      "select id from public.quotes where provider_id = $1",
      [B],
    );
    await db.user(catererB).query(`select public.withdraw_quote('${quoteB}')`);
    expect(
      await db.user(organizer).error(`select public.decline_quote('${quoteB}', null)`),
    ).toMatch(/invalid_transition: withdrawn -> declined/);
    expect(await db.user(catererB).error(`select public.withdraw_quote('${quoteB}')`)).toMatch(
      /invalid_transition/,
    );
    await saveQuote(catererB, B, 12500, true);
    expect(await db.user(catererC).error(`select public.decline_quote('${quoteB}', null)`)).toMatch(
      /not_found/,
    );
    expect(await db.user(viewer).error(`select public.decline_quote('${quoteB}', null)`)).toMatch(
      /not_found/,
    );
    await db.user(organizer).query(`select public.decline_quote('${quoteB}', 'Over budget')`);
    expect(await saveQuote(catererB, B, 11000, true).catch((e) => (e as Error).message)).toMatch(
      /invalid_transition: declined -> submitted/,
    );
  });

  it("a provider with a live quote must withdraw before declining the request; declined providers cannot quote", async () => {
    expect(
      await db
        .user(catererC)
        .error(`select public.decline_service_request('${requestId}', '${C}', 'busy')`),
    ).toMatch(/withdraw_quote_first/);
    const [{ id: quoteC }] = await db.sql<{ id: string }>(
      "select id from public.quotes where provider_id = $1",
      [C],
    );
    await db.user(catererC).query(`select public.withdraw_quote('${quoteC}')`);
    await db
      .user(catererC)
      .query(
        `select public.decline_service_request('${requestId}', '${C}', 'Fully booked that weekend')`,
      );
    expect(await saveQuote(catererC, C, 9000, true).catch((e) => (e as Error).message)).toMatch(
      /request_declined/,
    );
    expect(
      await db
        .user(catererC)
        .error(`select public.decline_service_request('${requestId}', '${C}', 'again')`),
    ).toMatch(/invalid_transition/);
  });

  it("database quote transitions match QUOTE_TRANSITIONS for every pair and actor", async () => {
    const statuses = QuoteStatus.options;
    for (const actor of ["provider", "organizer"] as const) {
      for (const from of statuses) {
        for (const to of statuses) {
          const [{ ok }] = await db.sql<{ ok: boolean }>(
            "select public.quote_transition_allowed($1, $2, $3) as ok",
            [from, to, actor],
          );
          expect(ok, `${actor}: ${from} -> ${to}`).toBe(canTransitionQuote(from, to, actor));
        }
      }
      expect(Object.keys(QUOTE_TRANSITIONS[actor]).sort()).toEqual([...statuses].sort());
    }
  });
});

describe("request lifecycle", () => {
  it("closing stops new quotes; invalid transitions are rejected; only managers change status", async () => {
    expect(
      await db
        .user(catererB)
        .error(`select public.set_service_request_status('${requestId}', 'closed')`),
    ).toMatch(/forbidden/);
    expect(
      await db
        .user(viewer)
        .error(`select public.set_service_request_status('${requestId}', 'closed')`),
    ).toMatch(/forbidden/);
    await db
      .user(organizer)
      .query(`select public.set_service_request_status('${requestId}', 'closed')`);
    const [{ id: quoteB }] = await db.sql<{ id: string }>(
      "select id from public.quotes where provider_id = $1",
      [B],
    );
    expect(quoteB).toBeTruthy();
    await db
      .user(organizer)
      .query(`select public.set_service_request_status('${requestId}', 'cancelled')`);
    expect(
      await db
        .user(organizer)
        .error(`select public.set_service_request_status('${requestId}', 'open')`),
    ).toMatch(/invalid_transition: cancelled -> open/);
    expect(
      await db
        .user(catererB)
        .error(`select public.post_request_message('${requestId}', '${B}', 'provider', 'hello?')`),
    ).toMatch(/request_cancelled/);
  });

  it("closed requests refuse quotes", async () => {
    const [{ id }] = await createRequest(organizer, [B]);
    requestId = id;
    await db.user(organizer).query(`select public.set_service_request_status('${id}', 'closed')`);
    expect(await saveQuote(catererB, B, 1000, true).catch((e) => (e as Error).message)).toMatch(
      /request_not_open/,
    );
  });

  it("database request transitions match SERVICE_REQUEST_TRANSITIONS for every pair", async () => {
    const statuses = ServiceRequestStatus.options;
    for (const from of statuses) {
      for (const to of statuses) {
        const [{ ok }] = await db.sql<{ ok: boolean }>(
          "select public.service_request_transition_allowed($1, $2) as ok",
          [from, to],
        );
        expect(ok, `${from} -> ${to}`).toBe(canTransitionRequest(from, to));
      }
    }
    expect(Object.keys(SERVICE_REQUEST_TRANSITIONS).sort()).toEqual([...statuses].sort());
  });

  it("suspended organizers cannot create requests", async () => {
    await db
      .user(admin)
      .query(`select public.set_account_status('${organizer}', 'suspended', 'test')`);
    expect(await createRequest(organizer, [B]).catch((e) => (e as Error).message)).toMatch(
      /account_inactive/,
    );
    await db.user(admin).query(`select public.set_account_status('${organizer}', 'active', null)`);
  });
});
