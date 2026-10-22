"use server";

import { redirect } from "next/navigation";
import { formFields, runAction } from "@/lib/action";
import type { FormState } from "@/lib/forms";
import { IanaTimezone } from "@/lib/schemas/common";
import { eventFormInput } from "./schemas";
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
