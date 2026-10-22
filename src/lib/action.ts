import "server-only";
import { refresh } from "next/cache";
import type { z } from "zod";
import { AppError } from "./errors";
import { fieldErrorsOf, type FormState } from "./forms";

/**
 * Standard server-action flow: validate untrusted input with Zod → run the service (which
 * authorizes against the verified session) → refresh the router. AppErrors become a form message;
 * redirects and unexpected errors propagate to Next.js.
 */
export async function runAction<S extends z.ZodType>(
  schema: S,
  raw: unknown,
  fn: (data: z.infer<S>) => Promise<string | void>,
): Promise<FormState> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  try {
    const message = await fn(parsed.data);
    refresh();
    return { ok: true, message: message ?? "Saved." };
  } catch (e) {
    if (e instanceof AppError) return { ok: false, message: e.message };
    throw e;
  }
}

/** FormData → plain object. Keys listed in `arrays` keep every value; others keep the last. */
export function formFields(form: FormData, arrays: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(form.keys())) {
    if (key.startsWith("$ACTION")) continue;
    const values = form.getAll(key).filter((v): v is string => typeof v === "string");
    out[key] = arrays.includes(key) ? values : values.at(-1);
  }
  for (const key of arrays) out[key] ??= [];
  return out;
}
