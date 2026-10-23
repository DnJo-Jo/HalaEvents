import "server-only";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";
import { getEmailTransport } from "@/lib/integrations/email";
import { createMockTransport } from "@/lib/integrations/email/mock";
import type { SendResult } from "@/lib/integrations/email/types";
import { formatInZone } from "@/lib/dates";
import { listAttendees } from "@/modules/attendees/repo";
import * as eventsRepo from "@/modules/events/repo";
import type { EventRow } from "@/modules/events/repo";
import { getEventForMember } from "@/modules/events/service";
import { requireMember } from "@/modules/profiles/service";
import * as repo from "./repo";
import { draftErrors, EDITABLE, personalize } from "./rules";
import { templateDraft } from "./templates";
import { type Audience, type CommunicationKind, type DraftInput } from "./schemas";

/**
 * Communications and the approval gate (event.md §21). Drafts are written by hand or started
 * from a template (checked, saved as a draft, never sent). Sending is two-phase: claim_approval() in the
 * database (exactly once, only the reviewed payload) → transport → finish_communication().
 */

async function managerContext(eventId: string) {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const [event, role] = await Promise.all([
    eventsRepo.getEvent(db, eventId),
    eventsRepo.getRole(db, eventId, user.id),
  ]);
  if (!event || !role)
    throw new AppError("not_found", "That event doesn't exist or isn't visible to you.");
  if (role !== "owner" && role !== "organizer")
    throw new AppError(
      "forbidden",
      "Only the event's owner or organizers can manage messages and approvals.",
    );
  return { db, event, user };
}

async function communicationInEvent(
  db: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  eventId: string,
  id: string,
) {
  const c = await repo.getCommunication(db, id);
  if (!c || c.event_id !== eventId)
    throw new AppError("not_found", "That message isn't part of this event.");
  return c;
}

/** Placeholder values for one recipient. Filled in code, never by the model. */
export function messageVars(event: EventRow, name: string) {
  return {
    name,
    event_name: event.name,
    event_date: formatInZone(event.starts_at, event.timezone),
    event_city: event.city ?? "the venue",
  };
}

export async function getMessagesView(eventId: string) {
  const { event, canManage } = await getEventForMember(eventId);
  const transport = {
    name: getEmailTransport().name,
    isSimulated: getEmailTransport().isSimulated,
  };
  if (!canManage)
    return {
      event,
      canManage,
      transport,
      messages: [],
      approvals: [],
      deliveries: [],
      attendees: [],
      recipients: new Map<string, repo.Recipient[]>(),
    };
  const db = await createSupabaseServerClient();
  const [messages, approvals, deliveries, attendees] = await Promise.all([
    repo.listCommunications(db, eventId),
    repo.listApprovals(db, eventId),
    repo.listDeliveries(db, eventId),
    listAttendees(db, eventId),
  ]);
  const recipients = new Map(
    await Promise.all(
      messages
        .filter((m) => EDITABLE.includes(m.status))
        .map(async (m) => [m.id, await repo.recipients(db, m.id)] as const),
    ),
  );
  return { event, canManage, transport, messages, approvals, deliveries, attendees, recipients };
}

export async function saveDraft(
  eventId: string,
  id: string | null,
  input: DraftInput,
): Promise<string> {
  const { db } = await managerContext(eventId);
  if (id) {
    const c = await communicationInEvent(db, eventId, id);
    if (!EDITABLE.includes(c.status))
      throw new AppError("invalid_transition", `A ${c.status} message can't be edited.`);
  }
  return repo.saveCommunication(db, { id, eventId, ...input, aiRunId: null });
}

