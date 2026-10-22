import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EventStatusBadge, RequestStatusBadge } from "@/components/marketplace/status-badges";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatInZone } from "@/lib/dates";
import { listRequestsForEvent } from "@/modules/bookings/service";
import { getEventForMember } from "@/modules/events/service";
import { removeFromShortlistAction } from "@/modules/marketplace/actions";
import { listShortlist } from "@/modules/marketplace/service";
import { CATEGORY_LABELS, formatMoney } from "@/modules/profiles/labels";

export const metadata: Metadata = { title: "Event" };

export default async function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  const { event: e, role, canManage } = await getEventForMember(eventId);
  const [shortlist, requests] = await Promise.all([
    listShortlist(eventId),
    canManage ? listRequestsForEvent(eventId) : [],
  ]);

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/app/events" className="text-ink-muted hover:text-ink">
          ← Events
        </Link>
      </nav>
      <PageHeader
        title={e.name}
        description={`${formatInZone(e.starts_at, e.timezone)} → ${formatInZone(e.ends_at, e.timezone, { zoneLabel: false })}`}
        badge={
          <span className="flex gap-1.5">
            <EventStatusBadge status={e.status} />
            <Badge>Your role: {role}</Badge>
          </span>
        }
        actions={
          canManage ? (
            <ButtonLink href={`/app/requests/new?event=${e.id}`} variant="secondary">
              New service request
            </ButtonLink>
          ) : undefined
        }
      />

      <Card>
        <CardBody>
          <dl className="grid gap-4 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-ink-muted">Capacity</dt>
              <dd>{e.capacity}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">City</dt>
              <dd>{e.city ?? "Not set"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Venue type</dt>
              <dd>{e.venue_type ?? "Not decided"}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">Budget</dt>
              <dd>
                {e.budget_amount !== null ? formatMoney(e.budget_amount, e.currency) : "Not set"}
              </dd>
            </div>
          </dl>
        </CardBody>
      </Card>

      <section aria-labelledby="shortlist-heading" className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 id="shortlist-heading" className="text-lg font-semibold">
            Shortlist
          </h2>
          <ButtonLink href="/app/marketplace" variant="ghost" size="sm">
            Browse marketplace
          </ButtonLink>
        </div>
        {shortlist.length === 0 ? (
          <EmptyState
            title="Nothing shortlisted"
            description="Shortlist providers from the marketplace to compare them here."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {shortlist.map((s) => (
              <li key={s.provider_id}>
                <Card className="h-full">
                  <CardBody className="flex h-full flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <Link
                          href={`/app/marketplace/${s.provider_id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {s.providers?.name ?? "Provider no longer listed"}
                        </Link>
                        {s.providers && (
                          <p className="text-xs text-ink-muted">
                            {CATEGORY_LABELS[
                              s.providers.category as keyof typeof CATEGORY_LABELS
                            ] ?? s.providers.category}
                            {s.providers.city ? ` · ${s.providers.city}` : ""}
                          </p>
                        )}
                      </div>
                      {s.providers?.is_demo && <DemoBadge>Demo listing</DemoBadge>}
                    </div>
                    {s.note && <p className="text-sm text-ink-muted">{s.note}</p>}
                    {canManage && (
                      <div className="mt-auto flex flex-wrap gap-2 pt-1">
                        {!s.providers?.is_demo && s.providers && (
                          <ButtonLink
                            href={`/app/requests/new?event=${e.id}&provider=${s.provider_id}`}
                            size="sm"
                          >
                            Request quote
                          </ButtonLink>
                        )}
                        <ActionForm
                          action={removeFromShortlistAction.bind(null, e.id, s.provider_id)}
                          className="space-y-0"
                        >
                          <SubmitButton variant="ghost" size="sm">
                            Remove
                          </SubmitButton>
                        </ActionForm>
                      </div>
                    )}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Service requests</CardTitle>
          </CardHeader>
          <CardBody>
            {requests.length === 0 ? (
              <p className="text-sm text-ink-muted">
                No requests yet. Request quotes from the shortlist or the marketplace.
              </p>
            ) : (
              <Table caption="Service requests for this event">
                <THead>
                  <TR>
                    <TH>Request</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Invited</TH>
                    <TH className="text-right">Quotes</TH>
                  </TR>
                </THead>
                <TBody>
                  {requests.map((r) => (
                    <TR key={r.id}>
                      <TD>
                        <Link
                          href={`/app/requests/${r.id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {r.title}
                        </Link>
                        <span className="block text-xs text-ink-muted">
                          {CATEGORY_LABELS[r.category]}
                        </span>
                      </TD>
                      <TD>
                        <RequestStatusBadge status={r.status} />
                      </TD>
                      <TD className="text-right tabular-nums">{r.invited}</TD>
                      <TD className="text-right tabular-nums">{r.quotes}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
