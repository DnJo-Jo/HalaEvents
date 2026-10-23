import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatInZone } from "@/lib/dates";
import { APPROVAL_LABELS } from "@/modules/comms/rules";
import type { ApprovalRow } from "@/modules/comms/repo";
import {
  applyApprovedAction,
  closeIncidentAction,
  decideAction,
  discardInquiryAction,
  editInquiryAction,
  generateRecoveryAction,
  recordInquiryAction,
  rejectPlanAction,
  requestApprovalAction,
  resolveFlagAction,
  selectChangesAction,
} from "@/modules/recovery/actions";
import {
  CHANGE_LABELS,
  FLAG_LABELS,
  INCIDENT_LABELS,
  INQUIRY_LABELS,
  PLAN_LABELS,
  PURPOSE_LABELS,
} from "@/modules/recovery/rules";
import type { Impact } from "@/modules/recovery/schemas";
import { getIncidentView } from "@/modules/recovery/service";

export const metadata: Metadata = { title: "Venue cancellation recovery" };

const money = (n: number, c: string) => `${n.toLocaleString("en-GB")} ${c}`;
const live = (list: ApprovalRow[], action: string, target: string) =>
  list.find(
    (a) =>
      a.action_type === action &&
      a.target_id === target &&
      ["pending", "approved", "executing"].includes(a.status),
  );

function entityLabel(impact: Impact, type: string | null, id: string | null): string {
  if (!id) return "";
  if (type === "task") return impact.affected_tasks.find((t) => t.id === id)?.title ?? "A task";
  if (type === "booking")
    return impact.services.find((s) => s.booking_id === id)?.provider_name ?? "A booking";
  if (type === "compliance_check")
    return impact.compliance.find((c) => c.id === id)?.title ?? "A compliance item";
  return "";
}

