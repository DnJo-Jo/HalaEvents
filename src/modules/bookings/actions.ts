"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { formFields, runAction } from "@/lib/action";
import { AppError } from "@/lib/errors";
import type { FormState } from "@/lib/forms";
import {
  DeclineQuoteInput,
  DeclineRequestInput,
  MessageInput,
  ServiceRequestStatus,
  quoteInput,
  serviceRequestInput,
} from "./schemas";
import * as service from "./service";

const Id = z.uuid();

export async function createRequestAction(_prev: FormState, form: FormData): Promise<FormState> {
  const raw = formFields(form, ["providerIds"]);
  const eventId = Id.safeParse(raw.eventId);
  if (!eventId.success) return { ok: false, message: "Choose an event." };
  let timeZone: string;
  try {
    timeZone = await service.eventTimezone(eventId.data); // also authorizes: event manager only
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
  let id: string | undefined;
  const result = await runAction(serviceRequestInput(timeZone), raw, async (data) => {
    id = await service.createRequest(data);
  });
  if (result.ok && id) redirect(`/app/requests/${id}`);
  return result;
}

export async function saveQuoteAction(_prev: FormState, form: FormData): Promise<FormState> {
  const raw = formFields(form);
  const requestId = Id.safeParse(raw.requestId);
  if (!requestId.success) return { ok: false, message: "Unknown request." };
  let timeZone: string;
  try {
    timeZone = await service.requestTimezone(requestId.data);
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
  return runAction(quoteInput(timeZone), raw, async (data) => {
    await service.saveQuote(data);
    return data.intent === "submit"
      ? "Quote sent to the organizer. It is not a booking."
      : "Draft saved. The organizer can't see drafts.";
  });
}

export async function postMessageAction(_prev: FormState, form: FormData): Promise<FormState> {
  return runAction(MessageInput, formFields(form), async (d) => {
    await service.postMessage(d.requestId, d.providerId, d.side, d.body);
    return "Message sent.";
  });
}

export async function declineRequestAction(_prev: FormState, form: FormData): Promise<FormState> {
  return runAction(DeclineRequestInput, formFields(form), async (d) => {
    await service.declineRequest(d.requestId, d.providerId, d.reason);
    return "You declined this request.";
  });
}

export async function withdrawQuoteAction(
  quoteId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  return runAction(z.object({ quoteId: Id }), { quoteId }, async (d) => {
    await service.withdrawQuote(d.quoteId);
    return "Quote withdrawn.";
  });
}

export async function declineQuoteAction(_prev: FormState, form: FormData): Promise<FormState> {
  return runAction(DeclineQuoteInput, formFields(form), async (d) => {
    await service.declineQuote(d.quoteId, d.reason);
    return "Quote declined.";
  });
}

export async function setRequestStatusAction(
  requestId: string,
  status: ServiceRequestStatus,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  return runAction(
    z.object({ requestId: Id, status: ServiceRequestStatus }),
    { requestId, status },
    async (d) => {
      await service.setRequestStatus(d.requestId, d.status);
      return d.status === "closed"
        ? "Request closed to new quotes."
        : d.status === "open"
          ? "Request reopened."
          : "Request cancelled.";
    },
  );
}
