import type { z } from "zod";

/** Result shape for server actions used with useActionState. */
export interface FormState {
  ok?: boolean;
  message?: string;
  fieldErrors?: Record<string, string[] | undefined>;
  /** Non-sensitive values to re-populate the form (never passwords). */
  values?: Record<string, string>;
}

export const initialFormState: FormState = {};

export function fieldErrorsOf(error: z.ZodError): FormState["fieldErrors"] {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function formString(form: FormData, key: string): string | undefined {
  const v = form.get(key);
  return typeof v === "string" ? v : undefined;
}
