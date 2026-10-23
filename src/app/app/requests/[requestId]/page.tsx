import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { RequestSummary } from "@/components/bookings/request-summary";
import { Thread } from "@/components/bookings/thread";
import { InviteStatusBadge, QuoteStatusBadge } from "@/components/marketplace/status-badges";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { DemoBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmSubmit } from "@/components/ui/confirm-submit";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatInZone } from "@/lib/dates";
import { declineQuoteAction, setRequestStatusAction } from "@/modules/bookings/actions";
import { proposeBookingAction } from "@/modules/bookings/booking-actions";
import { quoteDisplayStatus } from "@/modules/bookings/rules";
import { getRequestForOrganizer } from "@/modules/bookings/service";
import { formatMoney } from "@/modules/profiles/labels";

export const metadata: Metadata = { title: "Service request" };

export default async function RequestPage({ params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params;
  if (!z.uuid().safeParse(requestId).success) notFound();
  const { request: r, invites, quotes, messages } = await getRequestForOrganizer(requestId);
  const nameOf = (pid: string) =>
    invites.find((i) => i.provider_id === pid)?.providers?.name ?? "Provider";
  const now = new Date();

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${r.event_id}`} className="text-ink-muted hover:text-ink">
          ← {r.event_name}
        </Link>
      </nav>
      <PageHeader
        title={r.title}
        description="Your request and the quotes you've received. A quote is an offer, not a booking."
        actions={
          <div className="flex flex-wrap gap-2">
            {r.status === "open" && (
              <ActionForm
                action={setRequestStatusAction.bind(null, r.id, "closed")}
                className="space-y-0"
              >
                <SubmitButton variant="secondary" size="sm">
                  Close to new quotes
                </SubmitButton>
              </ActionForm>
            )}
            {r.status === "closed" && (
              <ActionForm
                action={setRequestStatusAction.bind(null, r.id, "open")}
                className="space-y-0"
              >
                <SubmitButton variant="secondary" size="sm">
                  Reopen
                </SubmitButton>
              </ActionForm>
            )}
            {r.status !== "cancelled" && (
              <ActionForm
                action={setRequestStatusAction.bind(null, r.id, "cancelled")}
                className="space-y-0"
              >
                <ConfirmSubmit
                  title="Cancel this request?"
                  description="Invited providers will see it as cancelled and can no longer quote or message. This can't be undone."
                  confirmLabel="Cancel request"
                >
                  Cancel request
                </ConfirmSubmit>
              </ActionForm>
            )}
          </div>
        }
      />

      <RequestSummary r={r} />

      <section aria-labelledby="compare-heading" className="space-y-3">
        <h2 id="compare-heading" className="text-lg font-semibold">
          Compare quotes
        </h2>
        {quotes.length === 0 ? (
          <EmptyState
            title="No quotes yet"
            description="Providers' quotes appear here once they send them. Drafts stay private to the provider."
          />
        ) : (
          <>
            <Table caption="Quotes received for this request">
              <THead>
                <TR>
                  <TH>Provider</TH>
                  <TH className="text-right">Price</TH>
                  <TH>Includes</TH>
                  <TH>Excludes / conditions</TH>
                  <TH>Valid until</TH>
                  <TH>Status</TH>
                  <TH>
                    <span className="sr-only">Actions</span>
                  </TH>
                </TR>
              </THead>
              <TBody>
                {quotes.map((q) => {
                  const display = quoteDisplayStatus(q, now);
                  return (
                    <TR key={q.id}>
                      <TD className="font-medium">
                        {nameOf(q.provider_id)}
                        <span className="block text-xs text-ink-muted">Revision {q.revision}</span>
                      </TD>
                      <TD className="text-right font-semibold tabular-nums">
                        {formatMoney(q.amount, q.currency)}
                      </TD>
                      <TD className="max-w-56 text-sm whitespace-pre-line">{q.inclusions}</TD>
                      <TD className="max-w-56 text-sm whitespace-pre-line text-ink-muted">
                        {[
                          q.exclusions && `Excludes: ${q.exclusions}`,
                          q.conditions && `Conditions: ${q.conditions}`,
                        ]
                          .filter(Boolean)
                          .join("\n") || "—"}
                      </TD>
                      <TD className="text-sm">
                        {formatInZone(q.valid_until, r.timezone, { zoneLabel: false })}
                      </TD>
                      <TD>
                        <QuoteStatusBadge status={display} />
                        {q.decline_reason && (
                          <span className="block text-xs text-ink-muted">{q.decline_reason}</span>
                        )}
                      </TD>
                      <TD>
                        {q.status === "submitted" && (
                          <ActionForm action={declineQuoteAction} className="space-y-2">
                            <input type="hidden" name="quoteId" value={q.id} />
                            <Input
                              name="reason"
                              placeholder="Reason (optional)"
                              aria-label={`Reason for declining ${nameOf(q.provider_id)}'s quote`}
                              className="h-8 min-w-36"
                            />
                            <ConfirmSubmit
                              title={`Decline ${nameOf(q.provider_id)}'s quote?`}
                              description="The provider will see that you declined. They can't revise a declined quote."
                              confirmLabel="Decline quote"
                            >
                              Decline
                            </ConfirmSubmit>
                          </ActionForm>
                        )}
                        {display === "submitted" && r.status !== "cancelled" && (
                          <ActionForm
                            action={proposeBookingAction.bind(null, q.id)}
                            className="mt-2 space-y-2"
                            aria-label={`Propose booking with ${nameOf(q.provider_id)}`}
                          >
                            <SubmitButton size="sm" variant="secondary">
                              Propose booking
                            </SubmitButton>
                            <span className="block text-xs text-ink-muted">
                              Not booked until approved and confirmed by the provider.
                            </span>
                          </ActionForm>
                        )}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
            <p className="text-xs text-ink-muted">
              Sorted by live quotes first, then price. Proposing a booking needs your approval and
              the provider&rsquo;s confirmation — nothing here books a provider by itself.
            </p>
          </>
        )}
      </section>

      <section aria-labelledby="providers-heading" className="space-y-3">
        <h2 id="providers-heading" className="text-lg font-semibold">
          Invited providers & questions
        </h2>
        <div className="grid gap-4 lg:grid-cols-2">
          {invites.map((i) => (
            <Card key={i.provider_id}>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle>
                  <Link href={`/app/marketplace/${i.provider_id}`} className="hover:underline">
                    {i.providers?.name ?? "Provider"}
                  </Link>
                </CardTitle>
                <span className="flex gap-1.5">
                  {i.providers?.is_demo && <DemoBadge>Demo</DemoBadge>}
                  <InviteStatusBadge
                    status={i.status}
                    quoted={quotes.some(
                      (q) => q.provider_id === i.provider_id && q.status === "submitted",
                    )}
                  />
                </span>
              </CardHeader>
              <CardBody className="space-y-3">
                {i.status === "declined" && (
                  <Alert tone="info" title="Declined">
                    {i.decline_reason ?? "No reason given."}
                    {i.responded_at &&
                      ` · ${formatInZone(i.responded_at, r.timezone, { zoneLabel: false })}`}
                  </Alert>
                )}
                <Thread
                  messages={messages.filter((m) => m.provider_id === i.provider_id)}
                  requestId={r.id}
                  providerId={i.provider_id}
                  side="organizer"
                  timezone={r.timezone}
                  canPost={r.status !== "cancelled"}
                  counterpart={i.providers?.name ?? "Provider"}
                />
              </CardBody>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

/** Data-dependent route behind the app shell Suspense; blocking navigation is intended. */
export const instant = false;
