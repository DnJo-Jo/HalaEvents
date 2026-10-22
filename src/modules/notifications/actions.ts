"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import type { FormState } from "@/lib/forms";
import * as service from "./service";

const Id = z.uuid();

/** Bound to one notification id, or null for "mark all as read". */
export async function markReadAction(
  id: string | null,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  if (id !== null && !Id.safeParse(id).success)
    return { ok: false, message: "Unknown notification." };
  try {
    const n = await service.markNotificationsRead(id === null ? null : [id]);
    refresh();
    return { ok: true, message: n === 1 ? "Marked as read." : `${n} marked as read.` };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function refreshRemindersAction(
  eventId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  if (!Id.safeParse(eventId).success) return { ok: false, message: "Unknown event." };
  try {
    const n = await service.refreshReminders(eventId);
    refresh();
    return {
      ok: true,
      message:
        n === 0
          ? "No new reminders."
          : `${n} new reminder${n === 1 ? "" : "s"} sent to your team's inboxes.`,
    };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}
