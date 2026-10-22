import "server-only";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";
import * as eventsRepo from "@/modules/events/repo";
import { getEventForMember } from "@/modules/events/service";
import { requireMember } from "@/modules/profiles/service";
import * as repo from "./repo";
import { canTaskTransition, deriveTasks, progress, todayIn, wouldCreateCycle } from "./rules";
import type { CreateTaskInput, TaskStatus } from "./schemas";

/**
 * Task workspace (event.md §18). Every write is authorized here (event owner/organizer, workspace
 * open) and again by RLS + triggers in the database; the rules in ./rules.ts are checked first so
 * users get a clear message instead of a database error.
 */

const OPEN_EVENT = new Set(["draft", "planning", "ready", "live"]);

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
    throw new AppError("forbidden", "Only the event's owner or organizers can change tasks.");
  if (!OPEN_EVENT.has(event.status))
    throw new AppError("conflict", `This event is ${event.status}, so its tasks can't change.`);
  return { db, event, user };
}

async function taskInEvent(
  db: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  eventId: string,
  taskId: string,
) {
  const task = await repo.getTask(db, taskId);
  if (!task || task.event_id !== eventId)
    throw new AppError("not_found", "That task isn't part of this event.");
  return task;
}

/** Read model for the task board and the workspace (any event member). */
export async function getTaskBoard(eventId: string) {
  const { event, role, canManage } = await getEventForMember(eventId);
  const db = await createSupabaseServerClient();
  const [tasks, deps, members] = await Promise.all([
    repo.listTasks(db, eventId),
    repo.listDependencies(db, eventId),
    repo.memberDirectory(db, eventId),
  ]);
  const today = todayIn(event.timezone);
  const derived = deriveTasks(tasks, deps, today);
  return {
    event,
    role,
    canEdit: canManage && OPEN_EVENT.has(event.status),
    tasks,
    deps,
    derived,
    today,
    progress: progress(tasks, derived),
    members,
  };
}

export async function createTask(eventId: string, input: CreateTaskInput): Promise<string> {
  const { db } = await managerContext(eventId);
  return repo.createTask(db, eventId, input);
}

export async function changeTaskStatus(eventId: string, taskId: string, to: TaskStatus) {
  const { db } = await managerContext(eventId);
  const task = await taskInEvent(db, eventId, taskId);
  if (!canTaskTransition(task.status, to)) {
    throw new AppError("invalid_transition", `A task can't go from ${task.status} to ${to}.`);
  }
  if (to === "done") {
    const [tasks, deps] = await Promise.all([
      repo.listTasks(db, eventId),
      repo.listDependencies(db, eventId),
    ]);
    if (deriveTasks(tasks, deps, "0000-01-01").get(taskId)?.blockedBy.length) {
      throw new AppError(
        "invalid_transition",
        "This task is blocked: finish or cancel the tasks it depends on first.",
      );
    }
  }
  await repo.updateTask(db, taskId, { status: to });
}

export async function assignTask(
  eventId: string,
  taskId: string,
  patch: { ownerUserId: string | null; dueDate: string | null },
) {
  const { db } = await managerContext(eventId);
  await taskInEvent(db, eventId, taskId);
  if (patch.ownerUserId) {
    const role = await eventsRepo.getRole(db, eventId, patch.ownerUserId);
    if (role !== "owner" && role !== "organizer") {
      throw new AppError(
        "validation_failed",
        "Task owners must be the event's owner or one of its organizers.",
      );
    }
  }
  await repo.updateTask(db, taskId, { owner_user_id: patch.ownerUserId, due_date: patch.dueDate });
}

export async function addDependency(eventId: string, taskId: string, dependsOn: string) {
  const { db } = await managerContext(eventId);
  await Promise.all([taskInEvent(db, eventId, taskId), taskInEvent(db, eventId, dependsOn)]);
  const deps = await repo.listDependencies(db, eventId);
  if (wouldCreateCycle(deps, taskId, dependsOn)) {
    throw new AppError("validation_failed", "That dependency would create a loop between tasks.");
  }
  await repo.addDependency(db, taskId, dependsOn);
}

export async function removeDependency(eventId: string, taskId: string, dependsOn: string) {
  const { db } = await managerContext(eventId);
  await taskInEvent(db, eventId, taskId);
  await repo.removeDependency(db, taskId, dependsOn);
}

/** Accepts every open proposal of the event's current plan into real tasks (one RPC, one transaction). */
export async function acceptCurrentPlan(eventId: string, planId: string): Promise<number> {
  const { db } = await managerContext(eventId);
  return repo.acceptPlan(db, planId);
}
