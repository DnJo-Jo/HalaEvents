"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formFields, runAction } from "@/lib/action";
import { AppError } from "@/lib/errors";
import type { FormState } from "@/lib/forms";
import { IanaTimezone } from "@/lib/schemas/common";
import { ChangeEventStatusInput, eventFormInput } from "./schemas";
import * as service from "./service";

export async function createEventAction(_prev: FormState, form: FormData): Promise<FormState> {
  const raw = formFields(form);
  const tz = IanaTimezone.safeParse(raw.timezone);
  let id: string | undefined;
  const result = await runAction(
    eventFormInput(tz.success ? tz.data : "Asia/Dubai"),
    raw,
    async (data) => {
      id = await service.createEvent(data);
    },
  );
  if (result.ok && id) redirect(`/app/events/${id}`);
  return result;
}

/** Bound to the event id on the interview page. */
export async function saveInterviewAction(
  eventId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  if (!z.uuid().safeParse(eventId).success) return { ok: false, message: "Unknown event." };
  try {
    // Every field keeps all its values: multi-choice answers and the `round` key list are arrays.
    const keys = [...new Set(form.keys())].filter((k) => !k.startsWith("$ACTION"));
    const result = await service.saveInterview(eventId, formFields(form, keys));
    if (!result.ok) return { ok: false, fieldErrors: result.fieldErrors };
    refresh();
    return {
      ok: true,
      message: result.complete
        ? "Answers saved. Every playbook question is answered."
        : "Answers saved. Follow-up questions may have appeared.",
    };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}

/** "Additional event details" form on the interview page (bound to the event id). */
export async function saveEventDetailsAction(
  eventId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  if (!z.uuid().safeParse(eventId).success) return { ok: false, message: "Unknown event." };
  try {
    const result = await service.saveEventDetails(eventId, formFields(form));
    if (!result.ok) return { ok: false, fieldErrors: result.fieldErrors };
    refresh();
    return {
      ok: true,
      message: result.cleared
        ? "Additional details removed."
        : "Additional details saved. Regenerate the plan to use them.",
    };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function updateEventAction(
  eventId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  if (!z.uuid().safeParse(eventId).success) return { ok: false, message: "Unknown event." };
  const raw = formFields(form);
  const tz = IanaTimezone.safeParse(raw.timezone);
  return runAction(eventFormInput(tz.success ? tz.data : "Asia/Dubai"), raw, async (data) => {
    await service.updateEvent(eventId, data);
    return "Event details saved.";
  });
}

export async function changeEventStatusAction(
  eventId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  if (!z.uuid().safeParse(eventId).success) return { ok: false, message: "Unknown event." };
  return runAction(ChangeEventStatusInput, formFields(form), async ({ status }) => {
    await service.changeEventStatus(eventId, status);
    return "Event status updated.";
  });
}
