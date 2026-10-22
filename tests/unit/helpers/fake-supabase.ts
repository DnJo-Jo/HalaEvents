/**
 * Minimal in-memory stand-in for the Supabase client, for unit-testing services and actions.
 * Supports select/eq/in/neq/order/limit/maybeSingle/single, insert/update/upsert/delete (recorded,
 * not applied) and rpc (recorded; responses configurable). It does NOT emulate RLS — that is what
 * tests/db covers; here we check that the app refuses before reaching the database.
 */
type Row = Record<string, unknown>;

export interface FakeState {
  sub: string | null;
  tables: Record<string, Row[]>;
  rpc: Record<string, { data?: unknown; error?: { code: string; message: string } }>;
  writes: { table: string; op: string; values?: unknown; filters: [string, unknown][] }[];
  rpcCalls: { fn: string; args: unknown }[];
}

export function createFakeState(partial: Partial<FakeState> = {}): FakeState {
  return { sub: "user-1", tables: {}, rpc: {}, writes: [], rpcCalls: [], ...partial };
}

export function fakeClient(state: FakeState) {
  return {
    auth: {
      getClaims: async () =>
        state.sub
          ? {
              data: { claims: { sub: state.sub, email: `${state.sub}@example.test` } },
              error: null,
            }
          : { data: null, error: null },
    },
    rpc: async (fn: string, args: unknown) => {
      state.rpcCalls.push({ fn, args });
      const r = state.rpc[fn] ?? {};
      return { data: r.data ?? null, error: r.error ?? null };
    },
    from(table: string) {
      const filters: [string, unknown, "eq" | "in" | "neq"][] = [];
      let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
      let values: unknown;
      const rows = () =>
        (state.tables[table] ?? []).filter((r) =>
          filters.every(([col, v, kind]) =>
            kind === "eq"
              ? r[col] === v
              : kind === "neq"
                ? r[col] !== v
                : (v as unknown[]).includes(r[col]),
          ),
        );
      const result = () => {
        if (op !== "select") {
          state.writes.push({ table, op, values, filters: filters.map(([c, v]) => [c, v]) });
          return { data: op === "delete" || op === "update" ? rows() : [values], error: null };
        }
        return { data: rows(), error: null };
      };
      const builder = {
        select: () => builder,
        insert: (v: unknown) => ((op = "insert"), (values = v), builder),
        update: (v: unknown) => ((op = "update"), (values = v), builder),
        upsert: (v: unknown) => ((op = "upsert"), (values = v), builder),
        delete: () => ((op = "delete"), builder),
        eq: (c: string, v: unknown) => (filters.push([c, v, "eq"]), builder),
        neq: (c: string, v: unknown) => (filters.push([c, v, "neq"]), builder),
        in: (c: string, v: unknown[]) => (filters.push([c, v, "in"]), builder),
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
        single: async () => ({ data: (result().data as Row[])[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
          try {
            resolve(result());
          } catch (e) {
            reject?.(e);
          }
        },
      };
      return builder;
    },
  };
}

/** A member profile + roles fixture (onboarded, active). */
export function member(
  state: FakeState,
  id: string,
  roles: string[],
  opts: { admin?: boolean } = {},
) {
  (state.tables.profiles ??= []).push({
    user_id: id,
    display_name: id,
    phone: null,
    locale: "en",
    account_status: "active",
    status_reason: null,
    onboarded_at: "2026-10-21T00:00:00Z",
  });
  for (const role of roles) (state.tables.user_roles ??= []).push({ user_id: id, role });
  if (opts.admin) state.rpc.is_platform_admin = { data: true };
}
