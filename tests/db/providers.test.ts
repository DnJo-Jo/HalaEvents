import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ADMIN_VERIFICATION_TRANSITIONS,
  MODERATION_TRANSITIONS,
  canAdminTransition,
  canModerate,
} from "@/modules/profiles/rules";
import { ProviderModerationStatus, ProviderVerificationStatus } from "@/modules/profiles/schemas";
import { TestDb } from "./harness";

let db: TestDb;
let venueOwner: string;
let caterer: string;
let organizer: string;
let admin: string;
let venueId: string;

const createVenue = (name = "Hall One") =>
  `select public.create_provider('venue', 'venue', '${name}', 'Big hall', 'Dubai', '{Dubai}', 50, 400, 1000, 5000, 'AED', 'bookings@hall.test', '+971 4 000 0000') as id`;

beforeAll(async () => {
  db = await TestDb.create();
  venueOwner = await db.createMember("venue@example.test", ["venue_provider"]);
  caterer = await db.createMember("caterer@example.test", ["service_provider"]);
  organizer = await db.createMember("org@example.test", ["organizer"]);
  admin = await db.createMember("admin@example.test", ["organizer"]);
  await db.makeAdmin(admin);
  [{ id: venueId }] = await db.user(venueOwner).query<{ id: string }>(createVenue());
});
afterAll(() => db.close());

describe("provider creation", () => {
  it("starts as draft with the creator as sole owner and private details stored separately", async () => {
    const [p] = await db.sql<{ verification_status: string; created_by: string }>(
      "select verification_status, created_by from public.providers where id = $1",
      [venueId],
    );
    expect(p).toEqual({ verification_status: "draft", created_by: venueOwner });
    const members = await db.sql<{ user_id: string; role: string }>(
      "select user_id, role from public.provider_members where provider_id = $1",
      [venueId],
    );
    expect(members).toEqual([{ user_id: venueOwner, role: "owner" }]);
  });

  it("requires the matching account role", async () => {
    expect(await db.user(organizer).error(createVenue("Nope"))).toMatch(/role_required/);
    expect(await db.user(caterer).error(createVenue("Nope"))).toMatch(/role_required/);
    await db
      .user(caterer)
      .query("select public.create_provider('service', 'catering', 'Good Food') as id");
  });

  it("enforces kind/category consistency", async () => {
    expect(
      await db
        .user(venueOwner)
        .error("select public.create_provider('venue', 'catering', 'Mixed')"),
    ).toMatch(/providers_kind_matches_category/);
  });

  it("cannot be inserted directly (only via the RPC)", async () => {
    expect(
      await db
        .user(venueOwner)
        .error(
          "insert into public.providers (kind, category, name, verification_status) values ('venue','venue','Direct','verified')",
        ),
    ).toMatch(/permission denied/);
  });

  it("anon cannot create providers or read them", async () => {
    expect(await db.anon.error(createVenue("Anon"))).toMatch(/permission denied/);
    expect(await db.anon.error("select * from public.providers")).toMatch(/permission denied/);
  });
});

describe("verification cannot be self-granted", () => {
  const forbidden: Record<string, string> = {
    verification_status: "'verified'",
    verified_at: "now()",
    verification_note: "'ok'",
    kind: "'service'",
    moderation_status: "'active'",
    moderation_reason: "'x'",
    is_demo: "true",
  };
  it.each([...Object.keys(forbidden), "verified_by", "created_by"])(
    "owner cannot update %s directly",
    async (column) => {
      const value = forbidden[column] ?? `'${venueOwner}'`;
      expect(
        await db
          .user(venueOwner)
          .error(`update public.providers set ${column} = ${value} where id = $1`, [venueId]),
      ).toMatch(/permission denied/);
    },
  );

  it("owner cannot call the admin verification RPC", async () => {
    expect(
      await db
        .user(venueOwner)
        .error(`select public.set_provider_verification('${venueId}', 'verified', null)`),
    ).toMatch(/forbidden/);
  });

  it("owner can edit allowed marketplace fields", async () => {
    await db
      .user(venueOwner)
      .query("update public.providers set description = 'Updated' where id = $1", [venueId]);
    const [p] = await db.sql<{ description: string }>(
      "select description from public.providers where id = $1",
      [venueId],
    );
    expect(p.description).toBe("Updated");
  });

  it("non-members cannot edit a provider", async () => {
    await db
      .user(caterer)
      .query("update public.providers set description = 'hijacked' where id = $1", [venueId]);
    const [p] = await db.sql<{ description: string }>(
      "select description from public.providers where id = $1",
      [venueId],
    );
    expect(p.description).toBe("Updated");
  });
});

describe("visibility of unverified providers and private data", () => {
  it("an unverified provider is invisible to unrelated members", async () => {
    expect(
      await db.user(organizer).query("select id from public.providers where id = $1", [venueId]),
    ).toEqual([]);
  });

  it("members of the provider can see it", async () => {
    expect(
      await db.user(venueOwner).query("select id from public.providers where id = $1", [venueId]),
    ).toHaveLength(1);
  });

  it("private details are never visible to unrelated members", async () => {
    expect(
      await db
        .user(organizer)
        .query("select * from public.provider_private where provider_id = $1", [venueId]),
    ).toEqual([]);
    expect(
      await db
        .user(caterer)
        .query("select * from public.provider_members where provider_id = $1", [venueId]),
    ).toEqual([]);
  });
});

