"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { formFields } from "@/lib/action";
import { AppError } from "@/lib/errors";
import type { FormState } from "@/lib/forms";
import * as service from "./service";
import type { SearchResult } from "./service";

const unknown: FormState = { ok: false, message: "Unknown event." };

async function run(
  eventId: string,
  fn: () => Promise<{ ok: boolean; fieldErrors?: Record<string, string[]> }>,
  message: string,
): Promise<FormState> {
  if (!z.uuid().safeParse(eventId).success) return unknown;
  try {
    const r = await fn();
    if (!r.ok) return { ok: false, fieldErrors: r.fieldErrors };
    refresh();
    return { ok: true, message };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function saveServicesAction(
  eventId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return run(
    eventId,
    () => service.saveServices(eventId, formFields(form, ["services"])),
    "Services saved. Regenerate the plan to use them.",
  );
}

export async function searchVendorsAction(
  eventId: string,
  _prev: SearchResult | null,
  form: FormData,
): Promise<SearchResult> {
  if (!z.uuid().safeParse(eventId).success) return { ok: false, message: unknown.message! };
  try {
    return await service.searchVendors(eventId, formFields(form));
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function shortlistVendorAction(eventId: string, form: FormData): Promise<void> {
  await run(eventId, () => service.shortlistVendor(eventId, formFields(form)), "Shortlisted.");
}
export async function removeVendorAction(eventId: string, form: FormData): Promise<void> {
  await run(eventId, () => service.removeVendor(eventId, formFields(form)), "Removed.");
}
export async function saveVendorNoteAction(
  eventId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return run(eventId, () => service.saveVendorNote(eventId, formFields(form)), "Note saved.");
}
