import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import {
  Impact,
  IncidentStatus,
  InquiryPurpose,
  InquiryStatus,
  PlanStatus,
  RecoveryProposal,
  type PlannedChange,
} from "./schemas";
import type { InquiryDraft } from "./rules";

export const IncidentRow = z.object({
  id: z.string(),
  event_id: z.string(),
  booking_id: z.string(),
  is_simulated: z.literal(true),
  status: IncidentStatus,
  simulated_at: z.string(),
  note: z.string().nullable(),
  impact: Impact,
  resolution_note: z.string().nullable(),
  closed_at: z.string().nullable(),
  created_at: z.string(),
});
export type IncidentRow = z.infer<typeof IncidentRow>;
const INCIDENT_COLUMNS = Object.keys(IncidentRow.shape).join(", ");

export const PlanRow = z.object({
  id: z.string(),
  incident_id: z.string(),
  event_id: z.string(),
  is_mock: z.boolean(),
  proposal: RecoveryProposal,
  proposal_hash: z.string(),
  status: PlanStatus,
  status_reason: z.string().nullable(),
  applied_at: z.string().nullable(),
  created_at: z.string(),
});
export type PlanRow = z.infer<typeof PlanRow>;
const PLAN_COLUMNS = Object.keys(PlanRow.shape).join(", ");

export const ChangeRow = z.object({
  id: z.string(),
  plan_id: z.string(),
  seq: z.number(),
  kind: z.enum(["reschedule_task", "add_task", "flag_review"]),
  entity_type: z.enum(["task", "booking", "compliance_check"]).nullable(),
  entity_id: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  selected: z.boolean(),
  status: z.enum(["proposed", "applied", "skipped"]),
});
export type ChangeRow = z.infer<typeof ChangeRow>;
const CHANGE_COLUMNS = Object.keys(ChangeRow.shape).join(", ");

export const FlagRow = z.object({
  id: z.string(),
  incident_id: z.string(),
  entity_type: z.enum(["task", "booking", "compliance_check"]),
  entity_id: z.string(),
  action: z.enum(["review", "reconfirm", "reassess"]),
  reason: z.string(),
  status: z.enum(["open", "resolved"]),
  resolution_note: z.string().nullable(),
  created_at: z.string(),
});
export type FlagRow = z.infer<typeof FlagRow>;
const FLAG_COLUMNS = Object.keys(FlagRow.shape).join(", ");

export const InquiryRow = z.object({
  id: z.string(),
  incident_id: z.string(),
  plan_id: z.string(),
  provider_id: z.string(),
  booking_id: z.string().nullable(),
  purpose: InquiryPurpose,
  subject: z.string(),
  body: z.string(),
  version: z.number(),
  status: InquiryStatus,
  sent_at: z.string().nullable(),
});
export type InquiryRow = z.infer<typeof InquiryRow>;
const INQUIRY_COLUMNS = Object.keys(InquiryRow.shape).join(", ");

export const SimulatableBooking = z.object({
  booking_id: z.string(),
  provider_name: z.string(),
  status: z.string(),
  amount: z.coerce.number(),
  currency: z.string(),
  service_from: z.string(),
  service_to: z.string(),
});
export type SimulatableBooking = z.infer<typeof SimulatableBooking>;

async function rpc(db: SupabaseServerClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw fromDbError(error);
  return data as unknown;
}

async function rows<T extends z.ZodType>(
  query: PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>,
  schema: T,
): Promise<z.infer<T>[]> {
  const { data, error } = await query;
  if (error) throw fromDbError(error as Parameters<typeof fromDbError>[0]);
  return z.array(schema).parse(data) as z.infer<T>[];
}

