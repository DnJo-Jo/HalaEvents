import { beforeEach, describe, expect, it, vi } from "vitest";

// A minimal Supabase client double that records what the actions send to the database.
const calls: {
  table?: string;
  update?: unknown;
  eq?: [string, unknown];
  rpc?: [string, unknown];
}[] = [];
let sessionSub: string | null = "session-user";

function client() {
  return {
    auth: {
      getClaims: async () =>
        sessionSub
          ? { data: { claims: { sub: sessionSub, email: "me@example.test" } }, error: null }
          : { data: null, error: null },
    },
    from(table: string) {
      const call: (typeof calls)[number] = { table };
      calls.push(call);
      const chain = {
        update(values: unknown) {
          call.update = values;
          return chain;
        },
        eq(col: string, val: unknown) {
          call.eq = [col, val];
          return chain;
        },
        select: async () => ({ data: [{ user_id: sessionSub }], error: null }),
      };
      return chain;
    },
    rpc: async (fn: string, args: unknown) => {
      calls.push({ rpc: [fn, args] });
      return { data: null, error: null };
    },
  };
}

vi.mock("@/lib/db/server", () => ({ createSupabaseServerClient: vi.fn(async () => client()) }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  }),
}));

const { updateProfileAction, completeOnboardingAction } =
  await import("@/modules/profiles/actions");

function form(entries: [string, string][]) {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}

beforeEach(() => {
  calls.length = 0;
  sessionSub = "session-user";
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
});

describe("updateProfileAction", () => {
  it("updates the session user's row and ignores user_id / privileged fields in the form", async () => {
    const result = await updateProfileAction(
      {},
      form([
        ["displayName", "Sam"],
        ["locale", "en"],
        ["user_id", "attacker-target"],
        ["account_status", "active"],
        ["onboarded_at", "2026-01-01"],
      ]),
    );
    expect(result).toEqual({ ok: true, message: "Profile saved." });
    const call = calls.find((c) => c.table === "profiles")!;
    expect(call.eq).toEqual(["user_id", "session-user"]);
    expect(call.update).toEqual({ display_name: "Sam", phone: null, locale: "en" });
  });

  it("returns field errors and writes nothing for invalid input", async () => {
    const result = await updateProfileAction(
      {},
      form([
        ["displayName", ""],
        ["locale", "fr"],
      ]),
    );
    expect(result.ok).toBe(false);
    expect(Object.keys(result.fieldErrors ?? {})).toEqual(
      expect.arrayContaining(["displayName", "locale"]),
    );
    expect(calls).toEqual([]);
  });

  it("redirects unauthenticated callers to sign-in without writing", async () => {
    sessionSub = null;
    await expect(
      updateProfileAction(
        {},
        form([
          ["displayName", "Sam"],
          ["locale", "en"],
        ]),
      ),
    ).rejects.toMatchObject({
      to: "/sign-in?next=%2Fapp%2Fsettings",
    });
    expect(calls.filter((c) => c.table || c.rpc)).toEqual([]);
  });
});

describe("completeOnboardingAction", () => {
  it("rejects platform_admin as a role before reaching the database", async () => {
    const result = await completeOnboardingAction(
      {},
      form([
        ["displayName", "Sam"],
        ["locale", "en"],
        ["roles", "platform_admin"],
      ]),
    );
    expect(result.fieldErrors?.roles?.length).toBeGreaterThan(0);
    expect(calls.filter((c) => c.rpc)).toEqual([]);
  });

  it("calls complete_onboarding without any user id parameter, then redirects to /app", async () => {
    await expect(
      completeOnboardingAction(
        {},
        form([
          ["displayName", " Sam "],
          ["locale", "en"],
          ["roles", "organizer"],
          ["roles", "venue_provider"],
          ["user_id", "attacker-target"],
        ]),
      ),
    ).rejects.toMatchObject({ to: "/app" });
    const rpc = calls.find((c) => c.rpc)!.rpc!;
    expect(rpc[0]).toBe("complete_onboarding");
    expect(rpc[1]).toEqual({
      p_display_name: "Sam",
      p_phone: null,
      p_locale: "en",
      p_roles: ["organizer", "venue_provider"],
    });
  });
});
