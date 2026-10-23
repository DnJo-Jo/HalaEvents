import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ComplianceStatusBadge } from "@/components/workspace/badges";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { createCheckAction, runChecksAction } from "@/modules/compliance/actions";
import { ComplianceCategory } from "@/modules/compliance/schemas";
import { getComplianceOverview } from "@/modules/compliance/service";

export const metadata: Metadata = { title: "Compliance checks" };

const ORDER = [
  "action_required",
  "needs_information",
  "under_review",
  "awaiting_official_response",
  "conditional",
  "not_assessed",
  "source_supported",
  "cleared",
  "rejected",
  "closed",
];

export default async function CompliancePage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  const { event, canEdit, checks, pending } = await getComplianceOverview(eventId);
  const sorted = [...checks].sort(
    (a, b) =>
      ORDER.indexOf(a.status) - ORDER.indexOf(b.status) ||
      (a.severity === b.severity ? 0 : a.severity === "concern" ? -1 : 1),
  );

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}`} className="text-ink-muted hover:text-ink">
          ← {event.name}
        </Link>
      </nav>
      <PageHeader
        title="Compliance checks"
        description="Things to check before the event, why each was flagged, and what has been recorded about it."
      />
      <Alert tone="info" title="What these checks are">
        HalaEvents flags topics from your interview answers with fixed rules. A flag is a prompt to
        check, not a legal finding, and nothing here accuses anyone. Only a person can clear a
        check, on evidence recorded here. HalaEvents doesn&apos;t file applications or talk to any
        authority. Sources come from a small{" "}
        <Link href="/app/compliance" className="underline">
          curated registry
        </Link>
        ; there is no live search.
      </Alert>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <ActionForm
            action={runChecksAction.bind(null, event.id)}
            className="space-y-0"
            aria-label="Run compliance checks"
          >
            <SubmitButton>Run checks from my answers</SubmitButton>
          </ActionForm>
          <span className="text-sm text-ink-muted">
            {pending > 0
              ? `${pending} rule result${pending === 1 ? "" : "s"} not saved yet.`
              : "Saved checks are up to date with the rules."}{" "}
            Checks a person has already changed are never overwritten.
          </span>
        </div>
      )}

      {sorted.length === 0 ? (
        <EmptyState
          title="No checks yet"
          description={
            canEdit
              ? "Answer the planning interview, then run the checks."
              : "The organizers haven't run the checks yet."
          }
        />
      ) : (
        <ul className="space-y-3">
          {sorted.map((c) => (
            <li key={c.id}>
              <Card>
                <CardBody className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link
                      href={`/app/events/${event.id}/compliance/${c.id}`}
                      className="font-medium text-primary hover:underline"
                    >
                      {c.title}
                    </Link>
                    <div className="flex flex-wrap gap-1.5">
                      <ComplianceStatusBadge status={c.status} />
                      {c.severity === "concern" && <Badge tone="warning">Possible concern</Badge>}
                      <Badge>
                        {c.origin === "rule" ? "Flagged by rule" : "Added by organizer"}
                      </Badge>
                    </div>
                  </div>
                  <p className="text-sm text-ink-muted">{c.reason}</p>
                  {c.next_action && (
                    <p className="text-sm">
                      <span className="font-medium">Next action:</span> {c.next_action}
                    </p>
                  )}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Add a check yourself</CardTitle>
          </CardHeader>
          <CardBody>
            <ActionForm
              action={createCheckAction.bind(null, event.id)}
              labels={{ title: "Title", reason: "Why it needs checking" }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Title" required>
                  <Input name="title" required minLength={3} maxLength={160} />
                </FormField>
                <FormField label="Category">
                  <Select name="category" defaultValue="other">
                    {ComplianceCategory.options.map((c) => (
                      <option key={c} value={c}>
                        {c.replace(/_/g, " ")}
                      </option>
                    ))}
                  </Select>
                </FormField>
              </div>
              <FormField label="Why it needs checking" required>
                <Textarea name="reason" required minLength={3} maxLength={600} rows={2} />
              </FormField>
              <FormField label="Details">
                <Textarea name="description" maxLength={1000} rows={2} />
              </FormField>
              <SubmitButton variant="secondary">Add check</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/** Data-dependent route behind the app shell Suspense; blocking navigation is intended. */
export const instant = false;
