"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { formFields, runAction } from "@/lib/action";
import { AppError } from "@/lib/errors";
import type { FormState } from "@/lib/forms";
import { decide } from "@/modules/comms/service";
import { DecisionInput } from "@/modules/comms/schemas";
import { CloseInput, InquiryEditInput, ReasonInput, SimulateInput } from "./schemas";
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

export async function simulateAction(eventId: string, _prev: FormState, form: FormData) {
  if (!ids(eventId)) return unknown;
  const parsed = SimulateInput.safeParse(formFields(form));
  if (!parsed.success) return { ok: false, message: "Choose a venue booking." };
  return plain(async () => {
    const r = await service.simulate(eventId, {
      ...parsed.data,
      note: parsed.data.note ?? null,
    });
    return { message: r.message };
  });
}

export async function generateRecoveryAction(
  eventId: string,
  incidentId: string,
  _prev: FormState,
  _form: FormData,
) {
  if (!ids(eventId, incidentId)) return unknown;
  return plain(async () => {
    const r = await service.generateRecovery(eventId, incidentId);
    return { ok: true, message: r.message };
  });
}

/** The checked boxes of the plan form are the selection. */
export async function selectChangesAction(
  eventId: string,
  planId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, planId)) return unknown;
  const parsed = z
    .array(z.uuid())
    .max(200)
    .safeParse(formFields(form, ["changeId"]).changeId);
  if (!parsed.success) return { ok: false, message: "Some selected changes aren't valid." };
  return plain(async () => {
    await service.selectChanges(eventId, planId, parsed.data);
    return {
      message: `${parsed.data.length} change(s) selected. Any earlier approval no longer applies.`,
    };
  });
}

export async function rejectPlanAction(
  eventId: string,
  planId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, planId)) return unknown;
  return runAction(ReasonInput, formFields(form), async (d) => {
    await service.rejectPlan(eventId, planId, d.reason);
    return "Proposal rejected. Nothing was applied.";
  });
}

export async function closeIncidentAction(
  eventId: string,
  incidentId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, incidentId)) return unknown;
  return runAction(CloseInput, formFields(form), async (d) => {
    await service.closeIncident(eventId, incidentId, d.outcome, d.reason);
    return d.outcome === "resolved" ? "Incident resolved." : "Incident dismissed.";
  });
}

export async function resolveFlagAction(
  eventId: string,
  flagId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, flagId)) return unknown;
  return runAction(ReasonInput, formFields(form), async (d) => {
    await service.resolveFlag(eventId, flagId, d.reason);
    return "Marked as handled.";
  });
}

export async function editInquiryAction(
  eventId: string,
  inquiryId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, inquiryId)) return unknown;
  return runAction(InquiryEditInput, formFields(form), async (d) => {
    await service.editInquiry(eventId, inquiryId, d.subject, d.body);
    return "Inquiry saved. Any earlier approval no longer applies.";
  });
}

export async function discardInquiryAction(
  eventId: string,
  inquiryId: string,
  _prev: FormState,
  _form: FormData,
) {
  if (!ids(eventId, inquiryId)) return unknown;
  return plain(async () => {
    await service.discardInquiry(eventId, inquiryId);
    return { message: "Inquiry discarded." };
  });
}

export async function requestApprovalAction(
  eventId: string,
  action: "apply_recovery" | "send_provider_inquiry",
  targetId: string,
  _prev: FormState,
  _form: FormData,
) {
  if (!ids(eventId, targetId)) return unknown;
  return plain(async () => {
    await service.requestApproval(eventId, action, targetId);
    return { message: "Approval requested. The exact content was saved for review." };
  });
}

export async function decideAction(
  eventId: string,
  approvalId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, approvalId)) return unknown;
  const parsed = DecisionInput.safeParse(formFields(form));
  if (!parsed.success) return { ok: false, message: "Choose approve or reject." };
  return plain(async () => {
    const r = await decide(
      eventId,
      approvalId,
      parsed.data.decision === "approve",
      parsed.data.note,
    );
    return r === "superseded"
      ? {
          ok: false,
          message: "The content changed since this was requested. Request a new approval.",
        }
      : { message: r === "approved" ? "Approved. Nothing has been applied yet." : "Rejected." };
  });
}

export async function applyApprovedAction(
  eventId: string,
  approvalId: string,
  _prev: FormState,
  _form: FormData,
) {
  if (!ids(eventId, approvalId)) return unknown;
  return plain(async () => ({ message: await service.applyApproved(eventId, approvalId) }));
}

export async function recordInquiryAction(
  eventId: string,
  approvalId: string,
  _prev: FormState,
  _form: FormData,
) {
  if (!ids(eventId, approvalId)) return unknown;
  return plain(async () => ({ message: await service.recordInquiryApproved(eventId, approvalId) }));
}
