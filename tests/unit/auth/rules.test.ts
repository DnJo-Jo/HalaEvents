import { describe, expect, it } from "vitest";
import { authErrorMessage, isProtectedPath, safeNextPath } from "@/modules/auth/rules";
import { Password, SignUpInput } from "@/modules/auth/schemas";

describe("safeNextPath (open-redirect protection)", () => {
  it.each([
    ["/app", "/app"],
    ["/app/settings?tab=roles", "/app/settings?tab=roles"],
    ["/onboarding#top", "/onboarding#top"],
  ])("allows same-origin path %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    "https://evil.example",
    "//evil.example",
    "///evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "app",
    "",
    "/app\n/x",
    "/app\u0000",
    "/" + "a".repeat(600),
  ])("rejects %j", (input) => {
    expect(safeNextPath(input)).toBe("/app");
  });

  it("rejects non-strings and uses the given fallback", () => {
    expect(safeNextPath(undefined, "/onboarding")).toBe("/onboarding");
    expect(safeNextPath(["/app"])).toBe("/app");
    expect(safeNextPath(42)).toBe("/app");
  });
});

describe("isProtectedPath", () => {
  it.each(["/app", "/app/events", "/onboarding", "/account-status"])("%s is protected", (p) => {
    expect(isProtectedPath(p)).toBe(true);
  });
  it.each(["/", "/sign-in", "/sign-up", "/apples", "/status", "/auth/confirm"])(
    "%s is public",
    (p) => {
      expect(isProtectedPath(p)).toBe(false);
    },
  );
});

describe("authErrorMessage", () => {
  it("uses one generic message for wrong password and unknown user (no enumeration)", () => {
    expect(authErrorMessage({ code: "invalid_credentials" })).toBe(
      authErrorMessage({ code: "user_not_found" }),
    );
  });

  it("never echoes the provider's raw message", () => {
    const raw = "internal: db host 10.0.0.5 refused connection";
    expect(authErrorMessage({ code: "unexpected_failure", message: raw })).not.toContain(raw);
  });

  it("explains unconfirmed email and rate limits", () => {
    expect(authErrorMessage({ code: "email_not_confirmed" })).toMatch(/confirm your email/);
    expect(authErrorMessage({ status: 429 })).toMatch(/Too many attempts/);
  });
});

describe("auth schemas", () => {
  it("password needs 8–72 chars with a letter and a digit", () => {
    expect(Password.safeParse("short1").success).toBe(false);
    expect(Password.safeParse("lettersonly").success).toBe(false);
    expect(Password.safeParse("12345678").success).toBe(false);
    expect(Password.safeParse("a".repeat(72) + "1").success).toBe(false);
    expect(Password.safeParse("hackathon2026").success).toBe(true);
  });

  it("normalises email and requires matching confirmation", () => {
    const ok = SignUpInput.safeParse({
      email: "  Sam@Example.TEST ",
      password: "hackathon2026",
      confirmPassword: "hackathon2026",
    });
    expect(ok.success && ok.data.email).toBe("sam@example.test");
    const bad = SignUpInput.safeParse({
      email: "sam@example.test",
      password: "hackathon2026",
      confirmPassword: "other2026",
    });
    expect(bad.success).toBe(false);
  });
});
