import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatInZone } from "@/lib/dates";
import { simulateAction } from "@/modules/recovery/actions";
import { INCIDENT_LABELS } from "@/modules/recovery/rules";
import { getIncidentsView } from "@/modules/recovery/service";

export const metadata: Metadata = { title: "Crisis recovery" };

export default async function IncidentsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  const v = await getIncidentsView(eventId);
  const { event } = v;

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}`} className="text-ink-muted hover:text-ink">
          ← {event.name}
        </Link>
      </nav>
      <PageHeader
        title="Crisis recovery"
        description="Practice a venue cancellation: find what it touches, get a validated recovery proposal, then approve only the changes you want."
        badge={<Badge tone="warning">Simulation only</Badge>}
      />
      {!v.canManage ? (
        <Alert tone="info" title="Organizers only">
          Only the event&apos;s owner and organizers can run or see a recovery.
        </Alert>
      ) : (
        <>
          <Alert tone="warning" title="This is a simulation">
            Nothing here is a real incident. Simulating a cancellation does not change the venue
            booking, contact any provider or tell any attendee. Real cancellations stay separate,
            approval-gated booking actions.
          </Alert>

          <Card>
            <CardHeader>
              <CardTitle>Simulate a venue cancellation</CardTitle>
            </CardHeader>
            <CardBody>
              {v.bookings.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  No eligible venue booking. A venue booking must be sent to the venue or confirmed
                  by it, and must not already have an active recovery.{" "}
                  <Link href={`/app/events/${event.id}/bookings`} className="underline">
                    Go to bookings
                  </Link>
                </p>
              ) : (
                <ActionForm
                  action={simulateAction.bind(null, event.id)}
                  labels={{ bookingId: "Venue booking", note: "Note" }}
                >
                  <FormField label="Venue booking" required>
                    <Select name="bookingId" required>
                      {v.bookings.map((b) => (
                        <option key={b.booking_id} value={b.booking_id}>
                          {b.provider_name} · {formatInZone(b.service_from, event.timezone)} ·{" "}
                          {b.status.replaceAll("_", " ")}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Note" hint="Optional, e.g. “Practice run for the demo”.">
                    <Input name="note" maxLength={500} />
                  </FormField>
                  <SubmitButton>Simulate cancellation</SubmitButton>
                </ActionForm>
              )}
            </CardBody>
          </Card>

          {v.incidents.length === 0 ? (
            <EmptyState
              title="No simulated incidents yet"
              description="Run a simulation to see what a venue cancellation would affect."
            />
          ) : (
            <ul className="space-y-3">
              {v.incidents.map((i) => (
                <li key={i.id}>
                  <Card>
                    <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
                      <div>
                        <p className="font-medium">
                          Venue cancellation: {i.impact.venue.provider_name}
                        </p>
                        <p className="text-xs text-ink-muted">
                          Simulated {formatInZone(i.simulated_at, event.timezone)} ·{" "}
                          {i.impact.affected_tasks.length} task(s) · {i.impact.services.length}{" "}
                          service booking(s) · {i.impact.compliance.length} compliance item(s)
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone="warning">Simulated</Badge>
                        <Badge>{INCIDENT_LABELS[i.status]}</Badge>
                        <Link
                          href={`/app/events/${event.id}/incidents/${i.id}`}
                          className="text-primary underline"
                        >
                          Open
                        </Link>
                      </div>
                    </CardBody>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/** Data-dependent route behind the app shell Suspense; blocking navigation is intended. */
export const instant = false;
