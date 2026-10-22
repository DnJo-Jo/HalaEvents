import { describe, expect, it } from "vitest";
import { buildHealthReport } from "@/lib/health";

const SECRET = "secret-value-should-never-appear";
const now = new Date("2026-10-21T12:00:00Z");

describe("buildHealthReport", () => {
  const supabase = {
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key",
  };

  it("is ok with Supabase configured and all integrations mocked", () => {
    expect(buildHealthReport({ NODE_ENV: "development", ...supabase }, now).status).toBe("ok");
  });

  it("is degraded without Supabase (sign-in impossible) and flags mock mode", () => {
    const r = buildHealthReport({ NODE_ENV: "development" }, now);
    expect(r.status).toBe("degraded");
    expect(r.time).toBe("2026-10-21T12:00:00.000Z");
    expect(r.details?.anyMock).toBe(true);
    expect(r.details?.database).toBe("not_configured");
  });

  it("is degraded when a real integration lacks its key", () => {
    expect(buildHealthReport({ AI_PROVIDER: "gemini", ...supabase }, now).status).toBe("degraded");
  });

  it("hides details in production", () => {
    const r = buildHealthReport({ NODE_ENV: "production" }, now);
    expect(r.details).toBeUndefined();
    expect(Object.keys(r).sort()).toEqual(["app", "status", "time", "version"]);
  });

  it("never contains secret values", () => {
    const r = buildHealthReport(
      {
        NODE_ENV: "development",
        SUPABASE_SECRET_KEY: SECRET,
        GEMINI_API_KEY: SECRET,
        RESEND_API_KEY: SECRET,
        GOOGLE_PLACES_API_KEY: SECRET,
        NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SECRET,
      },
      now,
    );
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(r.details?.database).toBe("configured_unchecked");
  });
});
