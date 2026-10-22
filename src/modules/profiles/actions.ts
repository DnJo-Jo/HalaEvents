"use server";

import { redirect } from "next/navigation";
import { AppError } from "@/lib/errors";
import { fieldErrorsOf, formString, type FormState } from "@/lib/forms";
import { OnboardingInput, ProfileUpdateInput } from "./schemas";
import * as service from "./service";

// Server actions: parse FormData with Zod, then call the service. Identity always comes from the
// verified session inside the service — any user_id in the submitted form is ignored.

function failure(e: unknown): FormState {
  if (e instanceof AppError) return { ok: false, message: e.message };
  throw e; // redirects and unexpected errors propagate to Next.js / error boundaries
}

export async function completeOnboardingAction(
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = OnboardingInput.safeParse({
    displayName: formString(form, "displayName"),
    phone: formString(form, "phone"),
    locale: formString(form, "locale"),
    roles: form.getAll("roles"),
  });
  const values = {
    displayName: formString(form, "displayName") ?? "",
    phone: formString(form, "phone") ?? "",
  };
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error), values };
  try {
    await service.completeOnboarding(parsed.data);
  } catch (e) {
    return { ...failure(e), values };
  }
  redirect("/app");
}

export async function updateProfileAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = ProfileUpdateInput.safeParse({
    displayName: formString(form, "displayName"),
    phone: formString(form, "phone"),
    locale: formString(form, "locale"),
  });
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  try {
    await service.updateOwnProfile(parsed.data);
  } catch (e) {
    return failure(e);
  }
  return { ok: true, message: "Profile saved." };
}

export async function updateRolesAction(_prev: FormState, form: FormData): Promise<FormState> {
  const parsed = OnboardingInput.shape.roles.safeParse(form.getAll("roles"));
  if (!parsed.success)
    return { ok: false, fieldErrors: { roles: parsed.error.issues.map((i) => i.message) } };
  try {
    await service.setOwnRoles(parsed.data);
  } catch (e) {
    return failure(e);
  }
  return { ok: true, message: "Roles updated." };
}
