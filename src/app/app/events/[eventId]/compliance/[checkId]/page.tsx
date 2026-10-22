import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ComplianceStatusBadge, SimulatedBadge } from "@/components/workspace/badges";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatInZone } from "@/lib/dates";
import {
  addEvidenceAction,
  addReferenceAction,
  assignReviewerAction,
  changeCheckStatusAction,
  recordSimulatedResponseAction,
  simulateSubmissionAction,
  updateCheckAction,
} from "@/modules/compliance/actions";
import { COMPLIANCE_STATUS, REASON_REQUIRED } from "@/modules/compliance/rules";
import { Applicability, EvidenceKind } from "@/modules/compliance/schemas";
import { getCheckView } from "@/modules/compliance/service";
import { describeTimelineEntry } from "@/modules/events/timeline";

export const metadata: Metadata = { title: "Compliance check" };

const APPLICABILITY_LABEL: Record<Applicability, string> = {
  unknown: "Not known yet",
  likely_applies: "Likely applies",
  applies: "Applies",
  does_not_apply: "Does not apply",
};
const EVIDENCE_LABEL: Record<EvidenceKind, string> = {
  note: "Note",
  document_reference: "Document reference",
  reference_number: "Reference number",
  link: "Link (https)",
  submission_reference: "Submission reference (you submitted it yourself)",
  official_response: "Official response you received",
};

