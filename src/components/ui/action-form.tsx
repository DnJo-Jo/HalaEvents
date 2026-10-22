"use client";

import {
  createContext,
  startTransition,
  useActionState,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { initialFormState, type FormState } from "@/lib/forms";
import { Alert } from "./alert";

export const FormPendingContext = createContext<boolean | null>(null);

export interface ActionFormProps {
  action: (prev: FormState, form: FormData) => Promise<FormState>;
  children: ReactNode;
  /** Field name → label, used in the error summary. */
  labels?: Record<string, string>;
  /** Clear the fields after a successful submission (e.g. "add item" forms). */
  resetOnSuccess?: boolean;
  className?: string;
  /** Lets buttons elsewhere submit this form via their `form` attribute. */
  id?: string;
  "aria-label"?: string;
}

/**
 * Form for server actions whose fields are rendered on the server. Submits via a transition (so a
 * failed validation does not wipe what the user typed), shows a GOV.UK-style error summary that
 * receives focus, and passes the pending state to <SubmitButton>. The submitter button's
 * name/value (e.g. intent=submit) is included.
 */
export function ActionForm({
  action,
  children,
  labels = {},
  resetOnSuccess,
  className,
  ...rest
}: ActionFormProps) {
  const [state, dispatch, pending] = useActionState(action, initialFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  const errors = Object.entries(state.fieldErrors ?? {}).filter(([, v]) => v && v.length > 0);

  useEffect(() => {
    if (state.ok && resetOnSuccess) formRef.current?.reset();
    if (state.ok === false) summaryRef.current?.focus();
  }, [state, resetOnSuccess]);

  return (
    <form
      ref={formRef}
      id={rest.id}
      noValidate
      aria-label={rest["aria-label"]}
      className={cn("space-y-4", className)}
      onSubmit={(e) => {
        e.preventDefault();
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
        const data = new FormData(e.currentTarget, submitter);
        startTransition(() => dispatch(data));
      }}
    >
      <div ref={summaryRef} tabIndex={-1} className="outline-none">
        {state.message && <Alert tone={state.ok ? "success" : "danger"} title={state.message} />}
        {errors.length > 0 && (
          <Alert tone="danger" title="Please fix the following">
            <ul className="list-disc space-y-0.5 pl-5">
              {errors.map(([field, msgs]) => (
                <li key={field}>
                  <span className="font-medium text-ink">{labels[field] ?? field}:</span> {msgs![0]}
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </div>
      <FormPendingContext value={pending}>{children}</FormPendingContext>
    </form>
  );
}
