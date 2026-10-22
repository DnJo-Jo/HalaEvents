"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { formFields, runAction } from "@/lib/action";
import { AppError } from "@/lib/errors";
import type { FormState } from "@/lib/forms";
import { refreshReminders } from "@/modules/notifications/service";
import {
  AddDependencyInput,
  AssignTaskInput,
  ChangeTaskStatusInput,
  CreateTaskInput,
} from "./schemas";
import * as service from "./service";

const Id = z.uuid();
const ids = (...values: string[]) => values.every((v) => Id.safeParse(v).success);

/** Reminders are best-effort: a failure there never undoes or hides the saved change. */
async function remind(eventId: string) {
  await refreshReminders(eventId).catch(() => 0);
}

export async function createTaskAction(eventId: string, _prev: FormState, form: FormData) {
  if (!ids(eventId)) return { ok: false, message: "Unknown event." };
  return runAction(CreateTaskInput, formFields(form), async (data) => {
    await service.createTask(eventId, data);
    await remind(eventId);
    return "Task added.";
  });
}

export async function changeTaskStatusAction(
  eventId: string,
  taskId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, taskId)) return { ok: false, message: "Unknown task." };
  return runAction(ChangeTaskStatusInput, formFields(form), async ({ status }) => {
    await service.changeTaskStatus(eventId, taskId, status);
    return "Status updated.";
  });
}

export async function assignTaskAction(
  eventId: string,
  taskId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, taskId)) return { ok: false, message: "Unknown task." };
  return runAction(AssignTaskInput, formFields(form), async (data) => {
    await service.assignTask(eventId, taskId, data);
    await remind(eventId);
    return "Owner and deadline saved.";
  });
}

export async function addDependencyAction(
  eventId: string,
  taskId: string,
  _prev: FormState,
  form: FormData,
) {
  if (!ids(eventId, taskId)) return { ok: false, message: "Unknown task." };
  return runAction(AddDependencyInput, formFields(form), async ({ dependsOn }) => {
    await service.addDependency(eventId, taskId, dependsOn);
    return "Dependency added.";
  });
}

export async function removeDependencyAction(
  eventId: string,
  taskId: string,
  dependsOn: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  if (!ids(eventId, taskId, dependsOn)) return { ok: false, message: "Unknown task." };
  try {
    await service.removeDependency(eventId, taskId, dependsOn);
    refresh();
    return { ok: true, message: "Dependency removed." };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}

export async function acceptPlanAction(
  eventId: string,
  planId: string,
  _prev: FormState,
  _form: FormData,
): Promise<FormState> {
  if (!ids(eventId, planId)) return { ok: false, message: "Unknown plan." };
  try {
    const n = await service.acceptCurrentPlan(eventId, planId);
    await remind(eventId);
    refresh();
    return {
      ok: true,
      message: `${n} task${n === 1 ? "" : "s"} added to the workspace, with their dependencies.`,
    };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}
