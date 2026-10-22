"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { resendConfirmationAction, signInAction } from "@/modules/auth/actions";

export function SignInForm({ next }: { next: string }) {
  const [state, action] = useActionState(signInAction, initialFormState);
  const err = state.fieldErrors;
  return (
    <div className="space-y-5">
      {state.message && <Alert tone="danger" title={state.message} />}
      <form action={action} className="space-y-4" noValidate>
        <input type="hidden" name="next" value={next} />
        <FormField label="Email" error={err?.email?.[0]} required>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={state.values?.email}
            key={state.values?.email}
          />
        </FormField>
        <FormField label="Password" error={err?.password?.[0]} required>
          <Input name="password" type="password" autoComplete="current-password" />
        </FormField>
        <SubmitButton className="w-full">Sign in</SubmitButton>
      </form>
      {state.values?.unconfirmed && <ResendConfirmation email={state.values.email ?? ""} />}
    </div>
  );
}

function ResendConfirmation({ email }: { email: string }) {
  const [state, action] = useActionState(resendConfirmationAction, initialFormState);
  return (
    <form action={action} className="space-y-3 rounded-md border border-line bg-surface-muted p-4">
      <input type="hidden" name="email" value={email} />
      <p className="text-sm text-ink-muted">Didn&rsquo;t get the confirmation email?</p>
      {state.message && (
        <p role="status" className="text-sm text-ink">
          {state.message}
        </p>
      )}
      <SubmitButton variant="secondary" size="sm">
        Send a new link
      </SubmitButton>
    </form>
  );
}
