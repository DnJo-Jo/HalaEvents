import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();
vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({ auth: { getClaims } })),
}));

const { proxy } = await import("@/proxy");
const req = (path: string) => new NextRequest(new URL(path, "http://localhost:3000"));

beforeEach(() => {
  getClaims.mockReset();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
});

describe("proxy", () => {
  it("redirects visitors without a session from protected paths, preserving the target", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    const res = await proxy(req("/app/tasks?view=mine"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost:3000/sign-in?next=%2Fapp%2Ftasks%3Fview%3Dmine",
    );
  });

  it("lets signed-in users through", async () => {
    getClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });
    const res = await proxy(req("/app"));
    expect(res.headers.get("location")).toBeNull();
  });

  it("does not block public pages", async () => {
    getClaims.mockResolvedValue({ data: null, error: null });
    expect((await proxy(req("/"))).headers.get("location")).toBeNull();
    expect((await proxy(req("/sign-in"))).headers.get("location")).toBeNull();
  });

  it("still protects /app when Supabase is not configured (no fake access)", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    const res = await proxy(req("/app"));
    expect(res.headers.get("location")).toBe("http://localhost:3000/sign-in?next=%2Fapp");
    expect(getClaims).not.toHaveBeenCalled();
  });
});
