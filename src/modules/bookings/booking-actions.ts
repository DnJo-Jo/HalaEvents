"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { formFields } from "@/lib/action";
import { optionalText } from "@/lib/schemas/common";
import { AppError } from "@/lib/errors";
import type { FormState } from "@/lib/forms";
import { BOOKING_STATUSES } from "./booking-rules";
import * as service from "./booking-service";

const Id = z.uuid();
const ids = (...values: string[]) => values.every((v) => Id.safeParse(v).success);
const unknown = { ok: false, message: "Unknown booking." } satisfies FormState;
const ActionInput = z.object({ to: z.enum(BOOKING_STATUSES), reason: optionalText(1000) });
const Reason = z.object({
  reason: z.string().trim().min(5, { message: "Give a reason (at least 5 characters)." }).max(1000),
});

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

export async function proposeBookingAction(
  quoteId: string,
  _prev: FormState,
  form: FormData,
): Promise<FormState> {
  if (!ids(quoteId)) return unknown;
  const note = optionalText(1000).safeParse(formFields(form).note);
  let eventId: string | undefined;
  const r = await plain(async () => {
    ({ eventId } = await service.proposeBooking(quoteId, note.success ? note.data : undefined));
    return "Booking proposed. Nothing is booked yet.";
  });
  if (r.ok && eventId) redirect(`/app/events/${eventId}/bookings`);
  return r;
}

export async function requestBookingApprovalAction(
  eventId: string,
  id: string,
  _prev: FormState,
  _form: FormData,
) {
  if (!ids(eventId, id)) return unknown;
  return plain(async () => {
    await service.requestBookingApproval(eventId, id);
    return "Approval requested for the exact terms shown.";
  });
}

export async function requestCancellationAction(
  eventId: string,
  id: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, id)) return unknown;
  const parsed = Reason.safeParse(formFields(form));
  if (!parsed.success)
    return { ok: false, fieldErrors: { reason: [parsed.error.issues[0].message] } };
  return plain(async () => {
    await service.requestCancellation(eventId, id, parsed.data.reason);
    return "Cancellation approval requested. The booking stays confirmed until it is approved and executed.";
  });
}

export async function executeBookingApprovalAction(
  eventId: string,
  approvalId: string,
  _prev: FormState,
  _form: FormData,
) {
  if (!ids(eventId, approvalId)) return unknown;
  try {
    const r = await service.executeApproval(eventId, approvalId);
    refresh();
    return r === "superseded"
      ? {
          ok: false,
          message:
            "The booking changed after approval, so nothing was sent. Request a new approval.",
        }
      : { ok: true, message: "Done. The provider sees it in their bookings (in-app)." };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function organizerBookingAction(
  eventId: string,
  id: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, id)) return unknown;
  const parsed = ActionInput.safeParse(formFields(form));
  if (!parsed.success) return { ok: false, message: "Choose an action." };
  return plain(async () => {
    await service.organizerAction(eventId, id, parsed.data.to, parsed.data.reason);
    return "Booking updated.";
  });
}

export async function providerBookingAction(id: string, _prev: FormState, form: FormData) {
  if (!ids(id)) return unknown;
  const parsed = ActionInput.safeParse(formFields(form));
  if (!parsed.success) return { ok: false, message: "Choose an action." };
  return plain(async () => {
    await service.providerAction(id, parsed.data.to, parsed.data.reason);
    return parsed.data.to === "confirmed"
      ? "Booking confirmed. The organizer was notified."
      : "Booking updated.";
  });
}

export async function resolveDisputeAction(id: string, _prev: FormState, form: FormData) {
  if (!ids(id)) return unknown;
  const parsed = ActionInput.extend({ reason: z.string().trim().min(5).max(1000) }).safeParse(
    formFields(form),
  );
  if (!parsed.success)
    return { ok: false, message: "Choose an outcome and give a reason (5+ characters)." };
  return plain(async () => {
    await service.resolveDispute(id, parsed.data.to, parsed.data.reason);
    return "Dispute resolved.";
  });
}
