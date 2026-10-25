"use server";

import { z } from "zod";
import { formFields } from "@/lib/action";
import { AppError } from "@/lib/errors";
import { draftVendorEmail } from "./service";
import type { DraftResult } from "./schemas";

/** Form value for the recipient picker: "<category>" or "<category>|<placeId>". */
function parseTarget(value: unknown): { category: string; placeId?: string } {
  const [category, placeId] = String(value ?? "").split("|");
  return { category, ...(placeId ? { placeId } : {}) };
}

/** Writes one draft per explicit click; "template" never contacts the AI service. */
export async function draftEmailAction(
  eventId: string,
  _prev: DraftResult | null,
  form: FormData,
): Promise<DraftResult> {
  if (!z.uuid().safeParse(eventId).success) return { ok: false, message: "Unknown event." };
  const f = formFields(form, []);
  const mode = form.get("mode") === "template" ? "template" : "custom";
  try {
    return await draftVendorEmail(eventId, parseTarget(f.target), mode);
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}
