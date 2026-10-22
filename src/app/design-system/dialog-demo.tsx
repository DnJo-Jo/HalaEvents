"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";

/** Interactive samples. Nothing here calls the server. */
export function DialogDemo() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={() => setDialogOpen(true)}>
          Open dialog
        </Button>
        <Button variant="danger" onClick={() => setConfirmOpen(true)}>
          Open confirmation
        </Button>
      </div>
      <p className="text-sm text-ink-muted" aria-live="polite">
        {result ?? "No sample action taken."}
      </p>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Rename event"
        description="Sample dialog. Changes are not saved anywhere."
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setDialogOpen(false);
                setResult("Sample dialog closed with “Save” (nothing was saved).");
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <FormField label="Event name" hint="Shown to attendees.">
          <Input defaultValue="Campus Hackathon" />
        </FormField>
      </Dialog>

      <ConfirmDialog
        open={confirmOpen}
        tone="danger"
        title="Send 48 acceptance emails?"
        description="Sample confirmation. In the real app this creates an approval request; nothing is sent from this page."
        confirmLabel="Send emails"
        pending={pending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setPending(true);
          setTimeout(() => {
            setPending(false);
            setConfirmOpen(false);
            setResult("Sample confirmation accepted (nothing was sent).");
          }, 900);
        }}
      />
    </div>
  );
}
