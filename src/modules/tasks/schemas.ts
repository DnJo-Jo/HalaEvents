import { z } from "zod";
import { optionalText } from "@/lib/schemas/common";
import { TaskCategory, TaskPriority } from "@/modules/planning/playbook";

export { TaskCategory, TaskPriority };

export const TaskStatus = z.enum(["todo", "in_progress", "done", "cancelled"]);
export type TaskStatus = z.infer<typeof TaskStatus>;
export const TaskOrigin = z.enum(["manual", "ai_plan", "playbook_plan"]);

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const DateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "Use a date (YYYY-MM-DD)." })
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), { message: "Not a real date." });
const OptionalUser = z.preprocess(blankToUndefined, z.uuid().optional());

export const CreateTaskInput = z.object({
  title: z.string().trim().min(3, { message: "Use at least 3 characters." }).max(120),
  description: optionalText(1000),
  category: TaskCategory.default("logistics"),
  priority: TaskPriority.default("medium"),
  dueDate: z.preprocess(blankToUndefined, DateOnly.optional()),
  ownerUserId: OptionalUser,
  ownerLabel: optionalText(60),
});
export type CreateTaskInput = z.infer<typeof CreateTaskInput>;

export const ChangeTaskStatusInput = z.object({ status: TaskStatus });

/** Owner picker: an event manager, or "" to clear. */
export const AssignTaskInput = z.object({
  ownerUserId: z.preprocess((v) => (v === "" ? null : v), z.uuid().nullable()),
  dueDate: z.preprocess((v) => (v === "" ? null : v), DateOnly.nullable()),
});

export const AddDependencyInput = z.object({
  dependsOn: z.uuid({ message: "Choose a task." }),
});
