import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { dismissSuggestionAction, generatePlanAction } from "@/modules/planning/actions";
import { getPlanView } from "@/modules/planning/service";
import { acceptPlanAction } from "@/modules/tasks/actions";
import type { StoredTask } from "@/modules/planning/schemas";

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
  const { event, canEdit, missing, current, evidence } = await getPlanView(eventId);
  const titles = new Map(current?.tasks.map((t) => [t.task.tempId, t.task.title]) ?? []);

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}`} className="text-ink-muted hover:text-ink">
          ← {event.name}
        </Link>
      </nav>
      <PageHeader
        title="Plan"
        description="A draft plan built from the playbook for your event type and your interview answers: tasks, budget, schedule and risks."
      />

      <Alert title="This is a draft for you to review">
        Nothing here is assigned or booked yet. Deadlines are calculated from your event dates.
        Budget figures are illustrative allowances, not quotes. Nothing has been confirmed with any
        venue, provider or authority, and compliance topics stay unverified until checked against an
        official source.
      </Alert>

      {missing.length > 0 && (
        <Alert tone="info" title="A few details would sharpen this plan">
          <ul className="list-disc pl-5">
            {missing.map((m) => (
              <li key={m.key}>{m.label}</li>
            ))}
          </ul>
          <p className="mt-2">
            You can generate a draft now: it states an assumption for each missing detail.{" "}
            <Link href={`/app/events/${event.id}/interview`} className="text-primary underline">
              Answer them in the planning interview
            </Link>
          </p>
        </Alert>
      )}

      {canEdit && (
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
              ? "Regenerating rebuilds the draft from your latest answers and replaces all open proposals."
              : "The draft is built from your event details and interview answers."}
          </p>
        </ActionForm>
      )}

      {!current ? (
        <EmptyState
          title="No plan yet"
          description={
            canEdit
              ? "Answer the planning interview if you haven't, then generate your draft plan."
              : "The event's owner or organizers haven't generated a plan yet."
          }
        />
      ) : (
        <section aria-labelledby="plan-heading" className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="plan-heading" className="text-lg font-semibold">
              {current.tasks.length} suggested task{current.tasks.length === 1 ? "" : "s"}
            </h2>
          </div>
          {canEdit && current.tasks.length > 0 && (
            <ActionForm
              action={acceptPlanAction.bind(null, event.id, current.plan.id)}
              className="flex flex-wrap items-center gap-3 space-y-0"
              aria-label="Add the suggested tasks"
            >
              <SubmitButton>Add these tasks to the workspace</SubmitButton>
              <span className="text-sm text-ink-muted">
                Creates real tasks with these deadlines and dependencies. Dismiss the ones you
                don&apos;t want first; you can edit tasks once they are in the workspace.
              </span>
            </ActionForm>
          )}
          {current.plan.overview && (
            <Overview overview={current.plan.overview} currency={event.currency} />
          )}
          {current.plan.assumptions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Assumptions</CardTitle>
                <CardDescription>
                  The plan assumes the following where details are missing. Answer the matching
                  question in the planning interview and regenerate to replace an assumption.
                </CardDescription>
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
          <Card>
            <CardHeader>
              <CardTitle>Deadlines</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="list-disc space-y-1 pl-5 text-sm">
                {current.tasks.map((t) => (
                  <li key={t.id}>
                    {formatDate(t.task.dueDate)} — {t.task.title}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>

          <ol className="space-y-4">
            {current.tasks.map(({ id, task: t }) => (
              <li key={id}>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={PRIORITY_TONE[t.priority]}>{t.priority}</Badge>
                      <Badge>{t.category}</Badge>
                      <Badge>{CONFIDENCE_LABEL[t.confidence]}</Badge>
                    </div>
                    <CardTitle>{t.title}</CardTitle>
                    <CardDescription>{t.description}</CardDescription>
                  </CardHeader>
                  <CardBody className="space-y-3 text-sm">
                    <dl className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <dt className="text-xs text-ink-muted">Suggested deadline</dt>
                        <dd>{formatDate(t.dueDate)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-ink-muted">Suggested owner (role)</dt>
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
                        <span className="text-xs text-ink-muted">Still needed: </span>
                        {t.requiredInfo.join("; ")}
                      </p>
                    )}
                    {t.uncertainty && (
                      <p className="text-ink-muted">
                        <span className="text-xs">Note: </span>
                        {t.uncertainty}
                      </p>
                    )}
                    {t.evidenceIds.length > 0 && (
                      <p className="text-xs text-ink-muted">
                        Based on:{" "}
                        {t.evidenceIds
                          .map((e) => evidence.get(e) ?? "an answer that has since changed")
                          .join("; ")}
                      </p>
                    )}
                    {t.warnings.map((w) => (
                      <Alert key={w} tone="warning" title={w} />
                    ))}
                    {canEdit && (
                      <div className="flex flex-wrap items-start gap-3 border-t border-line pt-3">
                        <ActionForm
                          action={dismissSuggestionAction.bind(null, event.id, id)}
                          className="space-y-2"
                        >
                          <SubmitButton variant="ghost" size="sm">
                            Dismiss this task
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

function Overview({
  overview,
  currency,
}: {
  overview: NonNullable<Awaited<ReturnType<typeof getPlanView>>["current"]>["plan"]["overview"] &
    object;
  currency: string;
}) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Summary and goals</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4 text-sm">
          <p>{overview.summary}</p>
          <OverviewList title="Goals" items={overview.goals} />
          <OverviewList title="What the event needs" items={overview.requirements} />
        </CardBody>
      </Card>

      {(overview.decisions.length > 0 || overview.followUpQuestions.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>Open decisions and questions</CardTitle>
            <CardDescription>
              These would change the plan the most. Answers go in the planning interview.
            </CardDescription>
          </CardHeader>
          <CardBody className="space-y-4 text-sm">
            <OverviewList title="Decisions still to make" items={overview.decisions} />
            {overview.followUpQuestions.length > 0 && (
              <div>
                <h3 className="mb-1 font-medium">Questions to answer</h3>
                <ul className="list-disc space-y-1 pl-5">
                  {overview.followUpQuestions.map((q, i) => (
                    <li key={i}>
                      {q.question}
                      {q.why ? <span className="text-ink-muted"> — {q.why}</span> : null}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {overview.budgetCategories.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Budget estimate</CardTitle>
            <CardDescription>
              Illustrative allowances for planning, not quotes. Replace them with real quotes.
            </CardDescription>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            {overview.budgetSummary && <p>{overview.budgetSummary}</p>}
            <ul className="list-disc space-y-1 pl-5">
              {overview.budgetCategories.map((b, i) => (
                <li key={i}>
                  <span className="font-medium">{b.name}:</span>{" "}
                  {b.estimatedAmount > 0
                    ? `about ${b.estimatedAmount.toLocaleString("en-US")} ${currency}`
                    : "not estimated"}
                  {b.note ? <span className="text-ink-muted"> — {b.note}</span> : null}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {overview.schedule.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Event-day schedule</CardTitle>
            <CardDescription>
              A starting timetable in the event&apos;s timezone. Adjust it to the real programme.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <ul className="space-y-1 text-sm">
              {overview.schedule.map((b, i) => (
                <li key={i} className="flex flex-wrap gap-x-3">
                  <span className="w-44 shrink-0 text-ink-muted tabular-nums">
                    {i === 0 || overview.schedule[i - 1].date !== b.date
                      ? `${formatDate(b.date)} · `
                      : ""}
                    {b.start}–{b.end}
                  </span>
                  <span>
                    <span className="font-medium">{b.title}</span>
                    {b.note ? <span className="text-ink-muted"> — {b.note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      {overview.risks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Risks and fallback plans</CardTitle>
          </CardHeader>
          <CardBody>
            <ul className="space-y-3 text-sm">
              {overview.risks.map((r, i) => (
                <li key={i}>
                  <p>
                    <span className="font-medium">{r.title}</span>{" "}
                    <Badge
                      tone={
                        r.likelihood === "high"
                          ? "danger"
                          : r.likelihood === "medium"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {r.likelihood} likelihood
                    </Badge>
                  </p>
                  <p>{r.mitigation}</p>
                  {r.contingency && (
                    <p className="text-ink-muted">If it happens anyway: {r.contingency}</p>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </>
  );
}

function OverviewList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 font-medium">{title}</h3>
      <ul className="list-disc space-y-1 pl-5">
        {items.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  );
}

/** Data-dependent route behind the app shell Suspense; blocking navigation is intended. */
export const instant = false;
