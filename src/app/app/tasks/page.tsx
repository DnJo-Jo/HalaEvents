import type { Metadata } from "next";
import Link from "next/link";
import { EventStatusBadge } from "@/components/marketplace/status-badges";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { listMyEvents } from "@/modules/events/service";

export const metadata: Metadata = { title: "Tasks" };

/** Tasks belong to events; this page links to each event's task board. */
export default async function TasksPage() {
  const events = await listMyEvents();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="Choose an event to see its tasks, deadlines, owners and dependencies."
      />
      {events.length === 0 ? (
        <EmptyState title="No events" description="Create an event first." />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {events.map((e) => (
            <li key={e.id}>
              <Card>
                <CardBody className="flex items-center justify-between gap-2">
                  <Link
                    href={`/app/events/${e.id}/tasks`}
                    className="font-medium text-primary hover:underline"
                  >
                    {e.name}
                  </Link>
                  <EventStatusBadge status={e.status} />
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
