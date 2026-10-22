import { ActionForm } from "@/components/ui/action-form";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/input";
import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";
import { formatInZone } from "@/lib/dates";
import { postMessageAction } from "@/modules/bookings/actions";
import type { MessageRow } from "@/modules/bookings/repo";

/** One organizer ↔ provider question thread. Only these two sides can read or post. */
export function Thread({
  messages,
  requestId,
  providerId,
  side,
  timezone,
  canPost,
  counterpart,
}: {
  messages: MessageRow[];
  requestId: string;
  providerId: string;
  side: "organizer" | "provider";
  timezone: string;
  canPost: boolean;
  counterpart: string;
}) {
  return (
    <div className="space-y-3">
      {messages.length === 0 ? (
        <p className="text-sm text-ink-muted">No questions yet.</p>
      ) : (
        <ol className="space-y-2" aria-label={`Messages with ${counterpart}`}>
          {messages.map((m) => {
            const mine = m.author_side === side;
            return (
              <li key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                    mine
                      ? "bg-primary-soft text-ink"
                      : "border border-line bg-surface-muted text-ink",
                  )}
                >
                  <p className="text-xs font-medium text-ink-muted">
                    {mine ? "You" : counterpart} ·{" "}
                    {formatInZone(m.created_at, timezone, { zoneLabel: false })}
                  </p>
                  <p className="mt-0.5 whitespace-pre-line">{m.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {canPost && (
        <ActionForm action={postMessageAction} resetOnSuccess labels={{ body: "Message" }}>
          <input type="hidden" name="requestId" value={requestId} />
          <input type="hidden" name="providerId" value={providerId} />
          <input type="hidden" name="side" value={side} />
          <FormField
            label={side === "provider" ? "Ask the organizer a question" : `Reply to ${counterpart}`}
          >
            <Textarea name="body" rows={2} maxLength={2000} required />
          </FormField>
          <SubmitButton variant="secondary" size="sm">
            Send
          </SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
