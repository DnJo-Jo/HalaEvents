import type { Metadata } from "next";
import { Stars } from "@/components/reviews/rating";
import { ActionForm } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate } from "@/lib/dates";
import {
  moderateAction,
  resolveReportAction,
  setProviderReviewsAction,
} from "@/modules/reviews/actions";
import { REASON_LABELS } from "@/modules/reviews/rules";
import { getModerationView } from "@/modules/reviews/service";

export const metadata: Metadata = { title: "Review moderation" };

export default async function AdminReviewsPage() {
  const v = await getModerationView();
  return (
    <div className="space-y-8">
      <PageHeader
        title="Review moderation"
        description="Reports and disputes about reviews, and the policy for provider reviews of organizers."
      />

      <Card>
        <CardHeader>
          <CardTitle>Platform policy</CardTitle>
        </CardHeader>
        <CardBody>
          <ActionForm
            action={setProviderReviewsAction}
            className="flex flex-wrap items-end gap-3 space-y-0"
          >
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={v.enabled} />
              Let providers review organizers after a completed booking
            </label>
            <SubmitButton size="sm" variant="secondary">
              Save policy
            </SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-ink-muted">
            Turning it off stops new provider reviews; existing ones stay.
          </p>
        </CardBody>
      </Card>

      <section aria-labelledby="reports" className="space-y-3">
        <h2 id="reports" className="text-lg font-semibold">
          Open reports and disputes ({v.reports.length})
        </h2>
        {v.reports.length === 0 ? (
          <EmptyState title="Nothing to review" description="Reports and disputes appear here." />
        ) : (
          <ul className="space-y-3">
            {v.reports.map((rep) => {
              const r = v.reported.get(rep.review_id);
              return (
                <li key={rep.id}>
                  <Card>
                    <CardBody className="space-y-2 text-sm">
                      <p className="font-medium">
                        <Badge tone={rep.kind === "dispute" ? "warning" : "neutral"}>
                          {rep.kind === "dispute" ? "Dispute" : "Report"}
                        </Badge>{" "}
                        {REASON_LABELS[rep.reason]} · {formatDate(rep.created_at)}
                      </p>
                      <p className="text-ink-muted">“{rep.details}”</p>
                      {r && (
                        <div className="rounded border border-line p-2">
                          <p>
                            <Stars rating={r.rating} /> <Badge>{r.status}</Badge>
                          </p>
                          <p className="whitespace-pre-wrap">{r.body}</p>
                        </div>
                      )}
                      <ActionForm
                        action={resolveReportAction.bind(null, rep.id)}
                        className="flex flex-wrap items-end gap-2 space-y-0"
                      >
                        <FormField label="Outcome">
                          <Select name="resolution" defaultValue="dismissed">
                            <option value="dismissed">Dismiss (review stays)</option>
                            <option value="upheld">Uphold</option>
                          </Select>
                        </FormField>
                        <FormField label="Reason">
                          <Input name="note" required minLength={5} maxLength={500} />
                        </FormField>
                        <label className="flex items-center gap-1 pb-2 text-xs">
                          <input type="checkbox" name="hide" /> Hide the review if upheld
                        </label>
                        <SubmitButton size="sm">Resolve</SubmitButton>
                      </ActionForm>
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="recent" className="space-y-3">
        <h2 id="recent" className="text-lg font-semibold">
          Recent reviews
        </h2>
        <ul className="space-y-2">
          {v.recent.map((r) => (
            <li key={r.id} className="rounded border border-line p-3 text-sm">
              <p>
                <Stars rating={r.rating} />{" "}
                <Badge tone={r.status === "hidden" ? "danger" : "success"}>{r.status}</Badge>{" "}
                <span className="text-xs text-ink-muted">
                  {r.direction.replaceAll("_", " ")} · {formatDate(r.created_at)}
                </span>
              </p>
              <p className="whitespace-pre-wrap">{r.body}</p>
              <ActionForm
                action={moderateAction.bind(null, r.id)}
                className="mt-2 flex flex-wrap items-end gap-2 space-y-0"
              >
                <input
                  type="hidden"
                  name="status"
                  value={r.status === "hidden" ? "published" : "hidden"}
                />
                <FormField label={r.status === "hidden" ? "Reason to restore" : "Reason to hide"}>
                  <Input name="note" required minLength={5} maxLength={500} />
                </FormField>
                <SubmitButton size="sm" variant="secondary">
                  {r.status === "hidden" ? "Restore" : "Hide"}
                </SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
