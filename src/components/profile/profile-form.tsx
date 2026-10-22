"use client";

import { useActionState } from "react";
import { Alert } from "@/components/ui/alert";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { initialFormState } from "@/lib/forms";
import { updateProfileAction, updateRolesAction } from "@/modules/profiles/actions";
import type { AccountRole } from "@/modules/profiles/schemas";
import { RoleCheckboxes } from "./role-checkboxes";

export function ProfileForm(props: {
  displayName: string;
  phone: string | null;
  locale: "en" | "ar";
}) {
  const [state, action] = useActionState(updateProfileAction, initialFormState);
  const err = state.fieldErrors;
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.message && <Alert tone={state.ok ? "success" : "danger"} title={state.message} />}
      <FormField label="Your name" error={err?.displayName?.[0]} required>
        <Input name="displayName" autoComplete="name" defaultValue={props.displayName} />
      </FormField>
      <FormField
        label="Phone"
        hint="Optional. Only visible to you and platform admins."
        error={err?.phone?.[0]}
      >
        <Input name="phone" type="tel" autoComplete="tel" defaultValue={props.phone ?? ""} />
      </FormField>
      <FormField label="Language" error={err?.locale?.[0]}>
        <Select name="locale" defaultValue={props.locale}>
          <option value="en">English</option>
          <option value="ar">العربية (Arabic)</option>
        </Select>
      </FormField>
      <SubmitButton>Save profile</SubmitButton>
    </form>
  );
}

export function RolesForm({ roles }: { roles: AccountRole[] }) {
  const [state, action] = useActionState(updateRolesAction, initialFormState);
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.message && <Alert tone={state.ok ? "success" : "danger"} title={state.message} />}
      <RoleCheckboxes selected={roles} error={state.fieldErrors?.roles?.[0]} />
      <SubmitButton variant="secondary">Update roles</SubmitButton>
    </form>
  );
}
