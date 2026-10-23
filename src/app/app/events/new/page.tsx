import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { createEventAction } from "@/modules/events/actions";
import { EVENT_TYPE_LABELS } from "@/modules/events/schemas";
import { requireMember } from "@/modules/profiles/service";

export const metadata: Metadata = { title: "New event" };

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

export default async function NewEventPage() {
  const { roles } = await requireMember();
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/app/events" className="text-ink-muted hover:text-ink">
          ← Events
        </Link>
      </nav>
      <PageHeader
        title="New event"
        description="The essentials. Planning tools build on this later."
      />
      {!roles.includes("organizer") ? (
        <Alert tone="warning" title="Organizer role needed">
          Add the Organizer role in{" "}
          <Link href="/app/settings" className="underline">
            Settings
          </Link>{" "}
          to create events.
        </Alert>
      ) : (
        <Card>
          <CardBody>
            <ActionForm
              action={createEventAction}
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
                <Input
                  name="name"
                  required
                  minLength={3}
                  maxLength={120}
                  placeholder="e.g. Campus Innovation Day 2026"
                />
              </FormField>
              <FormField
                label="Event type"
                hint="Decides which planning questions and checklist you get."
              >
                <Select name="eventType" defaultValue="university_hackathon">
                  {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Starts" hint="In the event's timezone." required>
                  <Input name="startsAt" type="datetime-local" required />
                </FormField>
                <FormField label="Ends" required>
                  <Input name="endsAt" type="datetime-local" required />
                </FormField>
                <FormField label="Timezone">
                  <Select name="timezone" defaultValue="Asia/Dubai">
                    {TIMEZONES.map((tz) => (
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
                  />
                </FormField>
                <FormField label="Venue type">
                  <Select name="venueType" defaultValue="">
                    <option value="">Not decided</option>
                    <option value="indoor">Indoor</option>
                    <option value="outdoor">Outdoor</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="online">Online</option>
                  </Select>
                </FormField>
                <FormField label="City">
                  <Input name="city" maxLength={80} placeholder="e.g. Dubai" />
                </FormField>
                <FormField label="Budget (AED)" hint="Optional.">
                  <Input name="budgetAmount" type="number" min={0} inputMode="decimal" />
                </FormField>
              </div>
              <input type="hidden" name="currency" value="AED" />
              <SubmitButton>Create event</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
