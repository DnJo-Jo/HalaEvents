import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import {
  ApprovalAction,
  ApprovalStatus,
  Audience,
  CommunicationKind,
  CommunicationStatus,
  DeliveryStatus,
} from "./schemas";

export const CommunicationRow = z.object({
  id: z.string(),
  event_id: z.string(),
  kind: CommunicationKind,
  audience: Audience,
  attendee_id: z.string().nullable(),
  subject: z.string(),
  body: z.string(),
  status: CommunicationStatus,
  drafted_by: z.enum(["organizer", "ai"]),
  is_mock_draft: z.boolean(),
  recovery_plan_id: z.string().nullable(),
  version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  sent_at: z.string().nullable(),
});
export type CommunicationRow = z.infer<typeof CommunicationRow>;
const COMM_COLUMNS = Object.keys(CommunicationRow.shape).join(", ");

export const Recipient = z.object({ attendee_id: z.string(), email: z.string(), name: z.string() });
export type Recipient = z.infer<typeof Recipient>;

export const ApprovalRow = z.object({
  id: z.string(),
  event_id: z.string(),
  action_type: ApprovalAction,
  target_id: z.string(),
  recipient_summary: z.string(),
  payload: z.record(z.string(), z.unknown()),
  payload_hash: z.string(),
  status: ApprovalStatus,
  requested_by: z.string().nullable(),
  requested_at: z.string(),
  decided_by: z.string().nullable(),
  decided_at: z.string().nullable(),
  decision_note: z.string().nullable(),
  executed_by: z.string().nullable(),
  executed_at: z.string().nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  failure_reason: z.string().nullable(),
});
export type ApprovalRow = z.infer<typeof ApprovalRow>;
const APPROVAL_COLUMNS = Object.keys(ApprovalRow.shape).join(", ");

export const DeliveryRow = z.object({
  id: z.string(),
  communication_id: z.string(),
  approval_id: z.string(),
  attendee_id: z.string().nullable(),
  email: z.string(),
  transport: z.enum(["mock", "resend"]),
  status: DeliveryStatus,
  is_simulated: z.boolean(),
  provider_message_id: z.string().nullable(),
  error: z.string().nullable(),
  attempted_at: z.string(),
});
export type DeliveryRow = z.infer<typeof DeliveryRow>;
const DELIVERY_COLUMNS = Object.keys(DeliveryRow.shape).join(", ");

async function rpc(db: SupabaseServerClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw fromDbError(error);
  return data as unknown;
}

export async function listCommunications(db: SupabaseServerClient, eventId: string) {
  const { data, error } = await db
    .from("communications")
    .select(COMM_COLUMNS)
    .eq("event_id", eventId);
  if (error) throw fromDbError(error);
  return z
    .array(CommunicationRow)
    .parse(data)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

export async function getCommunication(db: SupabaseServerClient, id: string) {
  const { data, error } = await db
    .from("communications")
    .select(COMM_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data ? CommunicationRow.parse(data) : null;
}

export const recipients = (db: SupabaseServerClient, id: string) =>
  rpc(db, "communication_recipients", { p_communication_id: id }).then((d) =>
    z.array(Recipient).parse(d ?? []),
  );

export const saveCommunication = (
  db: SupabaseServerClient,
  p: {
    id: string | null;
    eventId: string;
    kind: string;
    audience: string;
    attendeeId: string | null;
    subject: string;
    body: string;
    aiRunId: string | null;
  },
) =>
  rpc(db, "save_communication", {
    p_id: p.id,
    p_event_id: p.eventId,
    p_kind: p.kind,
    p_audience: p.audience,
    p_attendee_id: p.attendeeId,
    p_subject: p.subject,
    p_body: p.body,
    p_ai_run_id: p.aiRunId,
  }).then((d) => z.string().parse(d));

export const cancelCommunication = (db: SupabaseServerClient, id: string) =>
  rpc(db, "cancel_communication", { p_id: id });

export async function listApprovals(db: SupabaseServerClient, eventId: string) {
  const { data, error } = await db
    .from("approvals")
    .select(APPROVAL_COLUMNS)
    .eq("event_id", eventId);
  if (error) throw fromDbError(error);
  return z
    .array(ApprovalRow)
    .parse(data)
    .sort((a, b) => b.requested_at.localeCompare(a.requested_at));
}

export async function getApproval(db: SupabaseServerClient, id: string) {
  const { data, error } = await db
    .from("approvals")
    .select(APPROVAL_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data ? ApprovalRow.parse(data) : null;
}

export async function listDeliveries(db: SupabaseServerClient, eventId: string) {
  const { data, error } = await db
    .from("communication_deliveries")
    .select(DELIVERY_COLUMNS)
    .eq("event_id", eventId);
  if (error) throw fromDbError(error);
  return z.array(DeliveryRow).parse(data);
}

export const requestApproval = (db: SupabaseServerClient, action: string, targetId: string) =>
  rpc(db, "request_approval", { p_action_type: action, p_target_id: targetId }).then((d) =>
    z.string().parse(d),
  );

export const decideApproval = (
  db: SupabaseServerClient,
  id: string,
  approve: boolean,
  note?: string,
) =>
  rpc(db, "decide_approval", { p_approval_id: id, p_approve: approve, p_note: note ?? null }).then(
    (d) => z.enum(["approved", "rejected", "superseded"]).parse(d),
  );

const Claim = z.union([
  z.object({ status: z.literal("superseded") }),
  z.object({
    status: z.literal("executing"),
    payload_hash: z.string(),
    payload: z.object({
      communication_id: z.string(),
      subject: z.string(),
      body: z.string(),
      recipients: z.array(Recipient),
    }),
  }),
]);
export const claimApproval = (db: SupabaseServerClient, id: string) =>
  rpc(db, "claim_approval", { p_approval_id: id }).then((d) => Claim.parse(d));

export const finishCommunication = (
  db: SupabaseServerClient,
  approvalId: string,
  transport: "mock" | "resend",
  results: Record<string, unknown>[],
) =>
  rpc(db, "finish_communication", {
    p_approval_id: approvalId,
    p_transport: transport,
    p_results: results,
  }).then((d) => z.enum(["sent", "partially_failed", "failed"]).parse(d));