export default async function CheckPage({
  params,
}: {
  params: Promise<{ eventId: string; checkId: string }>;
}) {
  const { eventId, checkId } = await params;
  if (!z.uuid().safeParse(eventId).success || !z.uuid().safeParse(checkId).success) notFound();
  const v = await getCheckView(eventId, checkId);
  const { event, check: c } = v;
  const names = new Map(v.members.map((m) => [m.user_id, m.display_name]));
  const managers = v.members.filter((m) => m.role !== "viewer");
  const referenced = new Set(v.references.map((r) => r.source_id));
  const available = v.transitions.filter((t) => t.blockers.length === 0);
  const unavailable = v.transitions.filter((t) => t.blockers.length > 0);

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}/compliance`} className="text-ink-muted hover:text-ink">
          ← Compliance checks
        </Link>
      </nav>
      <PageHeader
        title={c.title}
        description={c.description || undefined}
        badge={
          <span className="flex flex-wrap gap-1.5">
            <ComplianceStatusBadge status={c.status} />
            {c.severity === "concern" && <Badge tone="warning">Possible concern</Badge>}
          </span>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Why this was flagged</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3 text-sm">
          <p>{c.reason}</p>
          <p className="text-ink-muted">
            {c.origin === "rule"
              ? "Flagged by a fixed HalaEvents rule from your answers, not by AI. "
              : "Added by an organizer. "}
            {COMPLIANCE_STATUS[c.status].meaning}
          </p>
          {c.status_reason && (
            <p>
              <span className="font-medium">Reason for the current status:</span> {c.status_reason}
            </p>
          )}
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-ink-muted">Applicability</dt>
              <dd>{APPLICABILITY_LABEL[c.applicability]}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Reviewer</dt>
              <dd>
                {c.reviewer_user_id
                  ? (names.get(c.reviewer_user_id) ?? "A former member")
                  : "Not assigned"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Next action</dt>
              <dd>{c.next_action ?? "None recorded"}</dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Official channel and sources</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4 text-sm">
          {v.channel ? (
            <p>
              <span className="font-medium">Relevant official channel:</span> {v.channel.authority}{" "}
              —{" "}
              <a
                href={v.channel.url}
                className="text-primary underline"
                rel="noopener noreferrer"
                target="_blank"
              >
                {v.channel.title}
              </a>
              .{" "}
              {v.channel.last_verified_at
                ? "A person verified this page."
                : "Not verified by a person yet: confirm the page's current content before relying on it."}
            </p>
          ) : (
            <p className="text-ink-muted">
              No official channel is curated for this topic yet. Ask the venue or the relevant
              authority directly.
            </p>
          )}
          {v.references.length === 0 ? (
            <p className="text-ink-muted">No sources referenced.</p>
          ) : (
            <ul className="space-y-3">
              {v.references.map((r) => {
                const s = v.sourceById.get(r.source_id);
                if (!s) return null;
                return (
                  <li key={r.id} className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={s.url}
                        className="font-medium text-primary underline"
                        rel="noopener noreferrer"
                        target="_blank"
                      >
                        {s.title}
                      </a>
                      <span className="text-ink-muted">{s.authority}</span>
                      {s.last_verified_at ? (
                        <Badge tone="success">
                          Verified {formatInZone(s.last_verified_at, event.timezone)}
                        </Badge>
                      ) : (
                        <Badge tone="warning">Not verified</Badge>
                      )}
                    </div>
                    {s.summary && (
                      <p className="text-ink-muted">
                        {s.summary_kind === "search_result_summary" &&
                          "Search-result summary, not the page: "}
                        {s.summary}
                      </p>
                    )}
                    <p className="text-xs text-ink-muted">
                      Retrieval: {s.retrieval_status.replace("_", " ")}
                      {s.retrieved_at
                        ? ` on ${formatInZone(s.retrieved_at, event.timezone)}`
                        : ""}. {s.retrieval_note}
                    </p>
                    {r.relevance_note && <p className="text-xs">{r.relevance_note}</p>}
                  </li>
                );
              })}
            </ul>
          )}
          {v.canEdit && v.sources.some((s) => !referenced.has(s.id)) && (
            <ActionForm
              action={addReferenceAction.bind(null, event.id, c.id)}
              aria-label="Reference a source"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Reference a curated source">
                  <Select name="sourceId" defaultValue="">
                    <option value="">Choose a source</option>
                    {v.sources
                      .filter((s) => !referenced.has(s.id))
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.authority}: {s.title}
                        </option>
                      ))}
                  </Select>
                </FormField>
                <FormField label="Why it's relevant">
                  <Input name="note" maxLength={400} />
                </FormField>
              </div>
              <SubmitButton size="sm" variant="secondary">
                Add reference
              </SubmitButton>
            </ActionForm>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Evidence</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4 text-sm">
          {v.evidence.length === 0 ? (
            <p className="text-ink-muted">Nothing recorded yet.</p>
          ) : (
            <ul className="space-y-2">
              {v.evidence.map((e) => (
                <li key={e.id} className="flex flex-wrap items-center gap-2">
                  <Badge>{EVIDENCE_LABEL[e.kind]}</Badge>
                  {e.is_simulated && <SimulatedBadge />}
                  <span>{e.value}</span>
                  <span className="text-xs text-ink-muted">
                    {e.recorded_by ? (names.get(e.recorded_by) ?? "A former member") : "System"},{" "}
                    {formatInZone(e.recorded_at, event.timezone)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-ink-muted">
            Evidence is what your team recorded. HalaEvents does not check it with the venue or any
            authority.
          </p>
          {v.canEdit && (
            <ActionForm
              action={addEvidenceAction.bind(null, event.id, c.id)}
              resetOnSuccess
              aria-label="Record evidence"
              labels={{ value: "Evidence" }}
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Kind">
                  <Select name="kind" defaultValue="note">
                    {EvidenceKind.options.map((k) => (
                      <option key={k} value={k}>
                        {EVIDENCE_LABEL[k]}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Evidence" required className="sm:col-span-2">
                  <Input name="value" required minLength={3} maxLength={1000} />
                </FormField>
              </div>
              <SubmitButton size="sm" variant="secondary">
                Record evidence
              </SubmitButton>
            </ActionForm>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Review and status</CardTitle>
        </CardHeader>
        <CardBody className="space-y-4 text-sm">
          {v.canEdit && (
            <div className="grid gap-4 sm:grid-cols-2">
              <ActionForm
                action={assignReviewerAction.bind(null, event.id, c.id)}
                aria-label="Assign reviewer"
              >
                <FormField
                  label="Reviewer"
                  hint="An owner or organizer. Only they (or a platform admin) can clear or reject."
                >
                  <Select name="reviewerUserId" defaultValue={c.reviewer_user_id ?? ""}>
                    <option value="">Not assigned</option>
                    {managers.map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.display_name}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <SubmitButton size="sm" variant="secondary">
                  Save reviewer
                </SubmitButton>
              </ActionForm>
              <ActionForm
                action={updateCheckAction.bind(null, event.id, c.id)}
                aria-label="Applicability and next action"
              >
                <FormField label="Applicability">
                  <Select name="applicability" defaultValue={c.applicability}>
                    {Applicability.options.map((a) => (
                      <option key={a} value={a}>
                        {APPLICABILITY_LABEL[a]}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Next action">
                  <Input name="nextAction" maxLength={300} defaultValue={c.next_action ?? ""} />
                </FormField>
                <SubmitButton size="sm" variant="secondary">
                  Save
                </SubmitButton>
              </ActionForm>
            </div>
          )}
          {available.length > 0 && (
            <ActionForm
              action={changeCheckStatusAction.bind(null, event.id, c.id)}
              aria-label="Change status"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="New status">
                  <Select name="status" defaultValue={available[0].to}>
                    {available.map((t) => (
                      <option key={t.to} value={t.to}>
                        {COMPLIANCE_STATUS[t.to].label}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField
                  label="Reason"
                  hint={`Required for: ${REASON_REQUIRED.map((s) => COMPLIANCE_STATUS[s].label).join(", ")}.`}
                >
                  <Textarea name="reason" maxLength={600} rows={2} />
                </FormField>
              </div>
              <SubmitButton size="sm">Change status</SubmitButton>
            </ActionForm>
          )}
          {unavailable.length > 0 && (
            <div>
              <p className="text-xs text-ink-muted">Not available yet:</p>
              <ul className="list-disc pl-5 text-xs text-ink-muted">
                {unavailable.map((t) => (
                  <li key={t.to}>
                    {COMPLIANCE_STATUS[t.to].label}: {t.blockers.join(" ")}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Official application <SimulatedBadge />
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4 text-sm">
          <Alert tone="warning" title="Demonstration only">
            HalaEvents has no connection to DET, DDA or any other authority. A simulated submission
            sends nothing and creates a reference starting with DEMO-. If you applied for real,
            record your own reference under Evidence as a submission reference.
          </Alert>
          {v.submissions.map((s) => (
            <div key={s.id} className="space-y-2 rounded border border-line p-3">
              <p>
                <span className="font-medium">{s.reference}</span> to {s.authority} on{" "}
                {formatInZone(s.submitted_at, event.timezone)} <SimulatedBadge />
              </p>
              {s.status === "response_recorded" ? (
                <p>Simulated response: {s.response_summary}</p>
              ) : (
                v.canEdit && (
                  <ActionForm
                    action={recordSimulatedResponseAction.bind(null, event.id, c.id, s.id)}
                    aria-label="Record simulated response"
                    labels={{ summary: "Simulated response" }}
                  >
                    <FormField label="Simulated response" required>
                      <Input name="summary" required minLength={3} maxLength={600} />
                    </FormField>
                    <SubmitButton size="sm" variant="secondary">
                      Record simulated response
                    </SubmitButton>
                  </ActionForm>
                )
              )}
            </div>
          ))}
          {v.canEdit && (
            <ActionForm
              action={simulateSubmissionAction.bind(null, event.id, c.id)}
              aria-label="Simulate a submission"
            >
              <SubmitButton size="sm" variant="secondary">
                Simulate a submission (demo)
              </SubmitButton>
            </ActionForm>
          )}
        </CardBody>
      </Card>

      <section aria-labelledby="history-heading" className="space-y-3">
        <h2 id="history-heading" className="text-lg font-semibold">
          History
        </h2>
        {v.history.length === 0 ? (
          <p className="text-sm text-ink-muted">No changes recorded.</p>
        ) : (
          <ol className="space-y-2 border-l border-line pl-4 text-sm">
            {v.history.map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <span className="font-medium">{h.actor_name}</span> {describeTimelineEntry(h)}
                <span className="block text-xs text-ink-muted">
                  {formatInZone(h.at, event.timezone)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
