import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TestDb } from "./harness";

let db: TestDb;
let alice: string;
let bob: string;
let admin: string;

beforeAll(async () => {
  db = await TestDb.create();
  alice = await db.createUser("alice@example.test");
  bob = await db.createMember("bob@example.test", ["organizer"]);
  admin = await db.createMember("admin@example.test", ["organizer"]);
  await db.makeAdmin(admin);
});
afterAll(() => db.close());

describe("profile creation", () => {
  it("creates an empty, active, not-onboarded profile for every new auth user", async () => {
    const [p] = await db.sql<{
      account_status: string;
      onboarded_at: string | null;
      display_name: string | null;
    }>(
      "select account_status, onboarded_at, display_name from public.profiles where user_id = $1",
      [alice],
    );
    expect(p).toEqual({ account_status: "active", onboarded_at: null, display_name: null });
  });

  it("ignores client-supplied user metadata (no role/admin escalation via sign-up data)", async () => {
    const [{ id }] = await db.sql<{ id: string }>(
      `insert into auth.users (email, raw_user_meta_data)
       values ('meta@example.test', '{"role":"platform_admin","account_status":"active","is_admin":true}')
       returning id`,
    );
    const roles = await db.sql("select * from public.user_roles where user_id = $1", [id]);
    const admins = await db.sql("select * from public.platform_admins where user_id = $1", [id]);
    expect(roles).toEqual([]);
    expect(admins).toEqual([]);
  });
});

describe("unauthenticated access", () => {
  it.each(["profiles", "user_roles", "platform_admins", "audit_log"])(
    "anon cannot read public.%s",
    async (table) => {
      expect(await db.anon.error(`select * from public.${table}`)).toMatch(/permission denied/);
    },
  );

  it("anon cannot call account RPCs", async () => {
    expect(
      await db.anon.error("select public.complete_onboarding('x', null, 'en', '{organizer}')"),
    ).toMatch(/permission denied/);
    expect(
      await db.anon.error(`select public.set_account_status('${alice}', 'suspended', 'x')`),
    ).toMatch(/permission denied/);
  });
});

describe("onboarding", () => {
  it("completes the caller's own profile and roles atomically", async () => {
    await db
      .user(alice)
      .query("select public.complete_onboarding('Alice', '+971 50 000 0000', 'en', $1)", [
        ["organizer", "venue_provider"],
      ]);
    const [p] = await db
      .user(alice)
      .query<{ display_name: string; onboarded_at: string | null }>(
        "select display_name, onboarded_at from public.profiles where user_id = $1",
        [alice],
      );
    expect(p.display_name).toBe("Alice");
    expect(p.onboarded_at).not.toBeNull();
    const roles = await db
      .user(alice)
      .query<{ role: string }>("select role from public.user_roles order by role");
    expect(roles.map((r) => r.role)).toEqual(["organizer", "venue_provider"]);
  });

  it("rejects platform_admin (or any unknown value) as a self-service role", async () => {
    const msg = await db
      .user(alice)
      .error("select public.complete_onboarding('Alice', null, 'en', $1)", [["platform_admin"]]);
    expect(msg).toMatch(/user_roles_role_check|violates check constraint/);
    expect(
      await db
        .user(alice)
        .error("insert into public.user_roles (user_id, role) values ($1, 'platform_admin')", [
          alice,
        ]),
    ).toMatch(/check constraint/);
  });

  it("requires at least one role", async () => {
    expect(
      await db.user(alice).error("select public.complete_onboarding('Alice', null, 'en', '{}')"),
    ).toMatch(/roles_required/);
  });
});

