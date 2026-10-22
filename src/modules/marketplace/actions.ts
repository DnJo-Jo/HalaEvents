"use server";

import { z } from "zod";
import { formFields, runAction } from "@/lib/action";
import type { FormState } from "@/lib/forms";
import { ShortlistInput } from "./schemas";
import * as service from "./service";

export async function addToShortlistAction(_prev: FormState, form: FormData): Promise<FormState> {
  return runAction(ShortlistInput, formFields(form), async (d) => {
    await service.addToShortlist(d.eventId, d.providerId, d.note);
    return "Added to the event's shortlist.";
  });
}

export async function removeFromShortlistAction(
  eventId: string,
  providerId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  return runAction(
    z.object({ eventId: z.uuid(), providerId: z.uuid() }),
    { eventId, providerId },
    async (d) => {
      await service.removeFromShortlist(d.eventId, d.providerId);
      return "Removed from the shortlist.";
    },
  );
}
