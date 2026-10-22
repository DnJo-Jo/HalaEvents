import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EnvError, inspectServerEnv, parseServerEnv } from "@/lib/env.server";

const SECRET = "sk-test-DO-NOT-LEAK-123";

describe("parseServerEnv", () => {
  it("defaults every integration to mock with an empty environment", () => {
    const env = parseServerEnv({});
    expect(env.AI_PROVIDER).toBe("mock");
    expect(env.EMAIL_PROVIDER).toBe("mock");
    expect(env.NEXT_PUBLIC_APP_NAME).toBe("HalaEvents");
  });

  it("treats empty strings from .env.example as unset", () => {
    const env = parseServerEnv({ GEMINI_API_KEY: "", AI_PROVIDER: "" });
    expect(env.GEMINI_API_KEY).toBeUndefined();
    expect(env.AI_PROVIDER).toBe("mock");
  });

  it("fails with a readable error naming the missing variables (fail fast, no silent mock)", () => {
    expect(() => parseServerEnv({ AI_PROVIDER: "gemini" })).toThrow(EnvError);
    try {
      parseServerEnv({ AI_PROVIDER: "gemini", EMAIL_PROVIDER: "resend" });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("GEMINI_API_KEY: required when AI_PROVIDER=gemini");
      expect(msg).toContain("GEMINI_MODEL");
      expect(msg).toContain("RESEND_API_KEY");
      expect(msg).toContain(".env.example");
    }
  });

  it("never includes variable values in the error message", () => {
    try {
      parseServerEnv({
        AI_PROVIDER: "gemini",
        GEMINI_API_KEY: SECRET,
        NEXT_PUBLIC_APP_URL: SECRET,
      });
      expect.unreachable();
    } catch (e) {
      expect((e as Error).message).not.toContain(SECRET);
    }
  });

  it("accepts a fully configured real setup", () => {
    expect(() =>
      parseServerEnv({ AI_PROVIDER: "gemini", GEMINI_API_KEY: SECRET, GEMINI_MODEL: "model-x" }),
    ).not.toThrow();
  });
});

describe("inspectServerEnv", () => {
  it("reports names and booleans only — no secret values", () => {
    const report = inspectServerEnv({
      SUPABASE_SECRET_KEY: SECRET,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: SECRET,
      GEMINI_API_KEY: SECRET,
      RESEND_API_KEY: SECRET,
      AI_PROVIDER: "gemini",
      GEMINI_MODEL: "model-x",
    });
    expect(JSON.stringify(report)).not.toContain(SECRET);
    expect(report.supabase.secretKeySet).toBe(true);
    expect(report.integrations.find((i) => i.name === "ai")).toEqual({
      name: "ai",
      mode: "gemini",
      mock: false,
    });
  });

  it("does not echo unknown mode values", () => {
    const report = inspectServerEnv({ EMAIL_PROVIDER: SECRET });
    expect(report.valid).toBe(false);
    expect(report.integrations.find((i) => i.name === "email")?.mode).toBe("invalid");
    expect(JSON.stringify(report)).not.toContain(SECRET);
  });
});

describe("env.client.ts", () => {
  it("references only NEXT_PUBLIC_* variables", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/env.client.ts"), "utf8");
    const names = [...src.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => !n.startsWith("NEXT_PUBLIC_"))).toEqual([]);
  });
});
