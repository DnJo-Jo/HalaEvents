import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EventMemberRole, EventStatus, EventType, VenueType } from "@/modules/events/schemas";
import {
  InviteStatus,
  MessageSide,
  QuoteStatus,
  ServiceRequestStatus,
} from "@/modules/bookings/schemas";
import {
  AccountRole,
  AccountStatus,
  DocumentKind,
  DocumentReviewStatus,
  Locale,
  PricingModel,
  ProviderCategory,
  ProviderKind,
  ProviderMemberRole,
  ProviderModerationStatus,
  ProviderVerificationStatus,
  VenueSetting,
} from "@/modules/profiles/schemas";
import { TestDb, migrationFiles } from "./harness";

let db: TestDb;
beforeAll(async () => {
  db = await TestDb.create();
});
afterAll(() => db.close());

describe("schema hardening", () => {
  it("migrations are named <timestamp>_<name>.sql and apply in order", () => {
    expect(migrationFiles.length).toBeGreaterThanOrEqual(3);
    for (const f of migrationFiles) expect(f).toMatch(/^\d{14}_[a-z_]+\.sql$/);
  });

  it("every public table has RLS enabled", async () => {
    const rows = await db.sql<{ relname: string; relrowsecurity: boolean }>(
      `select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r'`,
    );
    expect(rows.length).toBeGreaterThanOrEqual(9);
    expect(rows.filter((r) => !r.relrowsecurity).map((r) => r.relname)).toEqual([]);
  });

  it("anon has no table privileges in public", async () => {
    const rows = await db.sql(
      "select table_name, privilege_type from information_schema.role_table_grants where grantee = 'anon' and table_schema = 'public'",
    );
    expect(rows).toEqual([]);
  });

  it("anon can execute only the public registration functions (event.md §5.2)", async () => {
    const rows = await db.sql<{ proname: string }>(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(rows.map((r) => r.proname).sort()).toEqual([
      "public_event_by_slug",
      "register_attendee",
    ]);
  });

  it("every SECURITY DEFINER function pins search_path", async () => {
    const rows = await db.sql<{ proname: string; proconfig: string[] | null }>(
      `select p.proname, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef`,
    );
    expect(rows.length).toBeGreaterThan(5);
    expect(
      rows
        .filter((r) => !r.proconfig?.some((c) => c.startsWith("search_path=")))
        .map((r) => r.proname),
    ).toEqual([]);
  });

  it("authenticated has no write privilege on audit_log or platform_admins", async () => {
    const rows = await db.sql(
      `select table_name, privilege_type from information_schema.role_table_grants
       where grantee = 'authenticated' and table_name in ('audit_log', 'platform_admins') and privilege_type <> 'SELECT'`,
    );
    expect(rows).toEqual([]);
  });
});

describe("TypeScript enums match the database CHECK constraints", () => {
  // Reads the constraints as they exist after all migrations (later migrations may redefine them).
  async function checkValues(table: string, column: string): Promise<string[]> {
    const rows = await db.sql<{ def: string }>(
      `select pg_get_constraintdef(c.oid) as def from pg_constraint c
         join pg_class t on t.oid = c.conrelid join pg_namespace n on n.oid = t.relnamespace
        where n.nspname = 'public' and t.relname = $1 and c.contype = 'c'`,
      [table],
    );
    const re = new RegExp(`\\b${column} = ANY \\(\\(?ARRAY\\[([^\\]]*)\\]`);
    for (const { def } of rows) {
      const m = def.match(re);
      if (m) return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    }
    // Postgres normalises a single-value IN list to "CHECK ((column = 'value'::text))".
    for (const { def } of rows) {
      const single = def.match(new RegExp(`^CHECK \\(\\(${column} = '([a-z_]+)'::text\\)\\)$`));
      if (single) return [single[1]];
    }
    throw new Error(`No CHECK (${table}.${column} = ANY (...)) found`);
  }

  it.each([
    ["profiles", "account_status", AccountStatus.options],
    ["profiles", "locale", Locale.options],
    ["user_roles", "role", AccountRole.options],
    ["providers", "kind", ProviderKind.options],
    ["providers", "category", ProviderCategory.options],
    ["providers", "verification_status", ProviderVerificationStatus.options],
    ["providers", "moderation_status", ProviderModerationStatus.options],
    ["providers", "pricing_model", PricingModel.options],
    ["provider_members", "role", ProviderMemberRole.options],
    ["provider_services", "category", ProviderCategory.options],
    ["provider_services", "pricing_model", PricingModel.options],
    ["provider_documents", "kind", DocumentKind.options],
    ["provider_documents", "review_status", DocumentReviewStatus.options],
    ["venue_profiles", "setting", VenueSetting.options],
    ["events", "status", EventStatus.options],
    ["events", "event_type", EventType.options],
    ["events", "venue_type", VenueType.options],
    ["event_members", "role", EventMemberRole.options],
    ["service_requests", "status", ServiceRequestStatus.options],
    ["service_requests", "category", ProviderCategory.options],
    ["service_request_invites", "status", InviteStatus.options],
    ["service_request_messages", "author_side", MessageSide.options],
    ["quotes", "status", QuoteStatus.options],
  ] as const)("%s.%s", async (table, column, values) => {
    expect(await checkValues(table, column)).toEqual([...values]);
  });
});
