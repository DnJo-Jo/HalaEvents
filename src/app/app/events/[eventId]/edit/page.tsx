import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { toLocalInput } from "@/lib/dates";
import { updateEventAction } from "@/modules/events/actions";
import { getEventForMember } from "@/modules/events/service";

export const metadata: Metadata = { title: "Edit event" };

const TIMEZONES = [
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Qatar",
  "Asia/Bahrain",
  "Asia/Kuwait",
  "Asia/Muscat",
  "Europe/London",
  "UTC",
];

const EDITABLE = new Set(["draft", "planning", "ready", "live"]);

export default async function EditEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  const { event: e, canManage } = await getEventForMember(eventId);
  const timezones = TIMEZONES.includes(e.timezone) ? TIMEZONES : [e.timezone, ...TIMEZONES];
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${e.id}`} className="text-ink-muted hover:text-ink">
          ← {e.name}
        </Link>
      </nav>
      <PageHeader
        title="Edit event"
        description="Changing dates, venue type or city can change which interview questions and compliance checks apply. Re-run the checks afterwards."
      />
      {!canManage || !EDITABLE.has(e.status) ? (
        <Alert tone="warning" title="Read-only">
          {canManage
            ? `This event is ${e.status}, so its details can't change.`
            : "Only the event's owner or organizers can edit it."}
        </Alert>
      ) : (
        <Card>
          <CardBody>
            <ActionForm
              action={updateEventAction.bind(null, e.id)}
              labels={{
                name: "Event name",
                startsAt: "Starts",
                endsAt: "Ends",
                capacity: "Capacity",
                timezone: "Timezone",
                budgetAmount: "Budget",
                city: "City",
              }}
            >
              <FormField label="Event name" required>
                <Input name="name" required minLength={3} maxLength={120} defaultValue={e.name} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Starts" hint="In the event's timezone." required>
                  <Input
                    name="startsAt"
                    type="datetime-local"
                    required
                    defaultValue={toLocalInput(e.starts_at, e.timezone)}
                  />
                </FormField>
                <FormField label="Ends" required>
                  <Input
                    name="endsAt"
                    type="datetime-local"
                    required
                    defaultValue={toLocalInput(e.ends_at, e.timezone)}
                  />
                </FormField>
                <FormField label="Timezone">
                  <Select name="timezone" defaultValue={e.timezone}>
                    {timezones.map((tz) => (
                      <option key={tz}>{tz}</option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Expected capacity" required>
                  <Input
                    name="capacity"
                    type="number"
                    min={1}
                    max={100000}
                    required
                    inputMode="numeric"
                    defaultValue={e.capacity}
                  />
                </FormField>
                <FormField label="Venue type">
                  <Select name="venueType" defaultValue={e.venue_type ?? ""}>
                    <option value="">Not decided</option>
                    <option value="indoor">Indoor</option>
                    <option value="outdoor">Outdoor</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="online">Online</option>
                  </Select>
                </FormField>
                <FormField label="City">
                  <Input name="city" maxLength={80} defaultValue={e.city ?? ""} />
                </FormField>
                <FormField label="Budget (AED)" hint="Optional.">
                  <Input
                    name="budgetAmount"
                    type="number"
                    min={0}
                    inputMode="decimal"
                    defaultValue={e.budget_amount ?? ""}
                  />
                </FormField>
              </div>
              <input type="hidden" name="currency" value={e.currency} />
              <SubmitButton>Save changes</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
