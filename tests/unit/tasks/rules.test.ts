import { describe, expect, it } from "vitest";
import {
  addDays,
  canTaskTransition,
  deriveTasks,
  nextStatuses,
  progress,
  todayIn,
  wouldCreateCycle,
  type TaskNode,
} from "@/modules/tasks/rules";
import { AssignTaskInput, CreateTaskInput } from "@/modules/tasks/schemas";

const T = (id: string, status: TaskNode["status"] = "todo", due_date: string | null = null) => ({
  id,
  status,
  due_date,
});

describe("task transitions", () => {
  it("follows the table: no done → cancelled, no cancelled → done, reopen allowed", () => {
    expect(canTaskTransition("todo", "in_progress")).toBe(true);
    expect(canTaskTransition("in_progress", "done")).toBe(true);
    expect(canTaskTransition("done", "in_progress")).toBe(true);
    expect(canTaskTransition("done", "cancelled")).toBe(false);
    expect(canTaskTransition("cancelled", "done")).toBe(false);
    expect(canTaskTransition("todo", "todo")).toBe(false);
  });

  it("never offers done while blocked", () => {
    expect(nextStatuses("todo", true)).toEqual(["in_progress", "cancelled"]);
    expect(nextStatuses("todo", false)).toContain("done");
  });
});

describe("derived state", () => {
  const today = "2026-11-10";
  const tasks = [
    T("a", "todo", "2026-11-01"), // overdue
    T("b", "in_progress", "2026-11-12"), // due soon, blocked by a
    T("c", "done", "2026-11-01"), // done: never overdue
    T("d", "todo", "2026-12-01"), // depends on c (done) → not blocked
    T("e", "cancelled", "2026-11-01"),
    T("f", "todo", null), // depends on e (cancelled) → not blocked
  ];
  const deps = [
    { task_id: "b", depends_on_task_id: "a" },
    { task_id: "d", depends_on_task_id: "c" },
    { task_id: "f", depends_on_task_id: "e" },
  ];
  const d = deriveTasks(tasks, deps, today);

  it("blocked = an open dependency; finished or cancelled dependencies don't block", () => {
    expect(d.get("b")).toMatchObject({ blocked: true, blockedBy: ["a"] });
    expect(d.get("d")?.blocked).toBe(false);
    expect(d.get("f")?.blocked).toBe(false);
    expect(d.get("a")?.dependents).toEqual(["b"]);
  });

  it("overdue and due-soon only for open tasks", () => {
    expect(d.get("a")).toMatchObject({ overdue: true, dueSoon: false });
    expect(d.get("b")).toMatchObject({ overdue: false, dueSoon: true });
    expect(d.get("c")?.overdue).toBe(false);
    expect(d.get("e")?.overdue).toBe(false);
    expect(d.get("d")?.dueSoon).toBe(false);
  });

  it("progress counts done against non-cancelled tasks", () => {
    expect(progress(tasks, d)).toEqual({
      total: 6,
      done: 1,
      cancelled: 1,
      open: 4,
      overdue: 1,
      blocked: 1,
      percent: 20,
    });
    expect(progress([], new Map()).percent).toBeNull();
  });
});

describe("cycles", () => {
  const deps = [
    { task_id: "b", depends_on_task_id: "a" },
    { task_id: "c", depends_on_task_id: "b" },
  ];
  it("detects self, direct and indirect cycles", () => {
    expect(wouldCreateCycle(deps, "a", "a")).toBe(true);
    expect(wouldCreateCycle(deps, "a", "b")).toBe(true);
    expect(wouldCreateCycle(deps, "a", "c")).toBe(true);
    expect(wouldCreateCycle(deps, "c", "a")).toBe(false);
    expect(wouldCreateCycle([], "x", "y")).toBe(false);
  });
});

describe("dates and inputs", () => {
  it("computes calendar days in the event's timezone", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    // 22:30 UTC on 1 Nov is already 2 Nov in Dubai (UTC+4).
    expect(todayIn("Asia/Dubai", new Date("2026-11-01T22:30:00Z"))).toBe("2026-11-02");
    expect(todayIn("UTC", new Date("2026-11-01T22:30:00Z"))).toBe("2026-11-01");
  });

  it("validates task forms", () => {
    expect(CreateTaskInput.safeParse({ title: "ab" }).success).toBe(false);
    expect(CreateTaskInput.safeParse({ title: "Book hall", dueDate: "2026-02-30x" }).success).toBe(
      false,
    );
    expect(
      CreateTaskInput.parse({ title: "Book hall", dueDate: "", ownerUserId: "" }),
    ).toMatchObject({
      title: "Book hall",
      dueDate: undefined,
      ownerUserId: undefined,
      priority: "medium",
    });
    expect(AssignTaskInput.parse({ ownerUserId: "", dueDate: "" })).toEqual({
      ownerUserId: null,
      dueDate: null,
    });
    expect(AssignTaskInput.safeParse({ ownerUserId: "not-a-uuid", dueDate: "" }).success).toBe(
      false,
    );
  });
});