/** Starts a draft from the template for this kind of message. It is saved as a draft and never sent. */
export async function draftFromTemplate(
  eventId: string,
  input: {
    kind: CommunicationKind;
    audience: Audience;
    attendeeId: string | null;
    instructions?: string;
  },
): Promise<{ id: string | null; message: string }> {
  const { db, event } = await managerContext(eventId);
  if (event.status === "archived") throw new AppError("conflict", "This event is archived.");
  const draft = templateDraft(input.kind, input.instructions);
  const problems = draftErrors(draft);
  if (problems.length > 0) {
    return { id: null, message: `That note can't be used in a message: ${problems[0]}` };
  }
  const id = await repo.saveCommunication(db, {
    id: null,
    eventId,
    kind: input.kind,
    audience: input.audience,
    attendeeId: input.attendeeId,
    subject: draft.subject,
    body: draft.body,
    aiRunId: null,
  });
  return {
    id,
    message:
      "Draft created from the template. Fill in the parts in [brackets] and check the text before asking for approval.",
  };
}

export async function cancelMessage(eventId: string, id: string) {
  const { db } = await managerContext(eventId);
  await communicationInEvent(db, eventId, id);
  await repo.cancelCommunication(db, id);
}

export async function requestSendApproval(eventId: string, id: string) {
  const { db } = await managerContext(eventId);
  const c = await communicationInEvent(db, eventId, id);
  if (c.status !== "draft")
    throw new AppError("invalid_transition", "Only drafts can be submitted for approval.");
  return repo.requestApproval(db, "send_communication", id);
}

export async function decide(eventId: string, approvalId: string, approve: boolean, note?: string) {
  const { db } = await managerContext(eventId);
  const a = await repo.getApproval(db, approvalId);
  if (!a || a.event_id !== eventId)
    throw new AppError("not_found", "That approval isn't part of this event.");
  if (a.status !== "pending")
    throw new AppError("invalid_transition", "This approval was already decided.");
  return repo.decideApproval(db, approvalId, approve, note);
}

/**
 * Sends an approved message. Each recipient gets the approved subject/body with their placeholders
 * filled; the idempotency key is (approval, recipient), so a provider never creates two messages
 * for the same approved send. Nothing is retried automatically.
 */
export async function sendApproved(eventId: string, approvalId: string) {
  const { db, event } = await managerContext(eventId);
  const a = await repo.getApproval(db, approvalId);
  if (!a || a.event_id !== eventId || a.action_type !== "send_communication")
    throw new AppError("not_found", "That approval isn't a message of this event.");
  const message = await communicationInEvent(db, eventId, a.target_id);
  const claim = await repo.claimApproval(db, approvalId);
  if (claim.status === "superseded") {
    return {
      status: "superseded" as const,
      message:
        "The message or its recipients changed after approval, so nothing was sent. Ask for a new approval.",
    };
  }
  // A message of a simulated recovery never leaves the system: the database also enforces this.
  const transport = message.recovery_plan_id ? createMockTransport() : getEmailTransport();
  const results: Record<string, unknown>[] = [];
  for (const r of claim.payload.recipients) {
    const vars = messageVars(event, r.name);
    let res: SendResult;
    try {
      res = await transport.send({
        to: r.email,
        subject: personalize(claim.payload.subject, vars),
        text: personalize(claim.payload.body, vars),
        idempotencyKey: `${approvalId}:${r.attendee_id}`,
      });
    } catch {
      res = { status: "failed", error: "The email transport failed unexpectedly." };
    }
    results.push({
      attendee_id: r.attendee_id,
      status: res.status,
      provider_message_id: "providerMessageId" in res ? res.providerMessageId : null,
      provider_response: "providerResponse" in res ? (res.providerResponse ?? null) : null,
      error: res.status === "failed" ? res.error : null,
    });
  }
  const final = await repo.finishCommunication(db, approvalId, transport.name, results);
  const n = results.length;
  return {
    status: final,
    message: transport.isSimulated
      ? `Test send to ${n} recipient${n === 1 ? "" : "s"}: nothing was emailed.`
      : `${results.filter((r) => r.status === "accepted").length} of ${n} accepted by the email provider (delivery not confirmed yet).`,
  };
}
