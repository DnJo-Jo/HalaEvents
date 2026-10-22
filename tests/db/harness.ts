import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite, type Transaction } from "@electric-sql/pglite";

/**
 * Local database harness for RLS / constraint / RPC tests.
 *
 * Runs the real migrations from supabase/migrations/ on PGlite (in-process Postgres) on top of
 * tests/db/supabase-shim.sql. This verifies our SQL, but it is NOT a live Supabase project:
 * Auth, PostgREST and the hosted platform are not involved (see event.md §14.6).
 */

const root = process.cwd();
const shim = readFileSync(join(root, "tests/db/supabase-shim.sql"), "utf8");
const migrationsDir = join(root, "supabase/migrations");

export const migrationFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

export type Who = { kind: "anon" } | { kind: "user"; id: string } | { kind: "service" };

export interface Session {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Resolves with the Postgres error message; fails the test if the statement succeeded. */
  error(sql: string, params?: unknown[]): Promise<string>;
}

export class TestDb {
  private constructor(readonly pg: PGlite) {}

  static async create(opts: { seed?: boolean } = {}): Promise<TestDb> {
    const pg = new PGlite();
    await pg.exec(shim);
    for (const file of migrationFiles) {
      try {
        await pg.exec(readFileSync(join(migrationsDir, file), "utf8"));
      } catch (e) {
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
    }
    if (opts.seed) await pg.exec(readFileSync(join(root, "supabase/seed.sql"), "utf8"));
    return new TestDb(pg);
  }

  /** Superuser (migration owner) access for fixtures and assertions. Bypasses RLS. */
  async sql<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return (await this.pg.query<T>(sql, params)).rows;
  }

  /** Simulates Supabase Auth creating a user (fires on_auth_user_created). */
  async createUser(email: string, opts: { confirmed?: boolean } = {}): Promise<string> {
    const [row] = await this.sql<{ id: string }>(
      "insert into auth.users (email, email_confirmed_at) values ($1, $2) returning id",
      [email, opts.confirmed === false ? null : new Date().toISOString()],
    );
    return row.id;
  }

  /** Creates a user who has completed onboarding with the given roles. */
  async createMember(email: string, roles: string[] = ["organizer"]): Promise<string> {
    const id = await this.createUser(email);
    await this.as({ kind: "user", id }).query(
      "select public.complete_onboarding($1, null, 'en', $2)",
      [email.split("@")[0], roles],
    );
    return id;
  }

  async makeAdmin(userId: string): Promise<void> {
    await this.sql("insert into public.platform_admins (user_id, note) values ($1, 'test')", [
      userId,
    ]);
  }

  as(who: Who): Session {
    const run = <T>(fn: (tx: Transaction) => Promise<T>) =>
      this.pg.transaction(async (tx) => {
        const role =
          who.kind === "user" ? "authenticated" : who.kind === "anon" ? "anon" : "service_role";
        const claims = who.kind === "user" ? { sub: who.id, role } : { role };
        await tx.exec(`set local role ${role}`);
        await tx.query("select set_config('request.jwt.claims', $1, true)", [
          JSON.stringify(claims),
        ]);
        return fn(tx);
      });

    return {
      query: async <T>(sql: string, params?: unknown[]) =>
        run(async (tx) => (await tx.query<T>(sql, params)).rows),
      error: async (sql: string, params?: unknown[]) => {
        try {
          await run((tx) => tx.query(sql, params));
        } catch (e) {
          return (e as Error).message;
        }
        throw new Error(`Expected statement to fail, but it succeeded: ${sql}`);
      },
    };
  }

  user(id: string): Session {
    return this.as({ kind: "user", id });
  }

  get anon(): Session {
    return this.as({ kind: "anon" });
  }

  async close(): Promise<void> {
    await this.pg.close();
  }
}
