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
import { Alert } from "@/components/ui/alert";
import { Select } from "@/components/ui/input";
import { formatInZone } from "@/lib/dates";
import { getComplianceOverview } from "@/modules/compliance/service";
import { changeEventStatusAction } from "@/modules/events/actions";
import { EVENT_TRANSITIONS } from "@/modules/events/rules";
import { describeTimelineEntry } from "@/modules/events/timeline";
import { refreshRemindersAction } from "@/modules/notifications/actions";
import { getTaskBoard } from "@/modules/tasks/service";
import { listRequestsForEvent } from "@/modules/bookings/service";
import { getEventForMember, getTimeline } from "@/modules/events/service";
import { removeFromShortlistAction } from "@/modules/marketplace/actions";
import { listShortlist } from "@/modules/marketplace/service";
import { CATEGORY_LABELS, formatMoney } from "@/modules/profiles/labels";

export const metadata: Metadata = { title: "Event" };

export default async function EventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  const { event: e, role, canManage } = await getEventForMember(eventId);
  const [shortlist, requests, board, compliance, timeline] = await Promise.all([
    listShortlist(eventId),
    canManage ? listRequestsForEvent(eventId) : [],
    getTaskBoard(eventId),
    getComplianceOverview(eventId),
    getTimeline(eventId, 15),
  ]);
  const p = board.progress;
  const openChecks = compliance.checks.filter(
    (c) => !["cleared", "rejected", "closed"].includes(c.status),
  );
  const concerns = openChecks.filter((c) => c.severity === "concern").length;
  const actionRequired = openChecks.filter((c) => c.status === "action_required").length;
  const upcoming = board.tasks
    .filter((t) => board.derived.get(t.id)?.overdue || board.derived.get(t.id)?.dueSoon)
    .slice(0, 5);
  const nextStatuses = EVENT_TRANSITIONS[e.status];

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
          <>
            {canManage && (
              <ButtonLink href={`/app/events/${e.id}/edit`} variant="ghost">
                Edit details
              </ButtonLink>
            )}
            <ButtonLink href={`/app/events/${e.id}/tasks`} variant="secondary">
              Tasks
            </ButtonLink>
            <ButtonLink href={`/app/events/${e.id}/compliance`} variant="secondary">
              Compliance
            </ButtonLink>
            <ButtonLink href={`/app/events/${e.id}/attendees`} variant="secondary">
              Attendees
            </ButtonLink>
            {canManage && (
              <>
                <ButtonLink href={`/app/events/${e.id}/messages`} variant="secondary">
                  Messages
                </ButtonLink>
                <ButtonLink href={`/app/events/${e.id}/bookings`} variant="secondary">
                  Bookings
                </ButtonLink>
                <ButtonLink href={`/app/events/${e.id}/incidents`} variant="secondary">
                  Crisis recovery
                </ButtonLink>
              </>
            )}
            <ButtonLink href={`/app/events/${e.id}/interview`} variant="secondary">
              Planning interview
            </ButtonLink>
            <ButtonLink href={`/app/events/${e.id}/plan`} variant="secondary">
              Plan
            </ButtonLink>
            {canManage && (
              <ButtonLink href={`/app/requests/new?event=${e.id}`} variant="secondary">
                New service request
              </ButtonLink>
            )}
          </>
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

      <section aria-labelledby="progress-heading" className="space-y-3">
        <h2 id="progress-heading" className="text-lg font-semibold">
          Progress
        </h2>
        <div className="grid gap-3 sm:grid-cols-4">
          <Card>
            <CardBody>
              <p className="text-xs text-ink-muted">Tasks done</p>
              <p className="text-2xl font-semibold tabular-nums">
                {p.percent === null ? "—" : `${p.percent}%`}
              </p>
              <p className="text-xs text-ink-muted">
                {p.done} of {p.total - p.cancelled} ({p.cancelled} cancelled)
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-xs text-ink-muted">Overdue / blocked</p>
              <p className="text-2xl font-semibold tabular-nums">
                {p.overdue} / {p.blocked}
              </p>
              <p className="text-xs text-ink-muted">
                Today is {board.today} ({e.timezone})
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-xs text-ink-muted">Open compliance checks</p>
              <p className="text-2xl font-semibold tabular-nums">{openChecks.length}</p>
              <p className="text-xs text-ink-muted">
                {concerns} possible concern{concerns === 1 ? "" : "s"} · {actionRequired} action
                required
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-xs text-ink-muted">Unchecked rule results</p>
              <p className="text-2xl font-semibold tabular-nums">{compliance.pending}</p>
              <p className="text-xs text-ink-muted">Run the compliance checks to add them.</p>
            </CardBody>
          </Card>
        </div>
        {p.total === 0 && (
          <Alert tone="info" title="No tasks yet">
            Answer the{" "}
            <Link href={`/app/events/${e.id}/interview`} className="underline">
              planning interview
            </Link>
            , generate a{" "}
            <Link href={`/app/events/${e.id}/plan`} className="underline">
              plan
            </Link>{" "}
            and accept it, or add tasks by hand.
          </Alert>
        )}
        {upcoming.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Due soon or overdue</CardTitle>
            </CardHeader>
            <CardBody>
              <ul className="space-y-1 text-sm">
                {upcoming.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <span>{t.title}</span>
                    <Badge tone={board.derived.get(t.id)?.overdue ? "danger" : "warning"}>
                      {board.derived.get(t.id)?.overdue ? "Overdue" : "Due"} {t.due_date}
                    </Badge>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        )}
        {canManage && (
          <div className="flex flex-wrap items-end gap-4">
            {nextStatuses.length > 0 && (
              <ActionForm
                action={changeEventStatusAction.bind(null, e.id)}
                className="flex flex-wrap items-end gap-2 space-y-0"
                aria-label="Change event status"
              >
                <label className="text-sm">
                  <span className="block text-xs text-ink-muted">Event status</span>
                  <Select name="status" defaultValue={nextStatuses[0]} aria-label="New status">
                    {nextStatuses.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </Select>
                </label>
                <SubmitButton variant="secondary" size="sm">
                  Change status
                </SubmitButton>
              </ActionForm>
            )}
            <ActionForm
              action={refreshRemindersAction.bind(null, e.id)}
              className="space-y-0"
              aria-label="Check reminders"
            >
              <SubmitButton variant="ghost" size="sm">
                Check deadlines and missing information
              </SubmitButton>
            </ActionForm>
          </div>
        )}
      </section>

      <section aria-labelledby="timeline-heading" className="space-y-3">
        <h2 id="timeline-heading" className="text-lg font-semibold">
          Timeline
        </h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-ink-muted">No changes recorded yet.</p>
        ) : (
          <ol className="space-y-2 border-l border-line pl-4 text-sm">
            {timeline.map((t, i) => (
              <li key={`${t.at}-${i}`}>
                <span className="font-medium">{t.actor_name}</span> {describeTimelineEntry(t)}
                <span className="block text-xs text-ink-muted">
                  {formatInZone(t.at, e.timezone)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

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