function DecisionForm({
  eventId,
  approval,
  what,
}: {
  eventId: string;
  approval: ApprovalRow;
  what: string;
}) {
  return (
    <ActionForm
      action={decideAction.bind(null, eventId, approval.id)}
      className="flex flex-wrap items-end gap-2 space-y-0"
      aria-label="Decide approval"
    >
      <FormField label="Decision">
        <Select name="decision" defaultValue="approve">
          <option value="approve">Approve {what}</option>
          <option value="reject">Reject</option>
        </Select>
      </FormField>
      <FormField label="Note">
        <Input name="note" maxLength={500} />
      </FormField>
      <SubmitButton size="sm">Record decision</SubmitButton>
    </ActionForm>
  );
}

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ eventId: string; incidentId: string }>;
}) {
  const { eventId, incidentId } = await params;
  if (!z.uuid().safeParse(eventId).success || !z.uuid().safeParse(incidentId).success) notFound();
  const v = await getIncidentView(eventId, incidentId);
  const { event, incident, current, impact } = { ...v, impact: v.incident.impact };
  const tz = event.timezone;
  const open = incident.status === "assessing" || incident.status === "replan_proposed";
  const proposal = current?.proposal;
  const proposed = current?.status === "proposed";
  const applyApproval = current ? live(v.approvals, "apply_recovery", current.id) : undefined;
  const recommended = proposal?.options.find((o) => o.key === proposal.recommendedOptionKey);
  const applyEntry = (applyApproval?.payload.changes ?? []) as {
    kind: keyof typeof CHANGE_LABELS;
    entity_type: string | null;
    entity_id: string | null;
    payload: Record<string, string>;
    current: Record<string, string> | null;
  }[];
  const attendeeMessage = v.messages.find((m) => m.recovery_plan_id === current?.id);
  const messageApproval = attendeeMessage
    ? v.approvals.find(
        (a) =>
          a.action_type === "send_communication" &&
          a.target_id === attendeeMessage.id &&
          ["pending", "approved", "executing", "executed"].includes(a.status),
      )
    : undefined;
  const openFlags = v.flags.filter((f) => f.status === "open");

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}/incidents`} className="text-ink-muted hover:text-ink">
          ← Crisis recovery
        </Link>
      </nav>
      <PageHeader
        title={`Venue cancellation: ${impact.venue.provider_name}`}
        description={`Simulated ${formatInZone(incident.simulated_at, tz)}${incident.note ? ` · ${incident.note}` : ""}`}
        badge={
          <span className="flex gap-1.5">
            <Badge tone="warning">Simulated</Badge>
            <Badge>{INCIDENT_LABELS[incident.status]}</Badge>
          </span>
        }
      />
      <Alert tone="warning" title="Practice scenario: nothing is real">
        The venue booking is unchanged, no provider was contacted and no attendee was told. Proposed
        changes apply only after you select them and an approval is recorded.
      </Alert>

      {/* 1. Original plan and what it touches ------------------------------------------------ */}
      <section aria-labelledby="impact" className="space-y-4">
        <h2 id="impact" className="text-lg font-semibold">
          1 · Original plan and affected items
        </h2>
        <p className="text-xs text-ink-muted">
          Worked out from the bookings and tasks recorded when the cancellation was simulated.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Venue booking</CardTitle>
            </CardHeader>
            <CardBody className="space-y-1 text-sm">
              <p className="font-medium">{impact.venue.provider_name}</p>
              <p>
                {formatInZone(impact.venue.service_from, tz)} →{" "}
                {formatInZone(impact.venue.service_to, tz)}
              </p>
              <p>
                {money(impact.venue.amount, impact.venue.currency)} · status{" "}
                {impact.venue.status.replaceAll("_", " ")} at the time
              </p>
              {impact.venue.conditions && (
                <p className="text-ink-muted">{impact.venue.conditions}</p>
              )}
              <p className="text-xs text-ink-muted">
                Cancelling the real booking is a separate, approval-gated action on the{" "}
                <Link href={`/app/events/${event.id}/bookings`} className="underline">
                  bookings page
                </Link>
                .
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tasks that depend on the venue ({impact.affected_tasks.length})</CardTitle>
            </CardHeader>
            <CardBody className="text-sm">
              {impact.affected_tasks.length === 0 ? (
                <p className="text-ink-muted">No venue tasks in the plan.</p>
              ) : (
                <ul className="space-y-1">
                  {impact.affected_tasks.map((t) => (
                    <li key={t.id}>
                      {t.title}{" "}
                      <span className="text-xs text-ink-muted">
                        · {t.status.replaceAll("_", " ")} · due {t.due_date ?? "no date"} ·{" "}
                        {t.reason === "venue_task" ? "venue work" : "waits for venue work"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Other bookings to reconfirm ({impact.services.length})</CardTitle>
            </CardHeader>
            <CardBody className="space-y-2 text-sm">
              <p className="text-xs text-ink-muted">
                Not cancelled. Their own terms apply, so they are marked for reconfirmation.
              </p>
              {impact.services.length === 0 ? (
                <p className="text-ink-muted">No service bookings.</p>
              ) : (
                <ul className="space-y-1">
                  {impact.services.map((s) => (
                    <li key={s.booking_id}>
                      {s.provider_name}{" "}
                      <span className="text-xs text-ink-muted">
                        · {s.category} · {s.status.replaceAll("_", " ")} ·{" "}
                        {money(s.amount, s.currency)}
                        {s.conditions ? ` · ${s.conditions}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Compliance and access to reassess ({impact.compliance.length})</CardTitle>
            </CardHeader>
            <CardBody className="text-sm">
              {impact.compliance.length === 0 ? (
                <p className="text-ink-muted">No open venue-related compliance items.</p>
              ) : (
                <ul className="space-y-1">
                  {impact.compliance.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/app/events/${event.id}/compliance/${c.id}`}
                        className="underline"
                      >
                        {c.title}
                      </Link>{" "}
                      <span className="text-xs text-ink-muted">
                        · {c.status.replaceAll("_", " ")} · {c.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-ink-muted">
                Nothing is legally cleared for a new venue until a reviewer says so.
              </p>
            </CardBody>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Candidate replacement venues and budget</CardTitle>
          </CardHeader>
          <CardBody className="space-y-2 text-sm">
            <p className="text-xs text-ink-muted">
              Verified, listed venues of a suitable size and city. Availability is never assumed;
              prices are shown only from quotes on record.
            </p>
            {v.budget.candidates.length === 0 ? (
              <p className="text-ink-muted">No matching candidate venue is listed.</p>
            ) : (
              <ul className="space-y-1">
                {impact.candidates.map((c, i) => {
                  const b = v.budget.candidates[i];
                  return (
                    <li key={c.provider_id}>
                      <Link href={`/app/marketplace/${c.provider_id}`} className="underline">
                        {c.name}
                      </Link>{" "}
                      <span className="text-xs text-ink-muted">
                        ·{" "}
                        {c.availability === "conflict_recorded"
                          ? "a confirmed booking overlaps"
                          : "availability unknown"}{" "}
                        ·{" "}
                        {b.quoteAmount !== null && b.currency
                          ? `quote ${money(b.quoteAmount, b.currency)}${b.difference !== null ? ` (${b.difference >= 0 ? "+" : ""}${money(b.difference, b.currency)} vs. the cancelled venue)` : ""}`
                          : "no quote on record"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-xs text-ink-muted">
              Cancelled venue:{" "}
              {money(v.budget.originalVenue.amount, v.budget.originalVenue.currency)}
              {v.budget.eventBudget
                ? ` · event budget ${money(v.budget.eventBudget.amount, v.budget.eventBudget.currency)}`
                : " · no event budget set"}
              . Refunds or fees depend on the venue&apos;s terms, which are unknown.
            </p>
          </CardBody>
        </Card>
      </section>

      {/* 2. Proposal ---------------------------------------------------------------------- */}
      <section aria-labelledby="proposal" className="space-y-4">
        <h2 id="proposal" className="text-lg font-semibold">
          2 · Recovery proposal
        </h2>
        {open && (
          <ActionForm
            action={generateRecoveryAction.bind(null, event.id, incident.id)}
            className="space-y-0"
          >
            <SubmitButton variant={proposal ? "secondary" : "primary"}>
              {proposal ? "Generate a new proposal" : "Propose a recovery plan"}
            </SubmitButton>
            <p className="mt-2 text-xs text-ink-muted">
              The proposal is built from the data above and the playbook&apos;s guidance, and
              checked against the rules before it is saved. A new proposal replaces an unapplied one
              and withdraws its drafts and approvals.
            </p>
          </ActionForm>
        )}

        {!current || !proposal ? (
          <p className="text-sm text-ink-muted">No proposal yet.</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>
                  Summary <Badge>{PLAN_LABELS[current.status]}</Badge>
                </CardTitle>
              </CardHeader>
              <CardBody className="space-y-3 text-sm">
                <p>{proposal.summary}</p>
                {current.status_reason && (
                  <p className="text-ink-muted">Reason: {current.status_reason}</p>
                )}
                <div>
                  <p className="font-medium">Options</p>
                  <ul className="mt-1 space-y-2">
                    {proposal.options.map((o) => (
                      <li key={o.key} className="rounded border border-line p-2">
                        <p className="font-medium">
                          {o.title}{" "}
                          {o.key === recommended?.key && <Badge tone="primary">Suggested</Badge>}
                        </p>
                        <p>{o.description}</p>
                        <p className="text-xs text-ink-muted">
                          Pros: {o.pros.join("; ") || "—"} · Cons: {o.cons.join("; ") || "—"}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="font-medium">Proposed timeline</p>
                  <ul className="mt-1 list-disc pl-5">
                    {proposal.timeline.map((t) => (
                      <li key={`${t.date}-${t.label}`}>
                        {t.date}: {t.label}
                        {t.note ? ` — ${t.note}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <p className="font-medium">Unresolved questions</p>
                    <ul className="mt-1 list-disc pl-5">
                      {proposal.unresolvedQuestions.map((q) => (
                        <li key={q}>{q}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <p className="font-medium">Risks</p>
                    <ul className="mt-1 list-disc pl-5">
                      {proposal.risks.map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* 3. Changes + approval ------------------------------------------------------ */}
            <Card>
              <CardHeader>
                <CardTitle>3 · Changes to apply</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3 text-sm">
                <p className="text-xs text-ink-muted">
                  Nothing below has been applied. These are the only things a recovery can do: move
                  a task&apos;s due date, add a task, and mark an item for review. It cannot cancel,
                  rebook or confirm anything.
                </p>
                <ActionForm
                  action={selectChangesAction.bind(null, event.id, current.id)}
                  className="space-y-2"
                >
                  <ul className="space-y-1">
                    {v.changes.map((c) => (
                      <li key={c.id} className="flex gap-2">
                        <input
                          type="checkbox"
                          name="changeId"
                          value={c.id}
                          id={`c-${c.id}`}
                          defaultChecked={c.selected}
                          disabled={!proposed}
                        />
                        <label htmlFor={`c-${c.id}`}>
                          <span className="font-medium">{CHANGE_LABELS[c.kind]}</span>
                          {c.kind === "add_task"
                            ? `: “${String(c.payload.title)}” due ${String(c.payload.due_date)}`
                            : c.kind === "reschedule_task"
                              ? `: ${entityLabel(impact, c.entity_type, c.entity_id)} → ${String(c.payload.due_date)}`
                              : `: ${entityLabel(impact, c.entity_type, c.entity_id)} (${FLAG_LABELS[c.payload.action as keyof typeof FLAG_LABELS] ?? "Review"})`}
                          <span className="block text-xs text-ink-muted">
                            {String(c.payload.reason ?? c.payload.description ?? "")}
                            {c.status !== "proposed" && ` · ${c.status}`}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  {proposed && (
                    <SubmitButton size="sm" variant="secondary">
                      Save selection
                    </SubmitButton>
                  )}
                </ActionForm>

                {proposed && (
                  <div className="space-y-2 rounded border border-line p-3">
                    <p className="font-medium">Approval checklist</p>
                    <ol className="list-decimal space-y-1 pl-5 text-xs text-ink-muted">
                      <li>Read the options, risks and unresolved questions above.</li>
                      <li>Select only the changes you want and save the selection.</li>
                      <li>Request approval: the exact selected changes are saved.</li>
                      <li>
                        Approve (or reject), then apply. If anything changes, approval restarts.
                      </li>
                      <li>Drafts for providers and attendees need their own approvals below.</li>
                    </ol>
                    {!applyApproval && (
                      <div className="flex flex-wrap gap-2">
                        <ActionForm
                          action={requestApprovalAction.bind(
                            null,
                            event.id,
                            "apply_recovery",
                            current.id,
                          )}
                          className="space-y-0"
                        >
                          <SubmitButton size="sm">Request approval to apply selection</SubmitButton>
                        </ActionForm>
                        <ActionForm
                          action={rejectPlanAction.bind(null, event.id, current.id)}
                          className="flex flex-wrap items-end gap-2 space-y-0"
                        >
                          <FormField label="Reason to reject">
                            <Input name="reason" minLength={5} maxLength={500} />
                          </FormField>
                          <SubmitButton size="sm" variant="secondary">
                            Reject proposal
                          </SubmitButton>
                        </ActionForm>
                      </div>
                    )}
                    {applyApproval && (
                      <div className="space-y-2 rounded border border-primary/40 p-3">
                        <p className="font-medium">
                          Approval: {APPROVAL_LABELS[applyApproval.status]}{" "}
                          <span className="text-xs text-ink-muted">
                            (payload {applyApproval.payload_hash.slice(0, 12)}…)
                          </span>
                        </p>
                        <p className="text-xs text-ink-muted">
                          Exactly what will be applied ({applyEntry.length} change
                          {applyEntry.length === 1 ? "" : "s"}):
                        </p>
                        <ul className="list-disc pl-5 text-xs">
                          {applyEntry.map((e, i) => (
                            <li key={i}>
                              {CHANGE_LABELS[e.kind]}
                              {e.entity_id
                                ? `: ${entityLabel(impact, e.entity_type, e.entity_id)}`
                                : `: “${e.payload.title}”`}
                              {e.payload.due_date ? ` → ${e.payload.due_date}` : ""}
                              {e.current?.due_date ? ` (now ${e.current.due_date})` : ""}
                            </li>
                          ))}
                        </ul>
                        {applyApproval.status === "pending" && (
                          <DecisionForm
                            eventId={event.id}
                            approval={applyApproval}
                            what="these changes"
                          />
                        )}
                        {applyApproval.status === "approved" && (
                          <ActionForm
                            action={applyApprovedAction.bind(null, event.id, applyApproval.id)}
                            className="space-y-0"
                          >
                            <SubmitButton size="sm">Apply approved changes</SubmitButton>
                          </ActionForm>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardBody>
            </Card>

            {/* 4. Drafts ------------------------------------------------------------------ */}
            <Card>
              <CardHeader>
                <CardTitle>4 · Provider inquiries (drafts)</CardTitle>
              </CardHeader>
              <CardBody className="space-y-3 text-sm">
                <p className="text-xs text-ink-muted">
                  Recording an inquiry as sent is simulated: no provider is contacted and none can
                  answer, so no provider consent exists.
                </p>
                {v.inquiries.length === 0 && <p className="text-ink-muted">No inquiries.</p>}
                {v.inquiries.map((q) => {
                  const a = live(v.approvals, "send_provider_inquiry", q.id);
                  const editable = ["draft", "awaiting_approval", "approved"].includes(q.status);
                  return (
                    <div key={q.id} className="space-y-2 rounded border border-line p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-medium">{PURPOSE_LABELS[q.purpose]}</p>
                        <Badge>{INQUIRY_LABELS[q.status]}</Badge>
                      </div>
                      <p className="font-medium">{q.subject}</p>
                      <p className="text-xs whitespace-pre-wrap">{q.body}</p>
                      {q.status === "draft" && (
                        <div className="flex flex-wrap gap-2">
                          <ActionForm
                            action={requestApprovalAction.bind(
                              null,
                              event.id,
                              "send_provider_inquiry",
                              q.id,
                            )}
                            className="space-y-0"
                          >
                            <SubmitButton size="sm">Request approval</SubmitButton>
                          </ActionForm>
                          <ActionForm
                            action={discardInquiryAction.bind(null, event.id, q.id)}
                            className="space-y-0"
                          >
                            <SubmitButton size="sm" variant="secondary">
                              Discard
                            </SubmitButton>
                          </ActionForm>
                        </div>
                      )}
                      {a?.status === "pending" && (
                        <DecisionForm eventId={event.id} approval={a} what="this inquiry" />
                      )}
                      {a?.status === "approved" && (
                        <ActionForm
                          action={recordInquiryAction.bind(null, event.id, a.id)}
                          className="space-y-0"
                        >
                          <SubmitButton size="sm">Record as sent (simulated)</SubmitButton>
                        </ActionForm>
                      )}
                      {editable && (
                        <details>
                          <summary className="cursor-pointer text-primary">Edit</summary>
                          <ActionForm
                            action={editInquiryAction.bind(null, event.id, q.id)}
                            className="mt-2"
                            labels={{ subject: "Subject", body: "Message" }}
                          >
                            <FormField label="Subject" required>
                              <Input name="subject" defaultValue={q.subject} maxLength={200} />
                            </FormField>
                            <FormField label="Message" required>
                              <Textarea
                                name="body"
                                defaultValue={q.body}
                                rows={6}
                                maxLength={3000}
                              />
                            </FormField>
                            <SubmitButton size="sm" variant="secondary">
                              Save (restarts approval)
                            </SubmitButton>
                          </ActionForm>
                        </details>
                      )}
                    </div>
                  );
                })}
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>5 · Attendee update (draft)</CardTitle>
              </CardHeader>
              <CardBody className="space-y-2 text-sm">
                {attendeeMessage ? (
                  <>
                    <p className="font-medium">{attendeeMessage.subject}</p>
                    <p className="text-xs whitespace-pre-wrap">{attendeeMessage.body}</p>
                    <p className="text-xs text-ink-muted">
                      Status: {attendeeMessage.status.replaceAll("_", " ")}
                      {messageApproval ? ` · approval ${messageApproval.status}` : ""}. It goes
                      through the normal message approval, and because this is a practice scenario
                      no attendee receives it.{" "}
                      <Link href={`/app/events/${event.id}/messages`} className="underline">
                        Review and approve on the messages page
                      </Link>
                      .
                    </p>
                  </>
                ) : (
                  <p className="text-ink-muted">No attendee draft for this proposal.</p>
                )}
              </CardBody>
            </Card>
          </>
        )}
      </section>

      {/* 6. Follow-ups ---------------------------------------------------------------------- */}
      <section aria-labelledby="flags" className="space-y-3">
        <h2 id="flags" className="text-lg font-semibold">
          Items marked for review ({openFlags.length} open)
        </h2>
        {v.flags.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nothing is marked yet. Items are marked when you apply the selected changes.
          </p>
        ) : (
          <ul className="space-y-2">
            {v.flags.map((f) => (
              <li key={f.id} className="rounded border border-line p-3 text-sm">
                <p>
                  <span className="font-medium">{FLAG_LABELS[f.action]}:</span>{" "}
                  {entityLabel(impact, f.entity_type, f.entity_id)}{" "}
                  <Badge>{f.status === "open" ? "Open" : "Handled"}</Badge>
                </p>
                <p className="text-xs text-ink-muted">{f.reason}</p>
                {f.resolution_note && <p className="text-xs">Note: {f.resolution_note}</p>}
                {f.status === "open" && (
                  <ActionForm
                    action={resolveFlagAction.bind(null, event.id, f.id)}
                    className="mt-2 flex flex-wrap items-end gap-2 space-y-0"
                  >
                    <FormField label="What was done?">
                      <Input name="reason" minLength={5} maxLength={500} />
                    </FormField>
                    <SubmitButton size="sm" variant="secondary">
                      Mark as handled
                    </SubmitButton>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {open ? (
        <Card>
          <CardHeader>
            <CardTitle>Close this incident</CardTitle>
          </CardHeader>
          <CardBody>
            <ActionForm
              action={closeIncidentAction.bind(null, event.id, incident.id)}
              className="grid gap-3 sm:grid-cols-3 sm:items-end"
              labels={{ outcome: "Outcome", reason: "Note" }}
            >
              <FormField label="Outcome">
                <Select name="outcome" defaultValue="dismissed">
                  <option value="resolved">Resolved (a plan was applied)</option>
                  <option value="dismissed">Dismissed (practice ended)</option>
                </Select>
              </FormField>
              <FormField label="Note" required>
                <Input name="reason" minLength={5} maxLength={500} />
              </FormField>
              <SubmitButton variant="secondary">Close</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : (
        <Alert tone="info" title={INCIDENT_LABELS[incident.status]}>
          {incident.resolution_note}
        </Alert>
      )}
    </div>
  );
}

/** Data-dependent route behind the app shell Suspense; blocking navigation is intended. */
export const instant = false;
