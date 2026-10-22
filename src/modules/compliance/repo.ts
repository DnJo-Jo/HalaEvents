import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import {
  Applicability,
  ComplianceCategory,
  ComplianceStatus,
  EvidenceKind,
  Severity,
  type ComplianceItem,
} from "./schemas";

export const SourceRow = z.object({
  id: z.string(),
  key: z.string(),
  url: z.string(),
  title: z.string(),
  authority: z.string(),
  jurisdiction: z.string(),
  scope: z.string(),
  source_type: z.string(),
  summary: z.string(),
  summary_kind: z.enum(["none", "search_result_summary", "page_excerpt", "team_paraphrase"]),
  retrieval_status: z.enum(["not_retrieved", "retrieved", "blocked", "not_found"]),
  retrieved_at: z.string().nullable(),
  retrieval_note: z.string(),
  last_verified_at: z.string().nullable(),
  verification_note: z.string().nullable(),
});
export type SourceRow = z.infer<typeof SourceRow>;
const SOURCE_COLUMNS = Object.keys(SourceRow.shape).join(", ");

export const CheckRow = z.object({
  id: z.string(),
  event_id: z.string(),
  topic_key: z.string(),
  category: ComplianceCategory,
  title: z.string(),
  description: z.string(),
  reason: z.string(),
  origin: z.enum(["rule", "organizer"]),
  severity: Severity,
  applicability: Applicability,
  status: ComplianceStatus,
  status_reason: z.string().nullable(),
  status_set_by: z.string().nullable(),
  status_changed_at: z.string().nullable(),
  reviewer_user_id: z.string().nullable(),
  next_action: z.string().nullable(),
  official_channel_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CheckRow = z.infer<typeof CheckRow>;
const CHECK_COLUMNS = Object.keys(CheckRow.shape).join(", ");

const ReferenceRow = z.object({
  id: z.string(),
  check_id: z.string(),
  source_id: z.string(),
  relevance_note: z.string(),
  created_at: z.string(),
});
const EvidenceRow = z.object({
  id: z.string(),
  check_id: z.string(),
  kind: EvidenceKind,
  value: z.string(),
  is_simulated: z.boolean(),
  recorded_by: z.string().nullable(),
  recorded_at: z.string(),
});
export type EvidenceRow = z.infer<typeof EvidenceRow>;
const SubmissionRow = z.object({
  id: z.string(),
  check_id: z.string(),
  authority: z.string(),
  reference: z.string(),
  status: z.enum(["submitted", "response_recorded"]),
  is_simulated: z.literal(true),
  response_summary: z.string().nullable(),
  submitted_at: z.string(),
  responded_at: z.string().nullable(),
});
export type SubmissionRow = z.infer<typeof SubmissionRow>;

const HistoryRow = z.object({
  at: z.string(),
  actor_kind: z.string(),
  actor_name: z.string(),
  entity_type: z.string(),
  entity_id: z.string(),
  action: z.string(),
  details: z.record(z.string(), z.unknown()),
});
export type HistoryRow = z.infer<typeof HistoryRow>;

async function rpc(db: SupabaseServerClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw fromDbError(error);
  return data as unknown;
}

export async function listSources(db: SupabaseServerClient): Promise<SourceRow[]> {
  const { data, error } = await db.from("knowledge_sources").select(SOURCE_COLUMNS);
  if (error) throw fromDbError(error);
  return z
    .array(SourceRow)
    .parse(data)
    .sort((a, b) => a.authority.localeCompare(b.authority) || a.title.localeCompare(b.title));
}

export async function listChecks(db: SupabaseServerClient, eventId: string): Promise<CheckRow[]> {
  const { data, error } = await db
    .from("compliance_checks")
    .select(CHECK_COLUMNS)
    .eq("event_id", eventId);
  if (error) throw fromDbError(error);
  return z.array(CheckRow).parse(data);
}

export async function getCheck(db: SupabaseServerClient, id: string): Promise<CheckRow | null> {
  const { data, error } = await db
    .from("compliance_checks")
    .select(CHECK_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data ? CheckRow.parse(data) : null;
}

export async function checkDetails(db: SupabaseServerClient, checkId: string) {
  const [refs, evidence, submissions] = await Promise.all([
    db
      .from("compliance_references")
      .select("id, check_id, source_id, relevance_note, created_at")
      .eq("check_id", checkId),
    db
      .from("compliance_evidence")
      .select("id, check_id, kind, value, is_simulated, recorded_by, recorded_at")
      .eq("check_id", checkId),
    db
      .from("official_submissions")
      .select(
        "id, check_id, authority, reference, status, is_simulated, response_summary, submitted_at, responded_at",
      )
      .eq("check_id", checkId),
  ]);
  for (const r of [refs, evidence, submissions]) if (r.error) throw fromDbError(r.error);
  return {
    references: z.array(ReferenceRow).parse(refs.data),
    evidence: z
      .array(EvidenceRow)
      .parse(evidence.data)
      .sort((a, b) => a.recorded_at.localeCompare(b.recorded_at)),
    submissions: z.array(SubmissionRow).parse(submissions.data),
  };
}

/** Event-wide timeline filtered to one check (entity id = check id). */
export async function checkHistory(db: SupabaseServerClient, eventId: string, checkId: string) {
  const data = await rpc(db, "event_timeline", { p_event_id: eventId, p_limit: 200 });
  return z
    .array(HistoryRow)
    .parse(data ?? [])
    .filter((r) => r.entity_id === checkId);
}

export const syncChecks = (db: SupabaseServerClient, eventId: string, items: ComplianceItem[]) =>
  rpc(db, "sync_compliance_checks", { p_event_id: eventId, p_items: items }).then((d) =>
    z.number().parse(d ?? 0),
  );

export const createCheck = (
  db: SupabaseServerClient,
  eventId: string,
  c: { topicKey: string; category: string; title: string; description?: string; reason: string },
) =>
  rpc(db, "create_compliance_check", {
    p_event_id: eventId,
    p_topic_key: c.topicKey,
    p_category: c.category,
    p_title: c.title,
    p_description: c.description ?? "",
    p_reason: c.reason,
  }).then((d) => z.string().parse(d));

export const setStatus = (
  db: SupabaseServerClient,
  checkId: string,
  status: string,
  reason: string | null,
) => rpc(db, "set_compliance_status", { p_check_id: checkId, p_status: status, p_reason: reason });

export const updateCheck = (
  db: SupabaseServerClient,
  checkId: string,
  applicability: string,
  nextAction: string | null,
) =>
  rpc(db, "update_compliance_check", {
    p_check_id: checkId,
    p_applicability: applicability,
    p_next_action: nextAction ?? "",
  });

export const assignReviewer = (
  db: SupabaseServerClient,
  checkId: string,
  reviewer: string | null,
) => rpc(db, "assign_compliance_reviewer", { p_check_id: checkId, p_reviewer: reviewer });

export const addReference = (
  db: SupabaseServerClient,
  checkId: string,
  sourceId: string,
  note: string | null,
) =>
  rpc(db, "add_compliance_reference", {
    p_check_id: checkId,
    p_source_id: sourceId,
    p_note: note ?? "",
  });

export const addEvidence = (
  db: SupabaseServerClient,
  checkId: string,
  kind: string,
  value: string,
) => rpc(db, "add_compliance_evidence", { p_check_id: checkId, p_kind: kind, p_value: value });

export const simulateSubmission = (db: SupabaseServerClient, checkId: string) =>
  rpc(db, "simulate_official_submission", { p_check_id: checkId });

export const recordSimulatedResponse = (
  db: SupabaseServerClient,
  submissionId: string,
  summary: string,
) => rpc(db, "record_simulated_response", { p_submission_id: submissionId, p_summary: summary });

export const setSourceVerification = (
  db: SupabaseServerClient,
  sourceId: string,
  verified: boolean,
  note: string | null,
) =>
  rpc(db, "set_source_verification", {
    p_source_id: sourceId,
    p_verified: verified,
    p_note: note ?? "",
  });
