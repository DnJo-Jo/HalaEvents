import type { Metadata } from "next";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatInZone } from "@/lib/dates";
import { setSourceVerificationAction } from "@/modules/compliance/actions";
import { listSources } from "@/modules/compliance/service";

export const metadata: Metadata = { title: "Official sources" };

const SUMMARY_KIND = {
  none: "No summary recorded",
  search_result_summary: "Summary from a search result, not the page itself",
  page_excerpt: "Excerpt from the page",
  team_paraphrase: "Paraphrased by the HalaEvents team",
};

export default async function SourcesPage() {
  const { sources, isAdmin, liveSearch } = await listSources();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Official sources"
        description="The curated registry compliance checks can reference. Per-event checks live on each event's Compliance page."
      />
      {!liveSearch.configured && (
        <Alert tone="warning" title="Live verification is unavailable">
          No live search or monitoring provider is configured. This is a short, hand-curated list.
          HalaEvents does not search the web or watch government announcements, and a source here is
          only “verified” once a platform admin has checked the live page and recorded what they
          checked.
        </Alert>
      )}
      <ul className="space-y-3">
        {sources.map((s) => (
          <li key={s.id}>
            <Card>
              <CardBody className="space-y-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <a
                    href={s.url}
                    className="font-medium text-primary underline"
                    rel="noopener noreferrer"
                    target="_blank"
                  >
                    {s.title}
                  </a>
                  {s.last_verified_at ? (
                    <Badge tone="success">
                      Verified {formatInZone(s.last_verified_at, "Asia/Dubai")}
                    </Badge>
                  ) : (
                    <Badge tone="warning">Not verified</Badge>
                  )}
                </div>
                <p className="text-ink-muted">
                  {s.authority} · {s.jurisdiction} · {s.scope}
                </p>
                {s.summary && (
                  <p>
                    <span className="text-xs text-ink-muted">{SUMMARY_KIND[s.summary_kind]}: </span>
                    {s.summary}
                  </p>
                )}
                <p className="text-xs text-ink-muted">
                  Retrieval: {s.retrieval_status.replace("_", " ")}
                  {s.retrieved_at ? ` (${formatInZone(s.retrieved_at, "Asia/Dubai")})` : ""}.{" "}
                  {s.retrieval_note}
                </p>
                {s.verification_note && (
                  <p className="text-xs">Verification note: {s.verification_note}</p>
                )}
                {isAdmin && (
                  <ActionForm
                    action={setSourceVerificationAction.bind(null, s.id)}
                    className="flex flex-wrap items-end gap-2 space-y-0"
                    aria-label={`Verification of ${s.title}`}
                  >
                    <FormField label="Verification">
                      <Select name="verified" defaultValue={s.last_verified_at ? "false" : "true"}>
                        <option value="true">I checked the live page today</option>
                        <option value="false">Withdraw verification</option>
                      </Select>
                    </FormField>
                    <FormField label="What you checked">
                      <Input name="note" maxLength={400} />
                    </FormField>
                    <SubmitButton size="sm" variant="secondary">
                      Save
                    </SubmitButton>
                  </ActionForm>
                )}
              </CardBody>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
