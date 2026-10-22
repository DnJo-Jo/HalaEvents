"use server";

import { redirect } from "next/navigation";
import { fieldErrorsOf, formString, type FormState } from "@/lib/forms";
import { safeNextPath } from "./rules";
import {
  ForgotPasswordInput,
  ResendInput,
  ResetPasswordInput,
  SignInInput,
  SignUpInput,
} from "./schemas";
import * as service from "./service";

export async function signInAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = formString(form, "email") ?? "";
  const parsed = SignInInput.safeParse({
    email,
    password: formString(form, "password"),
    next: formString(form, "next"),
  });
  if (!parsed.success)
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error), values: { email } };

  const result = await service.signIn(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    return {
      ok: false,
      message: result.message,
      values: { email, ...(result.code === "email_not_confirmed" ? { unconfirmed: "1" } : {}) },
    };
  }
  redirect(safeNextPath(parsed.data.next));
}

export async function signUpAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = formString(form, "email") ?? "";
  const parsed = SignUpInput.safeParse({
    email,
    password: formString(form, "password"),
    confirmPassword: formString(form, "confirmPassword"),
  });
  if (!parsed.success)
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error), values: { email } };

  const result = await service.signUp(parsed.data.email, parsed.data.password);
  if (!result.ok) return { ok: false, message: result.message, values: { email } };
  redirect(result.sessionCreated ? "/onboarding" : "/sign-up/check-email");
}

export async function resendConfirmationAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = ResendInput.safeParse({ email: formString(form, "email") });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  const result = await service.resendConfirmation(parsed.data.email);
  // Same message whether or not the address has an account.
  if (!result.ok && result.code !== "user_not_found") return { ok: false, message: result.message };
  return {
    ok: true,
    message: "If that address has an unconfirmed account, we've sent a new link.",
  };
}

export async function forgotPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = formString(form, "email") ?? "";
  const parsed = ForgotPasswordInput.safeParse({ email });
  if (!parsed.success)
    return { ok: false, fieldErrors: fieldErrorsOf(parsed.error), values: { email } };
  const result = await service.requestPasswordReset(parsed.data.email);
  // Same message whether or not the address has an account.
  if (!result.ok && result.code !== "user_not_found")
    return { ok: false, message: result.message, values: { email } };
  return {
    ok: true,
    message: "If that address has an account, we've sent a link to reset the password.",
  };
}

export async function resetPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = ResetPasswordInput.safeParse({
    password: formString(form, "password"),
    confirmPassword: formString(form, "confirmPassword"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  const result = await service.updatePassword(parsed.data.password);
  if (!result.ok) return { ok: false, message: result.message };
  redirect("/app");
}

export async function signOutAction(): Promise<void> {
  await service.signOut();
  redirect("/sign-in?signed_out=1");
}
