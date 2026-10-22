"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { forgotPasswordAction } from "@/modules/auth/actions";

export function ForgotPasswordForm() {
  const [state, action] = useActionState(forgotPasswordAction, initialFormState);
  const err = state.fieldErrors;
  return (
    <div className="space-y-5">
      {state.ok && state.message && <Alert tone="success" title={state.message} />}
      {!state.ok && state.message && <Alert tone="danger" title={state.message} />}
      <form action={action} className="space-y-4" noValidate>
        <FormField label="Email" error={err?.email?.[0]} required>
          <Input
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={state.values?.email}
            key={state.values?.email}
          />
        </FormField>
        <SubmitButton className="w-full">Send reset link</SubmitButton>
      </form>
    </div>
  );
}
