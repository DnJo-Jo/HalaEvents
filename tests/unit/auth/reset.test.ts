import { describe, expect, it } from "vitest";
import { authErrorMessage } from "@/modules/auth/rules";
import { ForgotPasswordInput, ResetPasswordInput } from "@/modules/auth/schemas";

describe("ForgotPasswordInput", () => {
  it("accepts a valid email and rejects garbage", () => {
    expect(ForgotPasswordInput.safeParse({ email: "a@example.com" }).success).toBe(true);
    expect(ForgotPasswordInput.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(ForgotPasswordInput.safeParse({}).success).toBe(false);
  });
});

describe("ResetPasswordInput", () => {
  const ok = { password: "New-pw-67890", confirmPassword: "New-pw-67890" };
  it("accepts matching strong passwords", () => {
    expect(ResetPasswordInput.safeParse(ok).success).toBe(true);
  });
  it("rejects weak passwords", () => {
    expect(
      ResetPasswordInput.safeParse({ password: "short1", confirmPassword: "short1" }).success,
    ).toBe(false);
    expect(
      ResetPasswordInput.safeParse({ password: "onlyletters", confirmPassword: "onlyletters" })
        .success,
    ).toBe(false);
  });
  it("rejects mismatched confirmation on the confirmPassword field", () => {
    const r = ResetPasswordInput.safeParse({ ...ok, confirmPassword: "Other-pw-1" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.path).toEqual(["confirmPassword"]);
  });
});

describe("authErrorMessage", () => {
  it("explains a reused password without echoing the provider message", () => {
    expect(authErrorMessage({ code: "same_password", message: "internal detail" })).not.toContain(
      "internal",
    );
    expect(authErrorMessage({ code: "same_password" })).toMatch(/password/i);
  });
});
