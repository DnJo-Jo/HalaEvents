"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import type { FormState } from "@/lib/forms";
import * as service from "./service";

async function run(eventId: string, fn: () => Promise<string>): Promise<FormState> {
  if (!z.uuid().safeParse(eventId).success) return { ok: false, message: "Unknown event." };
  try {
    const message = await fn();
    refresh();
    return { ok: true, message };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function checkRepliesAction(
  eventId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  return run(eventId, async () => {
    const { added, seen } = await service.checkReplies(eventId);
    if (added > 0) return `${added} new vendor ${added === 1 ? "reply" : "replies"} received.`;
    return seen > 0
      ? "No new replies. Everything is already shown below."
      : "No replies for this event yet.";
  });
}

export async function analyzeReplyAction(
  eventId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  return run(eventId, async () => {
    const replyId = String(form.get("replyId") ?? "");
    if (!z.uuid().safeParse(replyId).success) throw new AppError("not_found", "Unknown reply.");
    await service.analyzeReply(eventId, replyId);
    return "Reply analyzed. Check the details against the email before relying on them.";
  });
}

export async function disconnectGmailAction(
  eventId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  return run(eventId, async () => {
    await service.disconnectGmail(eventId);
    return "Gmail disconnected.";
  });
}