export async function listIncidents(db: SupabaseServerClient, eventId: string) {
  const list = await rows(
    db.from("incidents").select(INCIDENT_COLUMNS).eq("event_id", eventId),
    IncidentRow,
  );
  return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getIncident(db: SupabaseServerClient, id: string) {
  const { data, error } = await db
    .from("incidents")
    .select(INCIDENT_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data ? IncidentRow.parse(data) : null;
}

export async function listPlans(db: SupabaseServerClient, incidentId: string) {
  const list = await rows(
    db.from("recovery_plans").select(PLAN_COLUMNS).eq("incident_id", incidentId),
    PlanRow,
  );
  return list.sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export const listChanges = (db: SupabaseServerClient, planId: string) =>
  rows(db.from("recovery_changes").select(CHANGE_COLUMNS).eq("plan_id", planId), ChangeRow).then(
    (l) => l.sort((a, b) => a.seq - b.seq),
  );

export const listFlags = (db: SupabaseServerClient, incidentId: string) =>
  rows(db.from("recovery_flags").select(FLAG_COLUMNS).eq("incident_id", incidentId), FlagRow);

export const listInquiries = (db: SupabaseServerClient, planId: string) =>
  rows(db.from("recovery_inquiries").select(INQUIRY_COLUMNS).eq("plan_id", planId), InquiryRow);

export const listSimulatable = (db: SupabaseServerClient, eventId: string) =>
  rpc(db, "simulatable_venue_bookings", { p_event_id: eventId }).then((d) =>
    z.array(SimulatableBooking).parse(d ?? []),
  );

export const simulate = (
  db: SupabaseServerClient,
  p: { eventId: string; bookingId: string; key: string; note: string | null },
) =>
  rpc(db, "simulate_venue_cancellation", {
    p_event_id: p.eventId,
    p_booking_id: p.bookingId,
    p_idempotency_key: p.key,
    p_note: p.note,
  }).then((d) => z.object({ id: z.string(), created: z.boolean() }).parse(d));

export const savePlan = (
  db: SupabaseServerClient,
  p: {
    incidentId: string;
    runId: string;
    proposal: RecoveryProposal;
    changes: PlannedChange[];
    inquiries: InquiryDraft[];
    attendeeDraft: { subject: string; body: string };
  },
) =>
  rpc(db, "save_recovery_plan", {
    p_incident_id: p.incidentId,
    p_ai_run_id: p.runId,
    p_proposal: p.proposal,
    p_changes: p.changes,
    p_inquiries: p.inquiries,
    p_attendee_draft: p.attendeeDraft,
  }).then((d) => z.string().parse(d));

export const setSelection = (db: SupabaseServerClient, planId: string, changeIds: string[]) =>
  rpc(db, "set_recovery_selection", { p_plan_id: planId, p_change_ids: changeIds });
export const rejectPlan = (db: SupabaseServerClient, planId: string, reason: string) =>
  rpc(db, "reject_recovery_plan", { p_plan_id: planId, p_reason: reason });
export const closeIncident = (
  db: SupabaseServerClient,
  id: string,
  outcome: "resolved" | "dismissed",
  note: string,
) => rpc(db, "close_incident", { p_incident_id: id, p_outcome: outcome, p_note: note });
export const resolveFlag = (db: SupabaseServerClient, id: string, note: string) =>
  rpc(db, "resolve_recovery_flag", { p_flag_id: id, p_note: note });
export const updateInquiry = (
  db: SupabaseServerClient,
  id: string,
  subject: string,
  body: string,
) => rpc(db, "update_recovery_inquiry", { p_id: id, p_subject: subject, p_body: body });
export const discardInquiry = (db: SupabaseServerClient, id: string) =>
  rpc(db, "discard_recovery_inquiry", { p_id: id });
export const executeApply = (db: SupabaseServerClient, approvalId: string) =>
  rpc(db, "execute_recovery_approval", { p_approval_id: approvalId }).then((d) =>
    z.enum(["executed", "superseded"]).parse(d),
  );
export const executeInquiry = (db: SupabaseServerClient, approvalId: string) =>
  rpc(db, "execute_inquiry_approval", { p_approval_id: approvalId }).then((d) =>
    z.enum(["executed", "superseded"]).parse(d),
  );
