import "server-only";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError, fromDbError } from "@/lib/errors";
import { getEventForMember } from "@/modules/events/service";
import { getCurrentPlan } from "@/modules/planning/repo";
import * as tasksRepo from "@/modules/tasks/repo";
import * as vendorsRepo from "@/modules/vendors/repo";
import { buildExportModel } from "./model";
import { buildWorkbook } from "./workbook";

/**
 * Whether the organizer has a saved plan or tasks to export (shown on the event dashboard).
 * Members of the event only; the export itself is for owners and organizers.
 */
export async function exportAvailability(eventId: string): Promise<boolean> {
  const db = await createSupabaseServerClient();
  const [plan, tasks] = await Promise.all([
    db.from("ai_plans").select("id").eq("event_id", eventId).eq("status", "current").limit(1),
    db.from("tasks").select("id").eq("event_id", eventId).limit(1),
  ]);
  const error = plan.error ?? tasks.error;
  if (error) throw fromDbError(error);
  return (plan.data?.length ?? 0) + (tasks.data?.length ?? 0) > 0;
}

/**
 * Builds the .xlsx for an event from its persisted data, with the caller's own session (so RLS
 * applies as well). Only owners and organizers may export: the file carries vendor contacts.
 */
export async function exportEventWorkbook(
  eventId: string,
  now: Date = new Date(),
): Promise<{ fileName: string; data: Buffer }> {
  const { event, canManage } = await getEventForMember(eventId);
  if (!canManage)
    throw new AppError("forbidden", "Only the event's owner or organizers can export it.");
  const db = await createSupabaseServerClient();
  const [tasks, dependencies, members, plan, shortlist] = await Promise.all([
    tasksRepo.listTasks(db, eventId),
    tasksRepo.listDependencies(db, eventId),
    tasksRepo.memberDirectory(db, eventId),
    getCurrentPlan(db, eventId),
    vendorsRepo.listShortlist(db, eventId),
  ]);
  const model = buildExportModel({
    event,
    tasks,
    dependencies,
    members,
    overview: plan?.plan.overview ?? null,
    planSource: plan?.plan.source ?? null,
    shortlist,
    exportedAt: now,
  });
  return { fileName: model.fileName, data: await buildWorkbook(model) };
}
