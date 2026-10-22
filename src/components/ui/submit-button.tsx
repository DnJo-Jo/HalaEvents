"use client";

import { useContext } from "react";
import { useFormStatus } from "react-dom";
import { FormPendingContext } from "./action-form";
import { Button, type ButtonProps } from "./button";

/** Submit button that shows a spinner and disables itself while its form's action runs. */
export function SubmitButton({ children, ...props }: Omit<ButtonProps, "type" | "loading">) {
  const actionFormPending = useContext(FormPendingContext);
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={actionFormPending ?? pending} {...props}>
      {children}
    </Button>
  );
}
