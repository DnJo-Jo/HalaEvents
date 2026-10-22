"use client";

import { useRef, useState, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./button";
import { ConfirmDialog } from "./confirm-dialog";

/**
 * A button that asks for confirmation, then submits its enclosing form. Used for consequential or
 * irreversible actions (cancel a request, decline a quote, delete). The server still authorizes.
 */
export function ConfirmSubmit({
  children,
  title,
  description,
  confirmLabel,
  variant = "secondary",
  tone = "danger",
  size = "sm",
}: {
  children: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  variant?: ButtonVariant;
  tone?: "primary" | "danger";
  size?: "sm" | "md";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={ref} variant={variant} size={size} onClick={() => setOpen(true)}>
        {children}
      </Button>
      <ConfirmDialog
        open={open}
        title={title}
        description={description}
        confirmLabel={confirmLabel}
        tone={tone}
        onCancel={() => setOpen(false)}
        onConfirm={() => {
          setOpen(false);
          ref.current?.form?.requestSubmit();
        }}
      />
    </>
  );
}
