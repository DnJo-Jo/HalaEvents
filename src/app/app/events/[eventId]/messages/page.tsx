import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, MockBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatInZone } from "@/lib/dates";
import {
  aiDraftAction,
  cancelMessageAction,
  decideApprovalAction,
  requestSendApprovalAction,
  saveDraftAction,
  sendApprovedAction,
} from "@/modules/comms/actions";
import {
  APPROVAL_LABELS,
  AUDIENCE_LABELS,
  COMM_STATUS_LABELS,
  DEFAULT_AUDIENCE,
  DELIVERY_LABELS,
  EDITABLE,
  KIND_LABELS,
  PLACEHOLDERS,
  personalize,
} from "@/modules/comms/rules";
import { Audience, CommunicationKind } from "@/modules/comms/schemas";
import { getMessagesView, messageVars } from "@/modules/comms/service";
import type { AttendeeRow } from "@/modules/attendees/repo";

export const metadata: Metadata = { title: "Messages" };

function AudienceFields({
  attendees,
  kind,
  audience,
  attendeeId,
}: {
  attendees: AttendeeRow[];
  kind?: string;
  audience?: string;
  attendeeId?: string | null;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <FormField label="Kind">
        <Select name="kind" defaultValue={kind ?? "reminder"}>
          {CommunicationKind.options.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        label="Recipients"
        hint="Chosen from attendee statuses when approval is requested."
      >
        <Select name="audience" defaultValue={audience ?? DEFAULT_AUDIENCE.reminder}>
          {Audience.options.map((a) => (
            <option key={a} value={a}>
              {AUDIENCE_LABELS[a]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField label="Person (only for “One person”)">
        <Select name="attendeeId" defaultValue={attendeeId ?? ""}>
          <option value="">—</option>
          {attendees
            .filter((a) => a.registration_status !== "withdrawn")
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.full_name}
              </option>
            ))}
        </Select>
      </FormField>
    </div>
  );
}

export default async function MessagesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  const v = await getMessagesView(eventId);
  const { event } = v;
  const placeholders = PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ");

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}`} className="text-ink-muted hover:text-ink">
          ← {event.name}
        </Link>
      </nav>
      <PageHeader
        title="Messages"
        description="Drafts → approval of the exact text and recipients → send. Editing anything after a request needs a new approval."
        badge={
          v.transport.isSimulated ? (
            <MockBadge />
          ) : (
            <Badge tone="primary">Email via {v.transport.name}</Badge>
          )
        }
      />
      {!v.canManage ? (
        <Alert tone="info" title="Organizers only">
          Messages contain attendee details, so only the event&apos;s owner and organizers can see
          them.
        </Alert>
      ) : (
        <>
          {v.transport.isSimulated && (
            <Alert tone="warning" title="Simulated sending">
              Email is in mock mode: “sending” records a simulated delivery for each recipient and
              emails nobody. Set EMAIL_PROVIDER=resend with a verified sender to send for real.
            </Alert>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Write a draft</CardTitle>
              </CardHeader>
              <CardBody>
                <ActionForm
                  action={saveDraftAction.bind(null, event.id, null)}
                  resetOnSuccess
                  labels={{ subject: "Subject", body: "Message", attendeeId: "Person" }}
                >
                  <AudienceFields attendees={v.attendees} />
                  <FormField label="Subject" required>
                    <Input name="subject" required minLength={3} maxLength={200} />
                  </FormField>
                  <FormField
                    label="Message"
                    required
                    hint={`Placeholders filled per recipient: ${placeholders}.`}
                  >
                    <Textarea name="body" required minLength={10} maxLength={5000} rows={6} />
                  </FormField>
                  <SubmitButton>Save draft</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Draft with AI</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3 text-sm">
                <p className="text-ink-muted">
                  The AI gets the event name, the kind of message and your notes, never attendee
                  details. Its text is checked (placeholders, no links, no claims about permits or
                  bookings) and saved as a draft for you to edit. It can&apos;t send anything.
                </p>
                <ActionForm action={aiDraftAction.bind(null, event.id)}>
                  <AudienceFields attendees={v.attendees} />
                  <FormField
                    label="Notes for the draft"
                    hint="e.g. “doors open 8:30, bring a laptop”"
                  >
                    <Textarea name="instructions" maxLength={500} rows={3} />
                  </FormField>
                  <SubmitButton variant="secondary">Draft with AI</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          </div>

          {v.messages.length === 0 ? (
            <EmptyState
              title="No messages yet"
              description="Write a draft or ask the AI for one."
            />
          ) : (
            <ul className="space-y-4">
              {v.messages.map((m) => {
                const approvals = v.approvals.filter((a) => a.target_id === m.id);
                const live = approvals.find((a) =>
                  ["pending", "approved", "executing"].includes(a.status),
                );
                const recipients = v.recipients.get(m.id) ?? [];
                const deliveries = v.deliveries.filter((d) => d.communication_id === m.id);
                const sample = recipients[0];
                const vars = messageVars(event, sample?.name ?? "{{name}}");
                const payload = live?.payload as
                  | {
                      subject?: string;
                      body?: string;
                      recipients?: { email: string; name: string }[];
                    }
                  | undefined;
                return (
                  <li key={m.id}>
                    <Card>
                      <CardBody className="space-y-3 text-sm">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="font-medium">{m.subject}</p>
                            <p className="text-xs text-ink-muted">
                              {KIND_LABELS[m.kind]} · {AUDIENCE_LABELS[m.audience]} · version{" "}
                              {m.version}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            <Badge>{COMM_STATUS_LABELS[m.status]}</Badge>
                            {m.recovery_plan_id && (
                              <Badge tone="warning">Simulated recovery · never sent for real</Badge>
                            )}
                            {m.drafted_by === "ai" &&
                              (m.is_mock_draft ? (
                                <MockBadge />
                              ) : (
                                <Badge tone="accent">AI draft</Badge>
                              ))}
                          </div>
                        </div>

                        {EDITABLE.includes(m.status) && (
                          <div className="rounded border border-line p-3">
                            <p className="text-xs text-ink-muted">
                              Preview for {sample ? sample.name : "a recipient"} ·{" "}
                              {recipients.length} recipient
                              {recipients.length === 1 ? "" : "s"} now
                              {recipients.length > 0 &&
                                `: ${recipients
                                  .slice(0, 8)
                                  .map((r) => r.email)
                                  .join(", ")}${recipients.length > 8 ? "…" : ""}`}
                            </p>
                            <p className="mt-2 font-medium">{personalize(m.subject, vars)}</p>
                            <p className="whitespace-pre-wrap">{personalize(m.body, vars)}</p>
                          </div>
                        )}

                        {live && payload && (
                          <div className="space-y-2 rounded border border-primary/40 p-3">
                            <p className="font-medium">
                              Approval: {APPROVAL_LABELS[live.status]}{" "}
                              <span className="text-xs text-ink-muted">
                                (requested {formatInZone(live.requested_at, event.timezone)};
                                payload {live.payload_hash.slice(0, 12)}…)
                              </span>
                            </p>
                            <p className="text-xs text-ink-muted">
                              Exactly what will be sent: subject “{payload.subject}”, the text
                              below, to {payload.recipients?.length ?? 0} recipient(s):{" "}
                              {payload.recipients?.map((r) => r.email).join(", ")}
                            </p>
                            <p className="text-xs whitespace-pre-wrap">{payload.body}</p>
                            {live.status === "pending" && (
                              <ActionForm
                                action={decideApprovalAction.bind(null, event.id, live.id)}
                                className="flex flex-wrap items-end gap-2 space-y-0"
                                aria-label="Decide approval"
                              >
                                <FormField label="Decision">
                                  <Select name="decision" defaultValue="approve">
                                    <option value="approve">Approve this exact message</option>
                                    <option value="reject">Reject</option>
                                  </Select>
                                </FormField>
                                <FormField label="Note">
                                  <Input name="note" maxLength={500} />
                                </FormField>
                                <SubmitButton size="sm">Record decision</SubmitButton>
                              </ActionForm>
                            )}
                            {live.status === "approved" && (
                              <ActionForm
                                action={sendApprovedAction.bind(null, event.id, live.id)}
                                className="space-y-0"
                                aria-label="Send approved message"
                              >
                                <SubmitButton size="sm">
                                  {v.transport.isSimulated ? "Send (simulated)" : "Send now"}
                                </SubmitButton>
                              </ActionForm>
                            )}
                            {live.status === "executing" && (
                              <Alert tone="warning" title="Needs a check">
                                Sending started but didn&apos;t finish. It won&apos;t be retried
                                automatically; check with the email provider before sending again.
                              </Alert>
                            )}
                          </div>
                        )}

                        {m.status === "draft" && (
                          <div className="flex flex-wrap gap-2">
                            <ActionForm
                              action={requestSendApprovalAction.bind(null, event.id, m.id)}
                              className="space-y-0"
                            >
                              <SubmitButton size="sm" disabled={recipients.length === 0}>
                                Request approval to send
                              </SubmitButton>
                            </ActionForm>
                          </div>
                        )}

                        {EDITABLE.includes(m.status) && (
                          <details>
                            <summary className="cursor-pointer text-primary">Edit draft</summary>
                            <ActionForm
                              action={saveDraftAction.bind(null, event.id, m.id)}
                              className="mt-3"
                              labels={{ subject: "Subject", body: "Message" }}
                            >
                              <AudienceFields
                                attendees={v.attendees}
                                kind={m.kind}
                                audience={m.audience}
                                attendeeId={m.attendee_id}
                              />
                              <FormField label="Subject" required>
                                <Input
                                  name="subject"
                                  required
                                  maxLength={200}
                                  defaultValue={m.subject}
                                />
                              </FormField>
                              <FormField label="Message" required>
                                <Textarea
                                  name="body"
                                  required
                                  maxLength={5000}
                                  rows={6}
                                  defaultValue={m.body}
                                />
                              </FormField>
                              <SubmitButton size="sm" variant="secondary">
                                Save (needs a new approval)
                              </SubmitButton>
                            </ActionForm>
                            <ActionForm
                              action={cancelMessageAction.bind(null, event.id, m.id)}
                              className="mt-2 space-y-0"
                            >
                              <SubmitButton size="sm" variant="ghost">
                                Cancel message
                              </SubmitButton>
                            </ActionForm>
                          </details>
                        )}

                        {deliveries.length > 0 && (
                          <div>
                            <p className="text-xs text-ink-muted">
                              Delivery (per recipient, as reported by the transport)
                            </p>
                            <ul className="mt-1 space-y-1">
                              {deliveries.map((d) => (
                                <li key={d.id} className="flex flex-wrap items-center gap-2">
                                  <span>{d.email}</span>
                                  <Badge
                                    tone={
                                      d.status === "failed"
                                        ? "danger"
                                        : d.is_simulated
                                          ? "warning"
                                          : "info"
                                    }
                                  >
                                    {DELIVERY_LABELS[d.status]}
                                  </Badge>
                                  {d.error && (
                                    <span className="text-xs text-danger">{d.error}</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {approvals.filter((a) => a !== live).length > 0 && (
                          <p className="text-xs text-ink-muted">
                            Earlier approvals:{" "}
                            {approvals
                              .filter((a) => a !== live)
                              .map(
                                (a) =>
                                  `${APPROVAL_LABELS[a.status]}${a.failure_reason ? ` (${a.failure_reason.replace(/_/g, " ")})` : ""}`,
                              )
                              .join(" · ")}
                          </p>
                        )}
                      </CardBody>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
