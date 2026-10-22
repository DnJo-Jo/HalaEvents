import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import { EventMemberRole } from "@/modules/events/schemas";
import {
  TaskCategory,
  TaskOrigin,
  TaskPriority,
  TaskStatus,
  type CreateTaskInput,
} from "./schemas";

export const TaskRow = z.object({
  id: z.string(),
  event_id: z.string(),
  title: z.string(),
  description: z.string(),
  category: TaskCategory,
  priority: TaskPriority,
  status: TaskStatus,
  due_date: z.string().nullable(),
  owner_user_id: z.string().nullable(),
  owner_label: z.string().nullable(),
  origin: TaskOrigin,
  completed_at: z.string().nullable(),
  updated_at: z.string(),
});
export type TaskRow = z.infer<typeof TaskRow>;
const COLUMNS = Object.keys(TaskRow.shape).join(", ");

const DependencyRow = z.object({ task_id: z.string(), depends_on_task_id: z.string() });

export async function listTasks(db: SupabaseServerClient, eventId: string): Promise<TaskRow[]> {
  const { data, error } = await db.from("tasks").select(COLUMNS).eq("event_id", eventId);
  if (error) throw fromDbError(error);
  return z
    .array(TaskRow)
    .parse(data)
    .sort(
      (a, b) =>
        (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") ||
        a.title.localeCompare(b.title),
    );
}

export async function getTask(db: SupabaseServerClient, id: string): Promise<TaskRow | null> {
  const { data, error } = await db.from("tasks").select(COLUMNS).eq("id", id).maybeSingle();
  if (error) throw fromDbError(error);
  return data ? TaskRow.parse(data) : null;
}

export async function listDependencies(db: SupabaseServerClient, eventId: string) {
  const { data, error } = await db
    .from("task_dependencies")
    .select("task_id, depends_on_task_id")
    .eq("event_id", eventId);
  if (error) throw fromDbError(error);
  return z.array(DependencyRow).parse(data);
}

export async function createTask(
  db: SupabaseServerClient,
  eventId: string,
  t: CreateTaskInput,
): Promise<string> {
  const { data, error } = await db
    .from("tasks")
    .insert({
      event_id: eventId,
      title: t.title,
      description: t.description ?? "",
      category: t.category,
      priority: t.priority,
      due_date: t.dueDate ?? null,
      owner_user_id: t.ownerUserId ?? null,
      owner_label: t.ownerLabel ?? null,
    })
    .select("id")
    .single();
  if (error) throw fromDbError(error);
  return z.object({ id: z.string() }).parse(data).id;
}

export async function updateTask(
  db: SupabaseServerClient,
  id: string,
  patch: Partial<Pick<TaskRow, "status" | "owner_user_id" | "due_date">>,
): Promise<void> {
  const { error } = await db.from("tasks").update(patch).eq("id", id);
  if (error) throw fromDbError(error);
}

export async function addDependency(db: SupabaseServerClient, taskId: string, dependsOn: string) {
  const { error } = await db
    .from("task_dependencies")
    .insert({ task_id: taskId, depends_on_task_id: dependsOn });
  if (error) throw fromDbError(error);
}

export async function removeDependency(
  db: SupabaseServerClient,
  taskId: string,
  dependsOn: string,
) {
  const { error } = await db
    .from("task_dependencies")
    .delete()
    .eq("task_id", taskId)
    .eq("depends_on_task_id", dependsOn);
  if (error) throw fromDbError(error);
}

export async function acceptPlan(db: SupabaseServerClient, planId: string): Promise<number> {
  const { data, error } = await db.rpc("accept_ai_plan", { p_plan_id: planId });
  if (error) throw fromDbError(error);
  return z.number().parse(data);
}

export const MemberEntry = z.object({
  user_id: z.string(),
  display_name: z.string(),
  role: EventMemberRole,
});
export type MemberEntry = z.infer<typeof MemberEntry>;

export async function memberDirectory(
  db: SupabaseServerClient,
  eventId: string,
): Promise<MemberEntry[]> {
  const { data, error } = await db.rpc("event_member_directory", { p_event_id: eventId });
  if (error) throw fromDbError(error);
  return z.array(MemberEntry).parse(data ?? []);
}
