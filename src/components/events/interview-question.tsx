import { Badge, MockBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import type { Question } from "@/modules/ai/playbook";
import type { AnswerValue } from "@/modules/events/interview-rules";

const choice =
  "flex cursor-pointer items-center gap-3 rounded-md border border-line px-3 py-2 text-sm transition-colors hover:bg-surface-muted has-[:checked]:border-primary has-[:checked]:bg-primary-soft";
const control = "size-4 accent-[var(--primary)]";

/**
 * One playbook question as a form control, pre-filled with the stored answer. The hidden `round`
 * input tells the server which questions this form showed (see parseSubmission()).
 */
export function InterviewQuestion({
  question: q,
  value,
  isNew = false,
  ai,
}: {
  question: Question;
  value?: AnswerValue;
  isNew?: boolean;
  /**
   * Set for an AI follow-up: labels it and offers "Dismiss". The button submits a separate form
   * (`form` attribute) so it is never the interview form's default (Enter-key) button.
   */
  ai?: { suggestionId: string; isMock: boolean };
}) {
  const id = `q-${q.key.replaceAll(".", "-")}`;
  const hidden = <input type="hidden" name="round" value={q.key} />;
  const aiBar = ai && (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone="accent">AI suggestion · optional</Badge>
      {ai.isMock && <MockBadge />}
      <Button type="submit" form={`dismiss-${ai.suggestionId}`} variant="ghost" size="sm">
        Dismiss
      </Button>
    </div>
  );

  if (q.type === "number" || q.type === "text") {
    return (
      <div>
        {hidden}
        {isNew && (
          <div className="mb-1">
            <NewBadge />
          </div>
        )}
        {aiBar}
        <FormField
          label={q.type === "number" && q.unit ? `${q.text} (${q.unit})` : q.text}
          hint={q.why}
          required={q.required}
        >
          {q.type === "number" ? (
            <Input
              id={id}
              name={q.key}
              type="number"
              inputMode="numeric"
              min={q.min}
              max={q.max}
              step={1}
              defaultValue={typeof value === "number" ? value : undefined}
              className="max-w-40"
            />
          ) : (
            <Textarea
              id={id}
              name={q.key}
              maxLength={q.maxLength}
              defaultValue={typeof value === "string" ? value : undefined}
              className="min-h-16"
            />
          )}
        </FormField>
      </div>
    );
  }

  const options =
    q.type === "boolean"
      ? [
          { value: "yes", label: "Yes" },
          { value: "no", label: "No" },
        ]
      : q.options;
  const checked = (v: string) =>
    Array.isArray(value)
      ? value.includes(v)
      : typeof value === "boolean"
        ? (value ? "yes" : "no") === v
        : value === v;
  const multi = q.type === "multi_choice";

  return (
    <fieldset aria-describedby={`${id}-hint`} className="space-y-2">
      <legend className="text-sm font-medium text-ink">
        {isNew && <NewBadge />}
        {q.text}
        {q.required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">
            *
          </span>
        )}
        {multi && <span className="ml-1 font-normal text-ink-muted">(choose any)</span>}
      </legend>
      {hidden}
      {aiBar}
      <p id={`${id}-hint`} className="text-xs text-ink-muted">
        {q.why}
      </p>
      <div className={q.type === "boolean" ? "flex gap-2" : "grid gap-2 sm:grid-cols-2"}>
        {options.map((o) => (
          <label key={o.value} className={choice}>
            <input
              type={multi ? "checkbox" : "radio"}
              name={q.key}
              value={o.value}
              defaultChecked={checked(o.value)}
              required={q.required && !multi}
              className={control}
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function NewBadge() {
  return (
    <Badge tone="info" className="mr-2 align-middle">
      New
    </Badge>
  );
}
