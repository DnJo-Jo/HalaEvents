import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { getClaims } })),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  }),
}));

const { getSessionUser, requireUser } = await import("@/lib/auth/session");

beforeEach(() => {
  getClaims.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
});

describe("getSessionUser", () => {
  it("returns the verified subject from getClaims()", async () => {
    getClaims.mockResolvedValue({
      data: { claims: { sub: "user-1", email: "a@b.test" } },
      error: null,
    });
    expect(await getSessionUser()).toEqual({ id: "user-1", email: "a@b.test" });
  });

  it("returns null when verification fails", async () => {
    getClaims.mockResolvedValue({ data: null, error: new Error("invalid JWT") });
    expect(await getSessionUser()).toBeNull();
  });

  it("returns null (and makes no call) when Supabase is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    expect(await getSessionUser()).toBeNull();
    expect(getClaims).not.toHaveBeenCalled();
  });
});

describe("requireUser", () => {
  it("redirects unauthenticated visitors to sign-in with a safe next path", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(requireUser("/app/settings")).rejects.toMatchObject({
      to: "/sign-in?next=%2Fapp%2Fsettings",
    });
  });

  it("never carries an external URL into next", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    await expect(requireUser("https://evil.example")).rejects.toMatchObject({
      to: "/sign-in?next=%2Fapp",
    });
  });
});
