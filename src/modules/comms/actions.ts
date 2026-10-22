"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { formFields, runAction } from "@/lib/action";
import { AppError } from "@/lib/errors";
import type { FormState } from "@/lib/forms";
import { AiDraftInput, DecisionInput, DraftInput } from "./schemas";
import * as service from "./service";

const Id = z.uuid();
const ids = (...values: string[]) => values.every((v) => Id.safeParse(v).success);
const unknown = { ok: false, message: "Unknown item." } satisfies FormState;

async function plain(fn: () => Promise<{ ok?: boolean; message: string }>): Promise<FormState> {
  try {
    const r = await fn();
    refresh();
    return { ok: r.ok ?? true, message: r.message };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Bound to the message id, or null for a new draft. */
export async function saveDraftAction(
  eventId: string,
  id: string | null,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId) || (id !== null && !ids(id))) return unknown;
  return runAction(DraftInput, formFields(form), async (data) => {
    await service.saveDraft(eventId, id, data);
    return id ? "Draft saved. Any earlier approval no longer applies." : "Draft saved.";
  });
}

export async function aiDraftAction(eventId: string, _prev: FormState, form: FormData) {
  if (!ids(eventId)) return unknown;
  const parsed = AiDraftInput.safeParse(formFields(form));
  if (!parsed.success) return { ok: false, message: parsed.error.issues[0].message };
  return plain(async () => {
    const r = await service.draftWithAi(eventId, parsed.data);
    return { ok: r.id !== null, message: r.message };
  });
}

export async function cancelMessageAction(
  eventId: string,
  id: string,
  _prev: FormState,
  _form: FormData,
) {
  if (!ids(eventId, id)) return unknown;
  return plain(async () => {
    await service.cancelMessage(eventId, id);
    return { message: "Message cancelled." };
  });
}

export async function requestSendApprovalAction(
  eventId: string,
  id: string,
  _prev: FormState,
  _form: FormData,
) {
  if (!ids(eventId, id)) return unknown;
  return plain(async () => {
    await service.requestSendApproval(eventId, id);
    return {
      message: "Approval requested. The exact text and recipient list were saved for review.",
    };
  });
}

export async function decideApprovalAction(
  eventId: string,
  approvalId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, approvalId)) return unknown;
  const parsed = DecisionInput.safeParse(formFields(form));
  if (!parsed.success) return { ok: false, message: "Choose approve or reject." };
  return plain(async () => {
    const r = await service.decide(
      eventId,
      approvalId,
      parsed.data.decision === "approve",
      parsed.data.note,
    );
    return r === "superseded"
      ? {
          ok: false,
          message:
            "The content changed since this was requested, so it can't be approved. Request a new approval.",
        }
      : { message: r === "approved" ? "Approved. Nothing has been sent yet." : "Rejected." };
  });
}

export async function sendApprovedAction(
  eventId: string,
  approvalId: string,
  _prev: FormState,
  _form: FormData,
) {
  if (!ids(eventId, approvalId)) return unknown;
  return plain(async () => {
    const r = await service.sendApproved(eventId, approvalId);
    return { ok: r.status === "sent" || r.status === "partially_failed", message: r.message };
  });
}