describe("profile ownership and protected fields", () => {
  it("a member reads only their own profile", async () => {
    const rows = await db
      .user(bob)
      .query<{ user_id: string }>("select user_id from public.profiles");
    expect(rows.map((r) => r.user_id)).toEqual([bob]);
  });

  it("a member can update their own editable fields", async () => {
    await db
      .user(bob)
      .query(
        "update public.profiles set display_name = 'Bob B', locale = 'ar' where user_id = $1",
        [bob],
      );
    const [p] = await db.sql<{ display_name: string; locale: string }>(
      "select display_name, locale from public.profiles where user_id = $1",
      [bob],
    );
    expect(p).toEqual({ display_name: "Bob B", locale: "ar" });
  });

  it("updating another member's profile affects no rows", async () => {
    await db
      .user(bob)
      .query("update public.profiles set display_name = 'hacked' where user_id = $1", [alice]);
    const [p] = await db.sql<{ display_name: string }>(
      "select display_name from public.profiles where user_id = $1",
      [alice],
    );
    expect(p.display_name).toBe("Alice");
  });

  it.each([
    ["account_status", "'active'"],
    ["status_reason", "null"],
    ["onboarded_at", "now()"],
    ["user_id", `'00000000-0000-0000-0000-000000000000'`],
  ])("a member cannot change their own %s", async (column, value) => {
    expect(
      await db
        .user(bob)
        .error(`update public.profiles set ${column} = ${value} where user_id = $1`, [bob]),
    ).toMatch(/permission denied/);
  });

  it("a member cannot insert or delete profiles", async () => {
    expect(
      await db.user(bob).error("delete from public.profiles where user_id = $1", [bob]),
    ).toMatch(/permission denied/);
    expect(
      await db.user(bob).error("insert into public.profiles (user_id) values ($1)", [bob]),
    ).toMatch(/permission denied/);
  });

  it("a member cannot add roles for someone else", async () => {
    expect(
      await db
        .user(bob)
        .error("insert into public.user_roles (user_id, role) values ($1, 'organizer')", [alice]),
    ).toMatch(/row-level security/);
  });
});

describe("administrator privileges", () => {
  it("a member cannot grant themselves platform admin", async () => {
    expect(
      await db.user(bob).error("insert into public.platform_admins (user_id) values ($1)", [bob]),
    ).toMatch(/permission denied/);
    const [{ is_admin }] = await db
      .user(bob)
      .query<{ is_admin: boolean }>("select public.is_platform_admin() as is_admin");
    expect(is_admin).toBe(false);
  });

  it("a member cannot suspend accounts", async () => {
    expect(
      await db.user(bob).error(`select public.set_account_status('${alice}', 'suspended', 'spam')`),
    ).toMatch(/forbidden/);
  });

  it("an admin can read all profiles", async () => {
    const rows = await db.user(admin).query("select user_id from public.profiles");
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it("an admin cannot moderate themselves", async () => {
    expect(
      await db.user(admin).error(`select public.set_account_status('${admin}', 'suspended', 'x')`),
    ).toMatch(/cannot_moderate_self/);
  });

  it("suspension requires a reason, blocks writes, and is audited", async () => {
    expect(
      await db.user(admin).error(`select public.set_account_status('${bob}', 'suspended', '')`),
    ).toMatch(/reason_required/);
    await db
      .user(admin)
      .query(`select public.set_account_status('${bob}', 'suspended', 'Spam reports')`);

    // Suspended: profile edits silently match no rows; role changes are refused.
    await db
      .user(bob)
      .query("update public.profiles set display_name = 'still here' where user_id = $1", [bob]);
    const [p] = await db.sql<{ display_name: string }>(
      "select display_name from public.profiles where user_id = $1",
      [bob],
    );
    expect(p.display_name).toBe("Bob B");
    expect(
      await db
        .user(bob)
        .error("insert into public.user_roles (user_id, role) values ($1, 'service_provider')", [
          bob,
        ]),
    ).toMatch(/row-level security/);

    const audit = await db.sql<{
      actor_user_id: string;
      action: string;
      after: { account_status: string };
    }>(
      "select actor_user_id, action, after from public.audit_log where entity_type = 'profiles' and entity_id = $1",
      [bob],
    );
    expect(audit).toHaveLength(1);
    expect(audit[0].actor_user_id).toBe(admin);
    expect(audit[0].after.account_status).toBe("suspended");

    await db.user(admin).query(`select public.set_account_status('${bob}', 'active', null)`);
  });
});

describe("audit log is append-only", () => {
  it("no API role can write to it", async () => {
    for (const who of [db.user(bob), db.user(admin)]) {
      expect(
        await who.error(
          "insert into public.audit_log (actor_kind, entity_type, entity_id, action) values ('user','x','y','z')",
        ),
      ).toMatch(/permission denied/);
      expect(await who.error("update public.audit_log set action = 'tampered'")).toMatch(
        /permission denied/,
      );
      expect(await who.error("delete from public.audit_log")).toMatch(/permission denied/);
    }
  });

  it("regular members cannot read account audit entries", async () => {
    expect(
      await db.user(bob).query("select * from public.audit_log where event_id is null"),
    ).toEqual([]);
  });
});
