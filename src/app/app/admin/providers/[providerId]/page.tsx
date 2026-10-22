import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CapacityLabel, ListingBadges, PriceLabel } from "@/components/marketplace/badges";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate } from "@/lib/dates";
import { CATEGORY_LABELS, DOCUMENT_KIND_LABELS, indicativePrice } from "@/modules/profiles/labels";
import {
  decideVerificationAction,
  moderateAction,
  reviewDocumentAction,
} from "@/modules/profiles/providers-actions";
import { getProviderForAdmin } from "@/modules/profiles/providers-service";
import { MODERATION_TRANSITIONS } from "@/modules/profiles/rules";

export const metadata: Metadata = { title: "Review provider" };

export default async function AdminProviderPage({
  params,
}: {
  params: Promise<{ providerId: string }>;
}) {
  const { providerId } = await params;
  if (!z.uuid().safeParse(providerId).success) notFound();
  const {
    provider: p,
    privateDetails,
    venue,
    services,
    documents,
  } = await getProviderForAdmin(providerId);
  const moderationTargets = MODERATION_TRANSITIONS[p.moderation_status];

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/app/admin/providers" className="text-ink-muted hover:text-ink">
          ← Provider review
        </Link>
      </nav>
      <PageHeader
        title={p.name}
        description={CATEGORY_LABELS[p.category]}
        badge={<ListingBadges p={p} />}
      />
      {p.is_demo && <Alert tone="warning" title="Seeded demo listing (fictional, no members)." />}

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Business details</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3 text-sm">
              {p.description && <p className="whitespace-pre-line">{p.description}</p>}
              <p>
                <PriceLabel
                  model={p.pricing_model}
                  min={p.price_min}
                  max={p.price_max}
                  currency={p.currency}
                />{" "}
                · <CapacityLabel min={p.min_capacity} max={p.max_capacity} />
              </p>
              <p className="text-ink-muted">
                {p.city ?? "No city"} · serves {p.service_area.join(", ") || "—"}
                {p.website && ` · ${p.website}`}
              </p>
              {p.capabilities.length > 0 && (
                <p className="text-ink-muted">Capabilities: {p.capabilities.join(", ")}</p>
              )}
              {venue && (
                <p className="text-ink-muted">
                  Venue: {venue.setting}, seated {venue.seated_capacity ?? "—"}, standing{" "}
                  {venue.standing_capacity ?? "—"}; {venue.address_text ?? "no address"}
                </p>
              )}
              <div className="rounded-md border border-line bg-surface-muted p-3">
                <p className="font-medium">Private details</p>
                <p className="text-ink-muted">
                  Contact: {privateDetails?.contact_email ?? "—"} ·{" "}
                  {privateDetails?.contact_phone ?? "—"}
                </p>
              </div>
              <p className="text-ink-muted">
                Services:{" "}
                {services
                  .map(
                    (s) =>
                      `${s.title} (${indicativePrice(s.pricing_model, s.price_from, s.price_to, s.currency)})`,
                  )
                  .join("; ") || "none"}
              </p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Credentials</CardTitle>
              <CardDescription>
                Check reference numbers with the issuer before accepting. No files are stored yet.
              </CardDescription>
            </CardHeader>
            <CardBody>
              {documents.length === 0 ? (
                <p className="text-sm text-ink-muted">No credentials recorded.</p>
              ) : (
                <ul className="space-y-4">
                  {documents.map((d) => (
                    <li key={d.id} className="rounded-md border border-line p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="font-medium">{d.title}</p>
                          <p className="text-xs text-ink-muted">
                            {DOCUMENT_KIND_LABELS[d.kind]} · Ref {d.reference_number ?? "—"} ·{" "}
                            {d.issued_by ?? "issuer not stated"}
                            {d.expires_on && ` · expires ${formatDate(d.expires_on)}`}
                          </p>
                        </div>
                        <Badge
                          tone={
                            d.review_status === "accepted"
                              ? "success"
                              : d.review_status === "rejected"
                                ? "danger"
                                : "info"
                          }
                        >
                          {d.review_status}
                        </Badge>
                      </div>
                      <ActionForm
                        action={reviewDocumentAction.bind(null, d.id)}
                        className="mt-3 flex flex-wrap items-end gap-2 space-y-0"
                        labels={{ note: "Note" }}
                      >
                        <Input
                          name="note"
                          placeholder="Note (required to reject)"
                          aria-label={`Note for ${d.title}`}
                          className="h-8 max-w-60"
                        />
                        <SubmitButton
                          name="decision"
                          value="accepted"
                          size="sm"
                          variant="secondary"
                        >
                          Accept
                        </SubmitButton>
                        <SubmitButton name="decision" value="rejected" size="sm" variant="ghost">
                          Reject
                        </SubmitButton>
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Verification</CardTitle>
              <CardDescription>Is this a real business with valid credentials?</CardDescription>
            </CardHeader>
            <CardBody>
              {p.verification_status === "submitted" ? (
                <ActionForm
                  action={decideVerificationAction.bind(null, p.id)}
                  labels={{ note: "Reason" }}
                >
                  <FormField label="Note" hint="Required when rejecting; shown to the provider.">
                    <Input name="note" maxLength={1000} />
                  </FormField>
                  <div className="flex gap-2">
                    <SubmitButton name="decision" value="verified">
                      Verify
                    </SubmitButton>
                    <SubmitButton name="decision" value="rejected" variant="secondary">
                      Reject
                    </SubmitButton>
                  </div>
                </ActionForm>
              ) : (
                <p className="text-sm text-ink-muted">
                  {p.verification_status === "verified"
                    ? `Verified ${p.verified_at ? formatDate(p.verified_at) : ""}. Use moderation to hide or suspend.`
                    : p.verification_status === "rejected"
                      ? `Rejected: ${p.verification_note ?? "—"}. The owner can resubmit.`
                      : "Not submitted yet."}
                </p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Moderation</CardTitle>
              <CardDescription>
                Hide or suspend a listing regardless of verification.
              </CardDescription>
            </CardHeader>
            <CardBody className="space-y-3">
              <p className="text-sm">
                Current:{" "}
                <Badge tone={p.moderation_status === "active" ? "success" : "danger"}>
                  {p.moderation_status}
                </Badge>
              </p>
              {p.moderation_reason && (
                <p className="text-sm text-ink-muted">Reason: {p.moderation_reason}</p>
              )}
              <ActionForm
                action={moderateAction.bind(null, p.id)}
                labels={{ reason: "Reason", status: "New state" }}
              >
                <FormField label="New state">
                  <Select name="status" defaultValue={moderationTargets[0]}>
                    {moderationTargets.map((s) => (
                      <option key={s} value={s}>
                        {s === "active" ? "Restore (active)" : s === "hidden" ? "Hide" : "Suspend"}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField
                  label="Reason"
                  hint="Required to hide or suspend; shown to the provider."
                >
                  <Input name="reason" maxLength={1000} />
                </FormField>
                <SubmitButton variant="secondary">Apply</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
