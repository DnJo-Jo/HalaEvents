"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formFields, runAction } from "@/lib/action";
import { AppError } from "@/lib/errors";
import type { FormState } from "@/lib/forms";
import { refreshReminders } from "@/modules/notifications/service";
import {
  AssignReviewerInput,
  ChangeStatusInput,
  CreateCheckInput,
  EvidenceInput,
  ReferenceInput,
  SimulatedResponseInput,
  SourceVerificationInput,
  UpdateCheckInput,
} from "./schemas";
import * as service from "./service";

const Id = z.uuid();
const ids = (...values: string[]) => values.every((v) => Id.safeParse(v).success);
const unknown = { ok: false, message: "Unknown item." } satisfies FormState;

async function plain(fn: () => Promise<string>): Promise<FormState> {
  try {
    const message = await fn();
    refresh();
    return { ok: true, message };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function runChecksAction(eventId: string, _prev: FormState, _form: FormData) {
  if (!ids(eventId)) return unknown;
  return plain(async () => {
    const n = await service.runChecks(eventId);
    await refreshReminders(eventId).catch(() => 0);
    return n === 0
      ? "No new or changed checks."
      : `${n} check${n === 1 ? "" : "s"} added or updated.`;
  });
}

export async function createCheckAction(eventId: string, _prev: FormState, form: FormData) {
  if (!ids(eventId)) return unknown;
  let id: string | undefined;
  const result = await runAction(CreateCheckInput, formFields(form), async (data) => {
    id = await service.createCheck(eventId, data);
  });
  if (result.ok && id) redirect(`/app/events/${eventId}/compliance/${id}`);
  return result;
}

export async function changeCheckStatusAction(
  eventId: string,
  checkId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, checkId)) return unknown;
  return runAction(ChangeStatusInput, formFields(form), async ({ status, reason }) => {
    await service.changeStatus(eventId, checkId, status, reason);
    return "Status changed. Your team was notified.";
  });
}

export async function updateCheckAction(
  eventId: string,
  checkId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, checkId)) return unknown;
  return runAction(UpdateCheckInput, formFields(form), async (data) => {
    await service.updateCheck(eventId, checkId, data);
    return "Saved.";
  });
}

export async function assignReviewerAction(
  eventId: string,
  checkId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, checkId)) return unknown;
  return runAction(AssignReviewerInput, formFields(form), async ({ reviewerUserId }) => {
    await service.assignReviewer(eventId, checkId, reviewerUserId);
    return reviewerUserId ? "Reviewer assigned." : "Reviewer removed.";
  });
}

export async function addReferenceAction(
  eventId: string,
  checkId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, checkId)) return unknown;
  return runAction(ReferenceInput, formFields(form), async ({ sourceId, note }) => {
    await service.addReference(eventId, checkId, sourceId, note);
    return "Source referenced.";
  });
}

export async function addEvidenceAction(
  eventId: string,
  checkId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, checkId)) return unknown;
  return runAction(EvidenceInput, formFields(form), async ({ kind, value }) => {
    await service.addEvidence(eventId, checkId, kind, value);
    return "Evidence recorded.";
  });
}

export async function simulateSubmissionAction(
  eventId: string,
  checkId: string,
  _prev: FormState,
  _form: FormData,
) {
  if (!ids(eventId, checkId)) return unknown;
  return plain(async () => {
    await service.simulateSubmission(eventId, checkId);
    return "Simulated submission recorded (demonstration only: nothing was sent).";
  });
}

export async function recordSimulatedResponseAction(
  eventId: string,
  checkId: string,
  submissionId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, checkId, submissionId)) return unknown;
  return runAction(SimulatedResponseInput, formFields(form), async ({ summary }) => {
    await service.recordSimulatedResponse(eventId, checkId, submissionId, summary);
    return "Simulated response recorded.";
  });
}

export async function setSourceVerificationAction(
  sourceId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(sourceId)) return unknown;
  return runAction(SourceVerificationInput, formFields(form), async ({ verified, note }) => {
    await service.setSourceVerification(sourceId, verified, note);
    return verified ? "Marked as verified by you, today." : "Verification withdrawn.";
  });
}
