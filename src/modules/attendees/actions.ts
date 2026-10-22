"use server";

import { headers } from "next/headers";
import { refresh } from "next/cache";
import { z } from "zod";
import { formFields, runAction } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { fieldErrorsOf, type FormState } from "@/lib/forms";
import { allowRequest } from "@/lib/rate-limit";
import {
  AddAttendeeInput,
  ParticipationInput,
  PublicRegistrationInput,
  RegistrationSettingsInput,
  ReviewInput,
  WithdrawInput,
} from "./schemas";
import * as service from "./service";

const Id = z.uuid();
const ids = (...values: string[]) => values.every((v) => Id.safeParse(v).success);
const unknown = { ok: false, message: "Unknown item." } satisfies FormState;

export async function addAttendeeAction(eventId: string, _prev: FormState, form: FormData) {
  if (!ids(eventId)) return unknown;
  return runAction(AddAttendeeInput, formFields(form), async (data) => {
    await service.addAttendee(eventId, data);
    return data.registered ? "Added as registered." : "Added as invited.";
  });
}

export async function participationAction(
  eventId: string,
  id: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, id)) return unknown;
  return runAction(ParticipationInput, formFields(form), async ({ status, reason }) => {
    await service.setParticipation(eventId, id, status, reason);
    return "Participation updated.";
  });
}

export async function reviewAction(eventId: string, id: string, _prev: FormState, form: FormData) {
  if (!ids(eventId, id)) return unknown;
  return runAction(ReviewInput, formFields(form), async ({ status, reason }) => {
    await service.setReview(eventId, id, status, reason);
    return "Application review updated.";
  });
}

export async function withdrawAction(
  eventId: string,
  id: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, id)) return unknown;
  return runAction(WithdrawInput, formFields(form), async ({ reason }) => {
    await service.withdraw(eventId, id, reason);
    return "Registration withdrawn; the place is free again.";
  });
}

export async function registrationSettingsAction(
  eventId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId)) return unknown;
  return runAction(RegistrationSettingsInput, formFields(form), async (data) => {
    await service.updateRegistrationSettings(eventId, data);
    return "Registration settings saved.";
  });
}

/**
 * One message for every outcome, so the form never reveals whether an email was already registered.
 * People learn whether they got a place from the acceptance/waitlist notice (approval-gated, §21).
 */
const RECEIVED =
  "Thank you — your registration was received. The organizers will email you about your place.";

export async function registerAction(
  slug: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (!allowRequest(`register:${ip}`, 10, 10 * 60_000)) {
    return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };
  }
  const parsed = PublicRegistrationInput.safeParse(formFields(form));
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  try {
    await service.registerPublic(slug, parsed.data);
    refresh();
    return { ok: true, message: RECEIVED };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}