describe("verification workflow", () => {
  it("owner submits; admin verifies; it becomes visible (public fields only) and is audited", async () => {
    await db.user(venueOwner).query(`select public.submit_provider_for_verification('${venueId}')`);
    expect(
      await db
        .user(venueOwner)
        .error(`select public.submit_provider_for_verification('${venueId}')`),
    ).toMatch(/invalid_transition/);

    await db
      .user(admin)
      .query(`select public.set_provider_verification('${venueId}', 'verified', null)`);
    const [p] = await db.sql<{
      verification_status: string;
      verified_by: string;
      verified_at: string | null;
    }>("select verification_status, verified_by, verified_at from public.providers where id = $1", [
      venueId,
    ]);
    expect(p.verification_status).toBe("verified");
    expect(p.verified_by).toBe(admin);
    expect(p.verified_at).not.toBeNull();

    expect(
      await db.user(organizer).query("select id from public.providers where id = $1", [venueId]),
    ).toHaveLength(1);
    expect(
      await db
        .user(organizer)
        .query("select * from public.provider_private where provider_id = $1", [venueId]),
    ).toEqual([]);

    const audit = await db.sql<{ actor_user_id: string; after: { verification_status: string } }>(
      "select actor_user_id, after from public.audit_log where entity_type = 'providers' and entity_id = $1 and action = 'update' order by id",
      [venueId],
    );
    expect(audit.map((a) => a.after.verification_status)).toEqual(["submitted", "verified"]);
    expect(audit[1].actor_user_id).toBe(admin);
  });

  it("an active account is not a verified business", async () => {
    const [{ id }] = await db
      .user(caterer)
      .query<{ id: string }>("select public.create_provider('service', 'av', 'AV Co') as id");
    const [acct] = await db.sql<{ account_status: string }>(
      "select account_status from public.profiles where user_id = $1",
      [caterer],
    );
    const [prov] = await db.sql<{ verification_status: string }>(
      "select verification_status from public.providers where id = $1",
      [id],
    );
    expect(acct.account_status).toBe("active");
    expect(prov.verification_status).toBe("draft");
  });

  it("submitting requires a contact email", async () => {
    const [{ id }] = await db
      .user(caterer)
      .query<{ id: string }>(
        "select public.create_provider('service', 'decor', 'No Contact') as id",
      );
    expect(
      await db.user(caterer).error(`select public.submit_provider_for_verification('${id}')`),
    ).toMatch(/contact_email_required/);
  });

  it("an admin cannot verify a provider they belong to", async () => {
    const adminProvider = await db.createMember("admin2@example.test", ["service_provider"]);
    await db.makeAdmin(adminProvider);
    const [{ id }] = await db
      .user(adminProvider)
      .query<{ id: string }>(
        "select public.create_provider('service', 'security', 'Own Co', null, null, '{}', null, null, null, null, 'AED', 'a@b.test') as id",
      );
    await db.user(adminProvider).query(`select public.submit_provider_for_verification('${id}')`);
    expect(
      await db
        .user(adminProvider)
        .error(`select public.set_provider_verification('${id}', 'verified', null)`),
    ).toMatch(/conflict_of_interest/);
  });

  it("database transitions match ADMIN_VERIFICATION_TRANSITIONS for every pair", async () => {
    const statuses = ProviderVerificationStatus.options;
    for (const from of statuses) {
      for (const to of statuses) {
        const [{ ok }] = await db.sql<{ ok: boolean }>(
          "select public.provider_verification_admin_transition_allowed($1, $2) as ok",
          [from, to],
        );
        expect(ok, `${from} -> ${to}`).toBe(canAdminTransition(from, to));
      }
    }
    expect(Object.keys(ADMIN_VERIFICATION_TRANSITIONS).sort()).toEqual([...statuses].sort());
  });

  it("database moderation transitions match MODERATION_TRANSITIONS for every pair", async () => {
    const statuses = ProviderModerationStatus.options;
    for (const from of statuses) {
      for (const to of statuses) {
        const [{ ok }] = await db.sql<{ ok: boolean }>(
          "select public.provider_moderation_transition_allowed($1, $2) as ok",
          [from, to],
        );
        expect(ok, `${from} -> ${to}`).toBe(canModerate(from, to));
      }
    }
    expect(Object.keys(MODERATION_TRANSITIONS).sort()).toEqual([...statuses].sort());
  });

  it("suspension is moderation: keeps verification, needs a reason, hides the listing, is audited", async () => {
    expect(
      await db
        .user(admin)
        .error(`select public.set_provider_verification('${venueId}', 'suspended', 'x')`),
    ).toMatch(/invalid_transition/);
    expect(
      await db
        .user(admin)
        .error(`select public.set_provider_moderation('${venueId}', 'suspended', ' ')`),
    ).toMatch(/reason_required/);
    expect(
      await db
        .user(venueOwner)
        .error(`select public.set_provider_moderation('${venueId}', 'hidden', 'x')`),
    ).toMatch(/forbidden/);
    await db
      .user(admin)
      .query(
        `select public.set_provider_moderation('${venueId}', 'suspended', 'Complaints under review')`,
      );
    const [p] = await db.sql<{ verification_status: string; moderation_status: string }>(
      "select verification_status, moderation_status from public.providers where id = $1",
      [venueId],
    );
    expect(p).toEqual({ verification_status: "verified", moderation_status: "suspended" });
    expect(
      await db.user(organizer).query("select id from public.providers where id = $1", [venueId]),
    ).toEqual([]);
    expect(
      await db.user(venueOwner).query("select id from public.providers where id = $1", [venueId]),
    ).toHaveLength(1);
    expect(
      await db.sql(
        "select 1 from public.audit_log where entity_id = $1 and after->>'moderation_status' = 'suspended'",
        [venueId],
      ),
    ).toHaveLength(1);
    await db
      .user(admin)
      .query(`select public.set_provider_moderation('${venueId}', 'active', null)`);
  });
});
