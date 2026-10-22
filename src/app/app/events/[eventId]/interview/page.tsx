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
import { dismissSuggestionAction, suggestFollowUpsAction } from "@/modules/ai/actions";
import { saveInterviewAction } from "@/modules/events/actions";
import { formatAnswer } from "@/modules/events/interview-rules";
import { getInterview } from "@/modules/events/service";

export const metadata: Metadata = { title: "Planning interview" };

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
  labels.note = "Change request";
  const playbookPending = state.next.some((q) => !followUps.has(q.key));
  const ai = (key: string) => {
    const f = followUps.get(key);
    return f && { suggestionId: f.id, isMock: f.isMock };
  };

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}`} className="text-ink-muted hover:text-ink">
          ← {event.name}
        </Link>
      </nav>
      <PageHeader
        title="Planning interview"
        description="Your answers decide which tasks and checks the plan will suggest. You can change them while the event is being planned."
        badge={
          <Badge>
            Playbook: {playbook.title} · v{playbook.version}
          </Badge>
        }
      />

      <Alert title="Questions come from the HalaEvents playbook">
        Each question appears because of the event details or an earlier answer. After them you can
        ask the AI assistant for optional follow-ups. Answers are sent to the AI service when you
        request suggestions or a plan, so don&rsquo;t include personal data. Nothing here is a legal
        or permit requirement.
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
          aria-label="Planning interview"
          className="space-y-6"
        >
          {state.next.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>Next questions</CardTitle>
                <CardDescription>
                  Questions marked * need an answer. Saving can bring up follow-up questions.
                </CardDescription>
              </CardHeader>
              <CardBody className="space-y-6">
                {state.next.map((q) => (
                  <InterviewQuestion key={q.key} question={q} isNew ai={ai(q.key)} />
                ))}
              </CardBody>
            </Card>
          ) : (
            <Alert tone="success" title="Every playbook question is answered">
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
                    ai={ai(question.key)}
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
          <CardTitle>Ready to plan?</CardTitle>
          <CardDescription>
            {missing.length === 0
              ? "There's enough information to generate a useful plan."
              : "The plan needs these answers first:"}
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
            {canEdit && !playbookPending && (
              <ActionForm
                action={suggestFollowUpsAction.bind(null, event.id)}
                aria-label="Suggest follow-up questions"
                className="space-y-2"
              >
                <SubmitButton variant="secondary">Suggest follow-up questions (AI)</SubmitButton>
              </ActionForm>
            )}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
