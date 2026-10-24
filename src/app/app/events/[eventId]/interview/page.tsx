import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { InterviewQuestion } from "@/components/events/interview-question";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { dismissSuggestionAction } from "@/modules/planning/actions";
import { Textarea } from "@/components/ui/input";
import { saveEventDetailsAction, saveInterviewAction } from "@/modules/events/actions";
import { EVENT_DETAILS_MAX } from "@/modules/events/schemas";
import { formatAnswer } from "@/modules/events/interview-rules";
import { getInterview } from "@/modules/events/service";

export const metadata: Metadata = { title: "Talk to Hala" };

const DETAILS_PLACEHOLDER = [
  "For example:",
  "- Venue: prefer a ground-floor hall near the metro; no outdoor areas in summer.",
  "- Catering: vegetarian and vegan options; two guests have nut allergies.",
  "- Transport: shuttle from the main campus gate every 30 minutes.",
  "- Accessibility: step-free access and two wheelchair spaces near the stage.",
  "- Equipment: two projectors, wireless microphones, power at every table.",
  "- Special arrangements: prayer room, quiet room, parking for 20 cars.",
].join("\n");

export default async function InterviewPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  const { event, role, playbook, state, followUps, missing, canEdit } = await getInterview(eventId);
  const labels = Object.fromEntries(
    [...playbook.questions, ...[...followUps.values()].map((f) => f.question)].map((q) => [
      q.key,
      q.text,
    ]),
  );
  labels.form = "Form";
  const followUp = (key: string) => {
    const f = followUps.get(key);
    return f && { suggestionId: f.id };
  };

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}`} className="text-ink-muted hover:text-ink">
          ← {event.name}
        </Link>
      </nav>
      <PageHeader
        title="Talk to Hala"
        description="Your answers decide which tasks and checks the plan will suggest. You can change them while the event is being planned."
        badge={
          <Badge>
            Playbook: {playbook.title} · v{playbook.version}
          </Badge>
        }
      />

      <Alert title="Why you are asked these questions">
        Each question appears because of your event type, your event details or an earlier answer.
        You don&rsquo;t have to answer everything: the plan states an assumption for anything left
        open. Nothing here is a legal or permit requirement.
      </Alert>

      {!canEdit && (
        <Alert tone="warning" title="Read only">
          {role === "viewer"
            ? "Only the event's owner and organizers can answer the interview."
            : `This event is ${event.status}, so its answers can no longer be changed.`}
        </Alert>
      )}

      {canEdit ? (
        <ActionForm
          action={saveInterviewAction.bind(null, event.id)}
          labels={labels}
          aria-label="Talk to Hala"
          className="space-y-6"
        >
          {state.next.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Next questions</CardTitle>
                <CardDescription>
                  Questions marked * matter most for the plan. Saving can bring up further
                  questions.
                </CardDescription>
              </CardHeader>
              <CardBody className="space-y-6">
                {state.next.map((q) => (
                  <InterviewQuestion key={q.key} question={q} isNew followUp={followUp(q.key)} />
                ))}
              </CardBody>
            </Card>
          ) : (
            <Alert tone="success" title="Every question is answered">
              Changing an answer below can bring up new questions.
            </Alert>
          )}

          {state.answered.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Your answers</CardTitle>
                <CardDescription>
                  {state.answered.length} answered. Edit any of them and save.
                </CardDescription>
              </CardHeader>
              <CardBody className="space-y-6">
                {state.answered.map(({ question, value }) => (
                  <InterviewQuestion
                    key={question.key}
                    question={question}
                    value={value}
                    followUp={followUp(question.key)}
                  />
                ))}
              </CardBody>
            </Card>
          )}

          <SubmitButton>Save answers</SubmitButton>
        </ActionForm>
      ) : state.answered.length === 0 ? (
        <EmptyState
          title="No answers yet"
          description="The event's owner or organizers haven't started the interview."
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Answers</CardTitle>
          </CardHeader>
          <CardBody>
            <dl className="divide-y divide-line text-sm">
              {state.answered.map(({ question, value }) => (
                <div key={question.key} className="grid gap-1 py-3 sm:grid-cols-2">
                  <dt className="text-ink-muted">{question.text}</dt>
                  <dd>{formatAnswer(question, value)}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
      )}

      {canEdit &&
        [...followUps.values()].map((f) => (
          <ActionForm
            key={f.id}
            id={`dismiss-${f.id}`}
            action={dismissSuggestionAction.bind(null, event.id, f.id)}
            className="space-y-0"
          >
            {null}
          </ActionForm>
        ))}

      <Card>
        <CardHeader>
          <CardTitle>Additional event details</CardTitle>
          <CardDescription>
            Optional. Anything the questions above didn&rsquo;t cover: requirements, preferences,
            special circumstances or constraints. Custom plan drafts take it into account; your
            answers above still count as the event&rsquo;s facts, and a draft points out anything
            here that disagrees with them.
          </CardDescription>
        </CardHeader>
        <CardBody>
          {canEdit ? (
            <ActionForm
              action={saveEventDetailsAction.bind(null, event.id)}
              labels={{ details: "Additional event details" }}
              aria-label="Additional event details"
              className="space-y-3"
            >
              <label htmlFor="event-details" className="sr-only">
                Additional event details
              </label>
              <Textarea
                id="event-details"
                name="details"
                rows={7}
                maxLength={EVENT_DETAILS_MAX}
                defaultValue={event.additional_details ?? ""}
                placeholder={DETAILS_PLACEHOLDER}
              />
              <p className="text-xs text-ink-muted">
                Up to {EVENT_DETAILS_MAX.toLocaleString("en-US")} characters. Leave it empty if
                there&rsquo;s nothing to add. Don&rsquo;t include passwords or other people&rsquo;s
                private details.
              </p>
              <SubmitButton variant="secondary">Save details</SubmitButton>
            </ActionForm>
          ) : event.additional_details ? (
            <p className="text-sm whitespace-pre-line">{event.additional_details}</p>
          ) : (
            <p className="text-sm text-ink-muted">No additional details.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ready to plan?</CardTitle>
          <CardDescription>
            {missing.length === 0
              ? "There's enough information to generate a useful plan."
              : "You can generate a draft now. These answers would make it more accurate:"}
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          {missing.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {missing.map((m) => (
                <li key={m.key}>{m.label}</li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-start gap-3">
            <ButtonLink
              href={`/app/events/${event.id}/plan`}
              variant={missing.length === 0 ? "primary" : "secondary"}
            >
              Go to the plan
            </ButtonLink>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

/** Data-dependent route behind the app shell Suspense; blocking navigation is intended. */
export const instant = false;
