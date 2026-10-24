"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { formFields } from "@/lib/action";
import { AppError } from "@/lib/errors";
import type { FormState } from "@/lib/forms";
import * as service from "./service";
import type { PlanActionResult } from "./service";

const Id = z.uuid();

async function run(
  fn: () => Promise<PlanActionResult | void>,
  done = "Saved.",
): Promise<FormState> {
  try {
    const result = await fn();
    refresh();
    if (!result) return { ok: true, message: done };
    return { ok: true, message: result.message };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}

/**
 * Bound to the event id. The submit button's `intent=regenerate` replaces an existing plan, and
 * `mode=custom` asks for a generated draft instead of the template (the default).
 */
export async function generatePlanAction(
  eventId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  if (!Id.safeParse(eventId).success) return { ok: false, message: "Unknown event." };
  const fields = formFields(form);
  const regenerate = fields.intent === "regenerate";
  const mode = fields.mode === "custom" ? "custom" : "template";
  return run(() => service.generatePlan(eventId, { regenerate, mode }));
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
