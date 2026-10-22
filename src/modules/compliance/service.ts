import "server-only";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";
import * as eventsRepo from "@/modules/events/repo";
import { getEventForMember, planningContext } from "@/modules/events/service";
import { requireMember } from "@/modules/profiles/service";
import * as tasksRepo from "@/modules/tasks/repo";
import * as repo from "./repo";
import { detectComplianceItems, transitionBlockers, COMPLIANCE_TRANSITIONS } from "./rules";
import type { ComplianceStatus } from "./schemas";

/**
 * Compliance workflow (event.md §19). The service authorizes and checks the rules first for clear
 * messages; the SECURITY DEFINER functions in migration 0008 enforce the same rules again.
 * No model output is involved anywhere in this module.
 */

/** There is no live search/monitoring integration: the registry is curated by hand. */
export const LIVE_SOURCE_SEARCH = { configured: false } as const;

const OPEN_EVENT = new Set(["draft", "planning", "ready", "live"]);

async function managerContext(eventId: string) {
  const member = await requireMember();
  const db = await createSupabaseServerClient();
  const [event, role] = await Promise.all([
    eventsRepo.getEvent(db, eventId),
    eventsRepo.getRole(db, eventId, member.user.id),
  ]);
  if (!event || !role)
    throw new AppError("not_found", "That event doesn't exist or isn't visible to you.");
  if (role !== "owner" && role !== "organizer")
    throw new AppError(
      "forbidden",
      "Only the event's owner or organizers can change compliance checks.",
    );
  if (!OPEN_EVENT.has(event.status))
    throw new AppError("conflict", `This event is ${event.status}, so its checks can't change.`);
  return { db, event, member };
}

async function checkInEvent(
  db: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  eventId: string,
  checkId: string,
) {
  const check = await repo.getCheck(db, checkId);
  if (!check || check.event_id !== eventId)
    throw new AppError("not_found", "That check isn't part of this event.");
  return check;
}

export async function listSources() {
  const { isAdmin } = await requireMember();
  const sources = await repo.listSources(await createSupabaseServerClient());
  return { sources, isAdmin, liveSearch: LIVE_SOURCE_SEARCH };
}

export async function getComplianceOverview(eventId: string) {
  const { event, role, canManage } = await getEventForMember(eventId);
  const db = await createSupabaseServerClient();
  const checks = await repo.listChecks(db, eventId);
  const { playbook, ctx } = await planningContext(db, event);
  const detected = detectComplianceItems(playbook, ctx);
  const stored = new Set(checks.map((c) => c.topic_key));
  return {
    event,
    role,
    canEdit: canManage && OPEN_EVENT.has(event.status),
    checks,
    /** Rule results not yet saved as checks (shown as "Run checks to add"). */
    pending: detected.filter((d) => !stored.has(d.topicKey)).length,
  };
}

/** Event members, and platform admins acting as reviewers (read + decide only). */
async function eventForMemberOrAdmin(eventId: string) {
  const member = await requireMember();
  const db = await createSupabaseServerClient();
  const [event, role] = await Promise.all([
    eventsRepo.getEvent(db, eventId),
    eventsRepo.getRole(db, eventId, member.user.id),
  ]);
  if (!event || (!role && !member.isAdmin)) notFound();
  return { db, event, role, member, canManage: role === "owner" || role === "organizer" };
}

