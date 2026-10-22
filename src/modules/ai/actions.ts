"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { formFields } from "@/lib/action";
import { AppError } from "@/lib/errors";
import type { FormState } from "@/lib/forms";
import { ReviseTaskInput } from "./schemas";
import * as service from "./service";
import type { AiActionResult } from "./service";

const Id = z.uuid();

async function run(fn: () => Promise<AiActionResult | void>, done = "Saved."): Promise<FormState> {
  try {
    const result = await fn();
    refresh();
    if (!result) return { ok: true, message: done };
    return { ok: result.outcome !== "failed", message: result.message };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Bound to the event id. The submit button's `intent=regenerate` replaces an existing plan. */
export async function generatePlanAction(
  eventId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  if (!Id.safeParse(eventId).success) return { ok: false, message: "Unknown event." };
  const regenerate = formFields(form).intent === "regenerate";
  return run(() => service.generatePlan(eventId, { regenerate }));
}

export async function reviseTaskAction(
  eventId: string,
  suggestionId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  if (!Id.safeParse(eventId).success || !Id.safeParse(suggestionId).success) {
    return { ok: false, message: "Unknown task." };
  }
  const input = ReviseTaskInput.safeParse(formFields(form));
  if (!input.success) return { ok: false, fieldErrors: { note: [input.error.issues[0].message] } };
  return run(() => service.reviseTask(eventId, suggestionId, input.data.note));
}

export async function dismissSuggestionAction(
  eventId: string,
  suggestionId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  if (!Id.safeParse(eventId).success || !Id.safeParse(suggestionId).success) {
    return { ok: false, message: "Unknown suggestion." };
  }
  return run(() => service.dismissSuggestion(eventId, suggestionId), "Suggestion dismissed.");
}

export async function suggestFollowUpsAction(
  eventId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  if (!Id.safeParse(eventId).success) return { ok: false, message: "Unknown event." };
  return run(() => service.suggestFollowUps(eventId));
}
