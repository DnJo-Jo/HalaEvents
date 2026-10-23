import type { Metadata } from "next";
import Link from "next/link";
import { EventStatusBadge } from "@/components/marketplace/status-badges";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { navItem } from "@/components/shell/nav";
import { formatInZone } from "@/lib/dates";
import { listMyEvents } from "@/modules/events/service";
import { requireMember } from "@/modules/profiles/service";

export const metadata: Metadata = { title: "Events" };

export default async function EventsPage() {
  const [{ roles }, events] = await Promise.all([requireMember(), listMyEvents()]);
  const isOrganizer = roles.includes("organizer");
  return (
    <div className="space-y-6">
      <PageHeader
        title="Events"
        description="Events you own or help organize."
        actions={
          isOrganizer ? <ButtonLink href="/app/events/new">New event</ButtonLink> : undefined
        }
      />
      {events.length === 0 ? (
        <EmptyState
          icon={<Icon path={navItem("/app/events").icon} className="size-6" />}
          title="No events yet"
          description={
            isOrganizer
              ? "Create your first event to shortlist providers and request quotes."
              : "Add the Organizer role in Settings to create events."
          }
          action={
            isOrganizer ? (
              <ButtonLink href="/app/events/new">Create an event</ButtonLink>
            ) : (
              <ButtonLink href="/app/settings" variant="secondary">
                Open settings
              </ButtonLink>
            )
          }
        />
      ) : (
        <Table caption="Your events">
          <THead>
            <TR>
              <TH>Event</TH>
              <TH>Starts</TH>
              <TH>Status</TH>
              <TH>Your role</TH>
            </TR>
          </THead>
          <TBody>
            {events.map((e) => (
              <TR key={e.id}>
                <TD>
                  <Link
                    href={`/app/events/${e.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {e.name}
                  </Link>
                  {e.city && <span className="block text-xs text-ink-muted">{e.city}</span>}
                </TD>
                <TD className="text-ink-muted">{formatInZone(e.starts_at, e.timezone)}</TD>
                <TD>
                  <EventStatusBadge status={e.status} />
                </TD>
                <TD>
                  <Badge>{e.member_role}</Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
