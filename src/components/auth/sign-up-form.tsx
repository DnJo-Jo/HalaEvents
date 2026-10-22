"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { signUpAction } from "@/modules/auth/actions";

export function SignUpForm() {
  const [state, action] = useActionState(signUpAction, initialFormState);
  const err = state.fieldErrors;
  return (
    <div className="space-y-5">
      {state.message && <Alert tone="danger" title={state.message} />}
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
        <FormField
          label="Password"
          hint="At least 8 characters, with letters and numbers."
          error={err?.password?.[0]}
          required
        >
          <Input name="password" type="password" autoComplete="new-password" />
        </FormField>
        <FormField label="Confirm password" error={err?.confirmPassword?.[0]} required>
          <Input name="confirmPassword" type="password" autoComplete="new-password" />
        </FormField>
        <SubmitButton className="w-full">Create account</SubmitButton>
      </form>
    </div>
  );
}
