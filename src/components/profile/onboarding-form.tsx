"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { completeOnboardingAction } from "@/modules/profiles/actions";
import { RoleCheckboxes } from "./role-checkboxes";

export function OnboardingForm({ defaultName }: { defaultName: string }) {
  const [state, action] = useActionState(completeOnboardingAction, initialFormState);
  const err = state.fieldErrors;
  return (
    <form action={action} className="space-y-5" noValidate>
      {state.message && <Alert tone="danger" title={state.message} />}
      <FormField
        label="Your name"
        hint="Shown to people you work with on events."
        error={err?.displayName?.[0]}
        required
      >
        <Input
          name="displayName"
          autoComplete="name"
          defaultValue={state.values?.displayName ?? defaultName}
        />
      </FormField>
      <FormField
        label="Phone"
        hint="Optional. Only visible to you and platform admins."
        error={err?.phone?.[0]}
      >
        <Input name="phone" type="tel" autoComplete="tel" defaultValue={state.values?.phone} />
      </FormField>
      <FormField label="Language" error={err?.locale?.[0]}>
        <Select name="locale" defaultValue="en">
          <option value="en">English</option>
          <option value="ar">العربية (Arabic) — interface translation coming later</option>
        </Select>
      </FormField>
      <RoleCheckboxes selected={["organizer"]} error={err?.roles?.[0]} />
      <SubmitButton className="w-full">Finish setup</SubmitButton>
    </form>
  );
}