export async function getCheckView(eventId: string, checkId: string) {
  const { db, event, role, member, canManage } = await eventForMemberOrAdmin(eventId);
  const check = await repo.getCheck(db, checkId);
  if (!check || check.event_id !== eventId) notFound();
  const [details, sources, members, history] = await Promise.all([
    repo.checkDetails(db, checkId),
    repo.listSources(db),
    tasksRepo.memberDirectory(db, eventId),
    repo.checkHistory(db, eventId, checkId),
  ]);
  const sourceById = new Map(sources.map((s) => [s.id, s]));
  const facts = {
    hasVerifiedReference: details.references.some(
      (r) => sourceById.get(r.source_id)?.last_verified_at,
    ),
    hasReviewer: check.reviewer_user_id !== null,
    callerIsReviewerOrAdmin: member.isAdmin || check.reviewer_user_id === member.user.id,
    hasRealEvidence: details.evidence.some((e) => !e.is_simulated),
    hasSubmission:
      details.submissions.length > 0 ||
      details.evidence.some((e) => e.kind === "submission_reference"),
  };
  const canEdit = canManage && OPEN_EVENT.has(event.status);
  const canDecide = (canManage || member.isAdmin) && OPEN_EVENT.has(event.status);
  return {
    event,
    role,
    check,
    canEdit,
    ...details,
    sources,
    sourceById,
    channel: check.official_channel_id ? (sourceById.get(check.official_channel_id) ?? null) : null,
    members,
    history,
    /** Every next status with the reasons it's not available yet (empty = available). */
    transitions: canDecide
      ? COMPLIANCE_TRANSITIONS[check.status].map((to) => ({
          to,
          blockers: transitionBlockers(check.status, to, facts),
        }))
      : [],
  };
}

/** Runs the deterministic rules and saves new checks (human decisions are never overwritten). */
export async function runChecks(eventId: string): Promise<number> {
  const { db, event } = await managerContext(eventId);
  const { playbook, ctx } = await planningContext(db, event);
  return repo.syncChecks(db, eventId, detectComplianceItems(playbook, ctx));
}

export async function createCheck(
  eventId: string,
  input: {
    topicKey: string;
    category: string;
    title: string;
    description?: string;
    reason: string;
  },
): Promise<string> {
  const { db } = await managerContext(eventId);
  return repo.createCheck(db, eventId, input);
}

export async function changeStatus(
  eventId: string,
  checkId: string,
  to: ComplianceStatus,
  reason: string | undefined,
) {
  const view = await getCheckView(eventId, checkId);
  const option = view.transitions.find((t) => t.to === to);
  if (!option)
    throw new AppError("invalid_transition", "That status change isn't allowed from here.");
  if (option.blockers.length) throw new AppError("invalid_transition", option.blockers.join(" "));
  await repo.setStatus(await createSupabaseServerClient(), checkId, to, reason ?? null);
}

export async function updateCheck(
  eventId: string,
  checkId: string,
  input: { applicability: string; nextAction?: string },
) {
  const { db } = await managerContext(eventId);
  await checkInEvent(db, eventId, checkId);
  await repo.updateCheck(db, checkId, input.applicability, input.nextAction ?? null);
}

export async function assignReviewer(eventId: string, checkId: string, reviewer: string | null) {
  const { db } = await managerContext(eventId);
  await checkInEvent(db, eventId, checkId);
  await repo.assignReviewer(db, checkId, reviewer);
}

export async function addReference(
  eventId: string,
  checkId: string,
  sourceId: string,
  note?: string,
) {
  const { db } = await managerContext(eventId);
  await checkInEvent(db, eventId, checkId);
  await repo.addReference(db, checkId, sourceId, note ?? null);
}

export async function addEvidence(eventId: string, checkId: string, kind: string, value: string) {
  const { db } = await managerContext(eventId);
  await checkInEvent(db, eventId, checkId);
  await repo.addEvidence(db, checkId, kind, value);
}

/** DEMONSTRATION: records a simulated submission. Nothing is sent to any authority. */
export async function simulateSubmission(eventId: string, checkId: string) {
  const { db } = await managerContext(eventId);
  await checkInEvent(db, eventId, checkId);
  await repo.simulateSubmission(db, checkId);
}

export async function recordSimulatedResponse(
  eventId: string,
  checkId: string,
  submissionId: string,
  summary: string,
) {
  const { db } = await managerContext(eventId);
  await checkInEvent(db, eventId, checkId);
  await repo.recordSimulatedResponse(db, submissionId, summary);
}

export async function setSourceVerification(sourceId: string, verified: boolean, note?: string) {
  const { isAdmin } = await requireMember();
  if (!isAdmin) throw new AppError("forbidden", "Only platform admins can verify sources.");
  await repo.setSourceVerification(
    await createSupabaseServerClient(),
    sourceId,
    verified,
    note ?? null,
  );
}
