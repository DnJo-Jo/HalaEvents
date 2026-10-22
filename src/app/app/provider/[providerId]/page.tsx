import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ListingBadges } from "@/components/marketplace/badges";
import {
  PROVIDER_FIELD_LABELS,
  ProviderProfileFields,
} from "@/components/marketplace/provider-profile-fields";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate } from "@/lib/dates";
import {
  ACCESSIBILITY_LABELS,
  CATEGORY_LABELS,
  DOCUMENT_KIND_LABELS,
  PRICING_MODEL_LABELS,
  SUITABILITY_LABELS,
  indicativePrice,
} from "@/modules/profiles/labels";
import {
  addDocumentAction,
  addServiceAction,
  deleteDocumentAction,
  deleteServiceAction,
  saveVenueAction,
  setListedAction,
  setServiceActiveAction,
  submitForVerificationAction,
  updateProviderAction,
} from "@/modules/profiles/providers-actions";
import { getManagedProvider } from "@/modules/profiles/providers-service";
import { isPubliclyListed } from "@/modules/profiles/rules";
import {
  Accessibility,
  DocumentKind,
  PricingModel,
  ProviderCategory,
  Suitability,
} from "@/modules/profiles/schemas";

export const metadata: Metadata = { title: "Manage listing" };

export default async function ManageProviderPage({
  params,
}: {
  params: Promise<{ providerId: string }>;
}) {
  const { providerId } = await params;
  if (!z.uuid().safeParse(providerId).success) notFound();
  const {
    provider: p,
    role,
    privateDetails,
    venue,
    services,
    documents,
  } = await getManagedProvider(providerId);
  const isOwner = role === "owner";
  const live = isPubliclyListed(p);

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/app/provider" className="text-ink-muted hover:text-ink">
          ← My business
        </Link>
      </nav>
      <PageHeader
        title={p.name}
        description={`${CATEGORY_LABELS[p.category]} · ${live ? "Visible in the marketplace" : "Not visible in the marketplace"}`}
        badge={<ListingBadges p={p} />}
        actions={
          <ButtonLink href={`/app/marketplace/${p.id}`} variant="secondary" size="sm">
            View listing
          </ButtonLink>
        }
      />
      {!isOwner && (
        <Alert tone="info" title="Read-only">
          You&rsquo;re staff on this listing. Only the owner can edit it, but you can respond to
          quote requests.
        </Alert>
      )}

      {/* Status: verification (admin) · moderation (admin) · listing (owner) — three separate things. */}
      <Card>
        <CardHeader>
          <CardTitle>Status</CardTitle>
          <CardDescription>
            Verification means an admin reviewed your business details. It is separate from
            moderation and from pausing your own listing.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-4">
          {p.verification_status === "draft" && (
            <Alert tone="info" title="Draft">
              Complete your profile and contact email, add credentials, then submit for review.
            </Alert>
          )}
          {p.verification_status === "submitted" && (
            <Alert tone="info" title="Awaiting review">
              Submitted {p.submitted_at ? formatDate(p.submitted_at) : ""}. You&rsquo;ll see the
              decision here.
            </Alert>
          )}
          {p.verification_status === "rejected" && (
            <Alert tone="warning" title="Not approved">
              {p.verification_note ?? "No reason given."} Update your details and submit again.
            </Alert>
          )}
          {p.moderation_status !== "active" && (
            <Alert
              tone="danger"
              title={
                p.moderation_status === "suspended"
                  ? "Suspended by moderators"
                  : "Hidden by moderators"
              }
            >
              {p.moderation_reason ?? "No reason given."} Contact the HalaEvents team to resolve
              this.
            </Alert>
          )}
          {isOwner && (
            <div className="flex flex-wrap gap-2">
              {(p.verification_status === "draft" || p.verification_status === "rejected") && (
                <ActionForm
                  action={submitForVerificationAction.bind(null, p.id)}
                  className="space-y-2"
                >
                  <SubmitButton>Submit for verification</SubmitButton>
                </ActionForm>
              )}
              <ActionForm
                action={setListedAction.bind(null, p.id, !p.is_listed)}
                className="space-y-2"
              >
                <SubmitButton variant="secondary">
                  {p.is_listed ? "Pause listing" : "Resume listing"}
                </SubmitButton>
              </ActionForm>
            </div>
          )}
        </CardBody>
      </Card>

      {isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Business profile</CardTitle>
            <CardDescription>
              Prices are indicative. Organizers get your actual price in a quote.
            </CardDescription>
          </CardHeader>
          <CardBody>
            <ActionForm
              action={updateProviderAction.bind(null, p.id)}
              labels={PROVIDER_FIELD_LABELS}
            >
              <ProviderProfileFields p={p} priv={privateDetails} />
              <SubmitButton>Save profile</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}

      {p.kind === "venue" && isOwner && (
        <Card>
          <CardHeader>
            <CardTitle>Venue details</CardTitle>
          </CardHeader>
          <CardBody>
            <ActionForm
              action={saveVenueAction.bind(null, p.id)}
              labels={{
                seatedCapacity: "Seated capacity",
                standingCapacity: "Standing capacity",
                accessConditions: "Access conditions",
              }}
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Setting">
                  <Select name="setting" defaultValue={venue?.setting ?? "indoor"}>
                    <option value="indoor">Indoor</option>
                    <option value="outdoor">Outdoor</option>
                    <option value="mixed">Indoor & outdoor</option>
                  </Select>
                </FormField>
                <FormField label="Seated capacity">
                  <Input
                    name="seatedCapacity"
                    type="number"
                    min={1}
                    defaultValue={venue?.seated_capacity ?? ""}
                  />
                </FormField>
                <FormField label="Standing capacity">
                  <Input
                    name="standingCapacity"
                    type="number"
                    min={1}
                    defaultValue={venue?.standing_capacity ?? ""}
                  />
                </FormField>
                <FormField label="Area / district">
                  <Input name="area" maxLength={80} defaultValue={venue?.area ?? ""} />
                </FormField>
                <FormField label="Address" className="sm:col-span-2">
                  <Input
                    name="addressText"
                    maxLength={300}
                    defaultValue={venue?.address_text ?? ""}
                  />
                </FormField>
              </div>
              <FormField
                label="Access conditions"
                hint="e.g. loading times, ID requirements, noise curfews."
              >
                <Textarea
                  name="accessConditions"
                  rows={2}
                  maxLength={1000}
                  defaultValue={venue?.access_conditions ?? ""}
                />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <CheckboxGroup
                  legend="Accessibility"
                  name="accessibility"
                  options={Accessibility.options.map((a) => [a, ACCESSIBILITY_LABELS[a]])}
                  checked={venue?.accessibility ?? []}
                />
                <CheckboxGroup
                  legend="Suitable for"
                  name="suitability"
                  options={Suitability.options.map((s) => [s, SUITABILITY_LABELS[s]])}
                  checked={venue?.suitability ?? []}
                />
              </div>
              <SubmitButton variant="secondary">Save venue details</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Services</CardTitle>
          <CardDescription>
            Packages organizers can browse. Hidden services are visible only to your team.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-6">
          {services.length === 0 ? (
            <p className="text-sm text-ink-muted">No services yet.</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {services.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div>
                    <p className="font-medium">
                      {s.title} {!s.is_active && <Badge>Hidden</Badge>}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {CATEGORY_LABELS[s.category]} ·{" "}
                      {indicativePrice(s.pricing_model, s.price_from, s.price_to, s.currency)}
                    </p>
                  </div>
                  {isOwner && (
                    <div className="flex gap-2">
                      <ActionForm
                        action={setServiceActiveAction.bind(null, p.id, s.id, !s.is_active)}
                        className="space-y-0"
                      >
                        <SubmitButton variant="ghost" size="sm">
                          {s.is_active ? "Hide" : "Show"}
                        </SubmitButton>
                      </ActionForm>
                      <ActionForm
                        action={deleteServiceAction.bind(null, p.id, s.id)}
                        className="space-y-0"
                      >
                        <ConfirmSubmit
                          title={`Delete “${s.title}”?`}
                          description="This removes the service from your listing."
                          confirmLabel="Delete"
                        >
                          Delete
                        </ConfirmSubmit>
                      </ActionForm>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {isOwner && (
            <details className="rounded-md border border-line p-4 open:bg-surface-muted/40">
              <summary className="cursor-pointer text-sm font-medium">Add a service</summary>
              <ActionForm
                action={addServiceAction.bind(null, p.id)}
                resetOnSuccess
                className="mt-4"
                labels={{
                  title: "Title",
                  priceFrom: "Price from",
                  priceTo: "Price to",
                  pricingModel: "Pricing model",
                  maxQuantity: "Maximum",
                }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Title" required>
                    <Input name="title" required maxLength={120} />
                  </FormField>
                  <FormField label="Category">
                    <Select name="category" defaultValue={p.category}>
                      {ProviderCategory.options.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORY_LABELS[c]}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Pricing model">
                    <Select name="pricingModel" defaultValue="quote_only">
                      {PricingModel.options.map((m) => (
                        <option key={m} value={m}>
                          {PRICING_MODEL_LABELS[m]}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="From (AED)">
                      <Input name="priceFrom" type="number" min={0} />
                    </FormField>
                    <FormField label="To (AED)">
                      <Input name="priceTo" type="number" min={0} />
                    </FormField>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <FormField label="Min. quantity">
                      <Input name="minQuantity" type="number" min={1} />
                    </FormField>
                    <FormField label="Max. quantity">
                      <Input name="maxQuantity" type="number" min={1} />
                    </FormField>
                  </div>
                  <FormField label="Includes" hint="Comma-separated.">
                    <Input name="inclusions" />
                  </FormField>
                </div>
                <FormField label="Description">
                  <Textarea name="description" rows={2} maxLength={2000} />
                </FormField>
                <input type="hidden" name="currency" value={p.currency} />
                <input type="hidden" name="isActive" value="on" />
                <SubmitButton variant="secondary">Add service</SubmitButton>
              </ActionForm>
            </details>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Credentials</CardTitle>
          <CardDescription>
            Licences and certificates for the review team. Visible only to your team and HalaEvents
            admins — never to organizers. File uploads aren&rsquo;t available yet; record the
            reference number and issuer.
          </CardDescription>
        </CardHeader>
        <CardBody className="space-y-6">
          {documents.length === 0 ? (
            <p className="text-sm text-ink-muted">No credentials recorded.</p>
          ) : (
            <ul className="divide-y divide-line rounded-md border border-line">
              {documents.map((d) => (
                <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div>
                    <p className="font-medium">{d.title}</p>
                    <p className="text-xs text-ink-muted">
                      {DOCUMENT_KIND_LABELS[d.kind]}
                      {d.reference_number && ` · Ref ${d.reference_number}`}
                      {d.issued_by && ` · ${d.issued_by}`}
                      {d.expires_on && ` · expires ${formatDate(d.expires_on)}`}
                    </p>
                    {d.review_note && (
                      <p className="text-xs text-ink-muted">Reviewer: {d.review_note}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      tone={
                        d.review_status === "accepted"
                          ? "success"
                          : d.review_status === "rejected"
                            ? "danger"
                            : "info"
                      }
                    >
                      {d.review_status === "accepted"
                        ? "Accepted"
                        : d.review_status === "rejected"
                          ? "Rejected"
                          : "Awaiting review"}
                    </Badge>
                    {isOwner && (
                      <ActionForm
                        action={deleteDocumentAction.bind(null, p.id, d.id)}
                        className="space-y-0"
                      >
                        <ConfirmSubmit
                          title="Remove this credential?"
                          description="Admins will no longer see it."
                          confirmLabel="Remove"
                        >
                          Remove
                        </ConfirmSubmit>
                      </ActionForm>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {isOwner && (
            <details className="rounded-md border border-line p-4 open:bg-surface-muted/40">
              <summary className="cursor-pointer text-sm font-medium">Record a credential</summary>
              <ActionForm
                action={addDocumentAction.bind(null, p.id)}
                resetOnSuccess
                className="mt-4"
                labels={{ title: "Title", expiresOn: "Expiry date" }}
              >
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label="Type">
                    <Select name="kind" defaultValue="trade_license">
                      {DocumentKind.options.map((k) => (
                        <option key={k} value={k}>
                          {DOCUMENT_KIND_LABELS[k]}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Title" required>
                    <Input name="title" required maxLength={120} />
                  </FormField>
                  <FormField label="Reference number">
                    <Input name="referenceNumber" maxLength={80} />
                  </FormField>
                  <FormField label="Issued by">
                    <Input name="issuedBy" maxLength={120} />
                  </FormField>
                  <FormField label="Expires on">
                    <Input name="expiresOn" type="date" />
                  </FormField>
                </div>
                <SubmitButton variant="secondary">Record credential</SubmitButton>
              </ActionForm>
            </details>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function CheckboxGroup({
  legend,
  name,
  options,
  checked,
}: {
  legend: string;
  name: string;
  options: [string, string][];
  checked: string[];
}) {
  return (
    <fieldset className="space-y-1.5">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {options.map(([value, label]) => (
        <label key={value} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name={name}
            value={value}
            defaultChecked={checked.includes(value)}
            className="size-4 accent-[var(--primary)]"
          />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
