import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, MockBadge, type BadgeTone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  dismissSuggestionAction,
  generatePlanAction,
  reviseTaskAction,
} from "@/modules/ai/actions";
import { getPlanView } from "@/modules/ai/service";
import { acceptPlanAction } from "@/modules/tasks/actions";
import type { StoredTask } from "@/modules/ai/schemas";

export const metadata: Metadata = { title: "Plan" };

const PRIORITY_TONE: Record<StoredTask["priority"], BadgeTone> = {
  critical: "danger",
  high: "warning",
  medium: "info",
  low: "neutral",
};
const CONFIDENCE_LABEL: Record<StoredTask["confidence"], string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

const formatDate = (d: string) =>
  new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${d}T00:00:00Z`));

export default async function PlanPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  const { event, canEdit, missing, current, evidence, provider } = await getPlanView(eventId);
  const titles = new Map(current?.tasks.map((t) => [t.task.tempId, t.task.title]) ?? []);

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}`} className="text-ink-muted hover:text-ink">
          ← {event.name}
        </Link>
      </nav>
      <PageHeader
        title="Plan proposals"
        description="Suggested tasks with deadlines and dependencies, built from the playbook and your interview answers."
        badge={
          provider.isMock ? (
            <span className="flex gap-1.5">
              <MockBadge />
              <Badge>AI: mock provider</Badge>
            </span>
          ) : (
            <Badge>AI: Gemini</Badge>
          )
        }
      />

      <Alert title="These are proposals, not tasks">
        Nothing here is assigned or scheduled yet. Deadlines were calculated by HalaEvents from the
        event dates. Turning proposals into tasks arrives with the task module. Compliance topics
        are unverified until checked against an official source.
      </Alert>

      {missing.length > 0 && (
        <Alert tone="warning" title="The plan needs more information">
          <ul className="list-disc pl-5">
            {missing.map((m) => (
              <li key={m.key}>{m.label}</li>
            ))}
          </ul>
          <p className="mt-2">
            <Link href={`/app/events/${event.id}/interview`} className="text-primary underline">
              Answer them in the planning interview
            </Link>
          </p>
        </Alert>
      )}

      {canEdit && missing.length === 0 && (
        <ActionForm
          action={generatePlanAction.bind(null, event.id)}
          aria-label="Generate plan"
          className="space-y-3"
        >
          <div className="flex flex-wrap gap-2">
            {current ? (
              <SubmitButton name="intent" value="regenerate" variant="secondary">
                Regenerate plan
              </SubmitButton>
            ) : (
              <SubmitButton name="intent" value="generate">
                Generate plan
              </SubmitButton>
            )}
          </div>
          <p className="text-xs text-ink-muted">
            {current
              ? "Regenerating replaces all open proposals and uses one AI request. If your answers haven't changed, the saved plan is kept."
              : "Uses one AI request. If the AI is unavailable, a plan is built from the playbook instead."}
          </p>
        </ActionForm>
      )}

      {!current ? (
        <EmptyState
          title="No plan yet"
          description={
            canEdit
              ? "Answer the interview, then generate a plan."
              : "The event's owner or organizers haven't generated a plan yet."
          }
        />
      ) : (
        <section aria-labelledby="plan-heading" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="plan-heading" className="text-lg font-semibold">
              {current.tasks.length} proposed task{current.tasks.length === 1 ? "" : "s"}
            </h2>
            {current.plan.source === "playbook" ? (
              <Badge tone="accent">Built from the playbook · no AI</Badge>
            ) : current.plan.is_mock ? (
              <MockBadge />
            ) : (
              <Badge tone="primary">AI-generated</Badge>
            )}
          </div>
          {canEdit && current.tasks.length > 0 && (
            <ActionForm
              action={acceptPlanAction.bind(null, event.id, current.plan.id)}
              className="flex flex-wrap items-center gap-3 space-y-0"
              aria-label="Accept the proposed tasks"
            >
              <SubmitButton>Accept all proposed tasks into the workspace</SubmitButton>
              <span className="text-sm text-ink-muted">
                Creates real tasks with these deadlines and dependencies. Dismiss the ones you
                don&apos;t want first.
              </span>
            </ActionForm>
          )}
          {current.plan.assumptions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Assumptions</CardTitle>
              </CardHeader>
              <CardBody>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {current.plan.assumptions.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}

          <ol className="space-y-4">
            {current.tasks.map(({ id, revision, task: t }) => (
              <li key={id}>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                      <Badge>{t.category}</Badge>
                      <Badge>{CONFIDENCE_LABEL[t.confidence]}</Badge>
                      {revision > 1 && <Badge tone="info">Revised</Badge>}
                    </div>
                    <CardTitle>{t.title}</CardTitle>
                    <CardDescription>{t.description}</CardDescription>
                  </CardHeader>
                  <CardBody className="space-y-3 text-sm">
                    <dl className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-ink-muted">Proposed deadline</dt>
                        <dd>{formatDate(t.dueDate)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-ink-muted">Proposed owner (role)</dt>
                        <dd>{t.proposedOwner}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-ink-muted">Depends on</dt>
                        <dd>
                          {t.dependsOn.length
                            ? t.dependsOn.map((d) => titles.get(d) ?? `${d} (dismissed)`).join("; ")
                            : "Nothing"}
                        </dd>
                      </div>
                    </dl>
                    <p>
                      <span className="text-xs text-ink-muted">Next action: </span>
                      {t.nextAction}
                    </p>
                    {t.requiredInfo.length > 0 && (
                      <p>
                        <span className="text-xs text-ink-muted">Needs: </span>
                        {t.requiredInfo.join("; ")}
                      </p>
                    )}
                    {t.uncertainty && (
                      <p className="text-ink-muted">
                        <span className="text-xs">Uncertain: </span>
                        {t.uncertainty}
                      </p>
                    )}
                    <p className="text-xs text-ink-muted">
                      Based on:{" "}
                      {t.evidenceIds.length
                        ? t.evidenceIds
                            .map((e) => evidence.get(e) ?? `${e} (no longer current)`)
                            .join("; ")
                        : "no cited evidence"}
                    </p>
                    {t.changeSummary && (
                      <p className="text-xs text-ink-muted">Last revision: {t.changeSummary}</p>
                    )}
                    {t.warnings.map((w) => (
                      <Alert key={w} tone="warning" title={w} />
                    ))}
                    {canEdit && (
                      <div className="flex flex-wrap items-start gap-3 border-t border-line pt-3">
                        <details className="min-w-64 flex-1">
                          <summary className="cursor-pointer text-sm font-medium text-primary">
                            Ask AI to revise this task
                          </summary>
                          <ActionForm
                            action={reviseTaskAction.bind(null, event.id, id)}
                            labels={{ note: "Change request" }}
                            className="mt-3 space-y-3"
                          >
                            <FormField
                              label="What should change?"
                              hint="Only this task is revised; the rest of the plan stays as it is."
                              required
                            >
                              <Textarea
                                id={`note-${id}`}
                                name="note"
                                maxLength={300}
                                className="min-h-16"
                              />
                            </FormField>
                            <SubmitButton size="sm">Revise task</SubmitButton>
                          </ActionForm>
                        </details>
                        <ActionForm
                          action={dismissSuggestionAction.bind(null, event.id, id)}
                          className="space-y-2"
                        >
                          <SubmitButton variant="ghost" size="sm">
                            Dismiss
                          </SubmitButton>
                        </ActionForm>
                      </div>
                    )}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ol>
        </section>
      )}

      <p className="text-sm">
        <ButtonLink href={`/app/events/${event.id}/interview`} variant="ghost" size="sm">
          Back to the planning interview
        </ButtonLink>
      </p>
    </div>
  );
}
