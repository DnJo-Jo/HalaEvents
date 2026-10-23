import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RequestSummary } from "@/components/bookings/request-summary";
import { Thread } from "@/components/bookings/thread";
import { QuoteStatusBadge } from "@/components/marketplace/status-badges";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { FormField } from "@/components/ui/form-field";
import { Input, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatInZone, toLocalInput } from "@/lib/dates";
import {
  declineRequestAction,
  saveQuoteAction,
  withdrawQuoteAction,
} from "@/modules/bookings/actions";
import {
  canTransitionQuote,
  defaultValidUntil,
  quoteDisplayStatus,
} from "@/modules/bookings/rules";
import { getRequestForProvider } from "@/modules/bookings/service";
import { formatMoney } from "@/modules/profiles/labels";

export const metadata: Metadata = { title: "Respond to request" };

export default async function RespondPage({
  params,
}: {
  params: Promise<{ requestId: string; providerId: string }>;
}) {
  const { requestId, providerId } = await params;
  if (!z.uuid().safeParse(requestId).success || !z.uuid().safeParse(providerId).success) notFound();
  const {
    request: r,
    invite,
    quote,
    messages,
    provider,
  } = await getRequestForProvider(requestId, providerId);

  const open = r.status === "open";
  const declined = invite.status === "declined";
  const canEditQuote =
    open && !declined && (!quote || canTransitionQuote(quote.status, "submitted", "provider"));

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/app/provider/requests" className="text-ink-muted hover:text-ink">
          ← Quote requests
        </Link>
      </nav>
      <PageHeader
        title={r.title}
        description={`From ${r.event_name}${r.event_city ? ` (${r.event_city})` : ""} · for your listing “${provider.name}”`}
      />
      {r.status === "cancelled" && (
        <Alert tone="warning" title="The organizer cancelled this request." />
      )}
      {r.status === "closed" && (
        <Alert tone="info" title="The organizer closed this request to new quotes." />
      )}
      {declined && (
        <Alert tone="info" title="You declined this request">
          {invite.decline_reason ?? ""}
        </Alert>
      )}

      <RequestSummary r={r} />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader>
            <CardTitle>Your quote</CardTitle>
            <CardDescription>
              Drafts are private. A submitted quote is an offer to this organizer only — other
              providers never see it. It is not a booking.
            </CardDescription>
          </CardHeader>
          <CardBody className="space-y-4">
            {quote && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <QuoteStatusBadge status={quoteDisplayStatus(quote)} />
                <span className="text-ink-muted">
                  {formatMoney(quote.amount, quote.currency)} · revision {quote.revision} · valid
                  until {formatInZone(quote.valid_until, r.timezone, { zoneLabel: false })}
                </span>
              </div>
            )}
            {quote?.status === "declined" && (
              <Alert tone="info" title="The organizer declined this quote">
                {quote.decline_reason ?? "No reason given."}
              </Alert>
            )}
            {canEditQuote ? (
              <ActionForm
                action={saveQuoteAction}
                labels={{
                  amount: "Price",
                  inclusions: "Includes",
                  validUntil: "Valid until",
                  exclusions: "Excludes",
                  conditions: "Conditions",
                }}
              >
                <input type="hidden" name="requestId" value={r.id} />
                <input type="hidden" name="providerId" value={providerId} />
                <input type="hidden" name="currency" value={r.currency} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField label={`Total price (${r.currency})`} required>
                    <Input
                      name="amount"
                      type="number"
                      min={0}
                      step="0.01"
                      required
                      defaultValue={quote?.amount ?? ""}
                    />
                  </FormField>
                  <FormField label="Valid until" hint={`In ${r.timezone}.`} required>
                    <Input
                      name="validUntil"
                      type="datetime-local"
                      required
                      defaultValue={toLocalInput(defaultValidUntil(quote?.valid_until), r.timezone)}
                    />
                  </FormField>
                </div>
                <FormField label="What's included" required>
                  <Textarea
                    name="inclusions"
                    rows={3}
                    required
                    maxLength={4000}
                    defaultValue={quote?.inclusions ?? ""}
                  />
                </FormField>
                <FormField label="Not included">
                  <Textarea
                    name="exclusions"
                    rows={2}
                    maxLength={4000}
                    defaultValue={quote?.exclusions ?? ""}
                  />
                </FormField>
                <FormField label="Conditions" hint="Deposit, cancellation terms, access needs…">
                  <Textarea
                    name="conditions"
                    rows={2}
                    maxLength={4000}
                    defaultValue={quote?.conditions ?? ""}
                  />
                </FormField>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="intent" value="submit">
                    {quote?.status === "submitted" ? "Send revised quote" : "Send quote"}
                  </SubmitButton>
                  {(!quote || quote.status !== "submitted") && (
                    <SubmitButton name="intent" value="draft" variant="secondary">
                      Save draft
                    </SubmitButton>
                  )}
                </div>
              </ActionForm>
            ) : (
              !quote && (
                <p className="text-sm text-ink-muted">This request isn&rsquo;t accepting quotes.</p>
              )
            )}
            {quote && canTransitionQuote(quote.status, "withdrawn", "provider") && (
              <ActionForm action={withdrawQuoteAction.bind(null, quote.id)} className="space-y-0">
                <ConfirmSubmit
                  title="Withdraw your quote?"
                  description="The organizer will see it as withdrawn. You can send it again while the request is open."
                  confirmLabel="Withdraw"
                >
                  Withdraw quote
                </ConfirmSubmit>
              </ActionForm>
            )}
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Questions</CardTitle>
              <CardDescription>Private between you and the organizer.</CardDescription>
            </CardHeader>
            <CardBody>
              <Thread
                messages={messages}
                requestId={r.id}
                providerId={providerId}
                side="provider"
                timezone={r.timezone}
                canPost={r.status !== "cancelled"}
                counterpart="Organizer"
              />
            </CardBody>
          </Card>

          {open && !declined && quote?.status !== "submitted" && (
            <Card>
              <CardHeader>
                <CardTitle>Can&rsquo;t take this on?</CardTitle>
              </CardHeader>
              <CardBody>
                <ActionForm action={declineRequestAction}>
                  <input type="hidden" name="requestId" value={r.id} />
                  <input type="hidden" name="providerId" value={providerId} />
                  <FormField label="Reason" hint="Optional, shared with the organizer.">
                    <Input name="reason" maxLength={1000} />
                  </FormField>
                  <ConfirmSubmit
                    title="Decline this request?"
                    description="The organizer will see that you declined. You won't be able to quote on it afterwards."
                    confirmLabel="Decline request"
                  >
                    Decline request
                  </ConfirmSubmit>
                </ActionForm>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

/** Data-dependent route behind the app shell Suspense; blocking navigation is intended. */
export const instant = false;
