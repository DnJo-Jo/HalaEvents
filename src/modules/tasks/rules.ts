import { findCycle } from "@/modules/planning/playbook";
import type { TaskStatus } from "./schemas";

/**
 * Task lifecycle (event.md §4, §18). Mirrored by task_status_transition_allowed() in migration
 * 20261022000003_workspace.sql; tests/unit/tasks/rules.test.ts checks every pair against this table.
 * "Blocked" and "overdue" are derived from stored data, never stored.
 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  todo: ["in_progress", "done", "cancelled"],
  in_progress: ["todo", "done", "cancelled"],
  done: ["in_progress"],
  cancelled: ["todo"],
};

export function canTaskTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

export interface TaskNode {
  id: string;
  status: TaskStatus;
  due_date: string | null;
}
export interface Dependency {
  task_id: string;
  depends_on_task_id: string;
}

export interface DerivedTask {
  /** Open dependencies (neither done nor cancelled). Non-empty ⇒ blocked. */
  blockedBy: string[];
  blocked: boolean;
  overdue: boolean;
  /** Due within `soonDays` days (today included) and still open. */
  dueSoon: boolean;
  /** Tasks that wait for this one. */
  dependents: string[];
}

const isOpen = (s: TaskStatus) => s === "todo" || s === "in_progress";

/** Derives blocked/overdue/due-soon for every task. `today` is YYYY-MM-DD in the event's timezone. */
export function deriveTasks(
  tasks: TaskNode[],
  deps: Dependency[],
  today: string,
  soonDays = 3,
): Map<string, DerivedTask> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const soon = addDays(today, soonDays);
  const out = new Map<string, DerivedTask>();
  for (const t of tasks) {
    const blockedBy = deps
      .filter((d) => d.task_id === t.id)
      .map((d) => d.depends_on_task_id)
      .filter((id) => {
        const dep = byId.get(id);
        return dep !== undefined && isOpen(dep.status);
      });
    out.set(t.id, {
      blockedBy,
      blocked: isOpen(t.status) && blockedBy.length > 0,
      overdue: isOpen(t.status) && t.due_date !== null && t.due_date < today,
      dueSoon: isOpen(t.status) && t.due_date !== null && t.due_date >= today && t.due_date <= soon,
      dependents: deps.filter((d) => d.depends_on_task_id === t.id).map((d) => d.task_id),
    });
  }
  return out;
}

/** Statuses offered for a task: the transition table, minus "done" while blocked. */
export function nextStatuses(status: TaskStatus, blocked: boolean): TaskStatus[] {
  return TASK_TRANSITIONS[status].filter((s) => !(s === "done" && blocked));
}

/** Would adding "taskId depends on dependsOn" create a cycle (or a self-dependency)? */
export function wouldCreateCycle(deps: Dependency[], taskId: string, dependsOn: string): boolean {
  if (taskId === dependsOn) return true;
  const edges = [...deps, { task_id: taskId, depends_on_task_id: dependsOn }];
  const ids = new Set(edges.flatMap((e) => [e.task_id, e.depends_on_task_id]));
  return (
    findCycle(
      [...ids].map((id) => ({
        id,
        dependsOn: edges.filter((e) => e.task_id === id).map((e) => e.depends_on_task_id),
      })),
    ) !== null
  );
}

export interface Progress {
  total: number;
  done: number;
  open: number;
  cancelled: number;
  overdue: number;
  blocked: number;
  /** done / (total − cancelled), 0–100; null when nothing counts yet. */
  percent: number | null;
}

export function progress(tasks: TaskNode[], derived: Map<string, DerivedTask>): Progress {
  const done = tasks.filter((t) => t.status === "done").length;
  const cancelled = tasks.filter((t) => t.status === "cancelled").length;
  const counted = tasks.length - cancelled;
  const flags = [...derived.values()];
  return {
    total: tasks.length,
    done,
    cancelled,
    open: counted - done,
    overdue: flags.filter((d) => d.overdue).length,
    blocked: flags.filter((d) => d.blocked).length,
    percent: counted === 0 ? null : Math.round((done / counted) * 100),
  };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Today's calendar date in an IANA timezone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
