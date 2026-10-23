import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { toLocalInput } from "@/lib/dates";
import { createRequestAction } from "@/modules/bookings/actions";
import { getEventForMember } from "@/modules/events/service";
import { getListing, listShortlist } from "@/modules/marketplace/service";
import { CATEGORY_LABELS } from "@/modules/profiles/labels";
import { ProviderCategory } from "@/modules/profiles/schemas";

export const metadata: Metadata = { title: "New service request" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function NewRequestPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const eventId = z.uuid().safeParse(sp.event);
  if (!eventId.success) notFound();
  const { event, canManage } = await getEventForMember(eventId.data);
  if (!canManage) notFound();

  const preselected = z.uuid().safeParse(sp.provider);
  const [shortlist, listing] = await Promise.all([
    listShortlist(event.id),
    preselected.success ? getListing(preselected.data) : Promise.resolve(null),
  ]);
  const candidates = new Map<string, { name: string; category: string }>();
  if (listing && !listing.provider.is_demo) {
    candidates.set(listing.provider.id, {
      name: listing.provider.name,
      category: listing.provider.category,
    });
  }
  for (const s of shortlist) {
    if (s.providers && !s.providers.is_demo)
      candidates.set(s.provider_id, { name: s.providers.name, category: s.providers.category });
  }
  const defaultCategory = listing?.provider.category ?? "catering";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}`} className="text-ink-muted hover:text-ink">
          ← {event.name}
        </Link>
      </nav>
      <PageHeader
        title="New service request"
        description="Invited providers see these details and can ask questions, decline, or send a quote. Other providers see nothing."
      />
      {candidates.size === 0 ? (
        <Alert tone="info" title="Choose providers first">
          Shortlist providers for this event in the{" "}
          <Link href="/app/marketplace" className="underline">
            marketplace
          </Link>
          , then come back. Demo listings can&rsquo;t receive requests.
        </Alert>
      ) : (
        <Card>
          <CardBody>
            <ActionForm
              action={createRequestAction}
              labels={{
                category: "Category",
                title: "Title",
                requirements: "Requirements",
                neededFrom: "Needed from",
                neededTo: "Needed until",
                expectedAttendance: "Expected attendance",
                budgetMax: "Budget",
                respondBy: "Respond by",
                providerIds: "Providers",
              }}
            >
              <input type="hidden" name="eventId" value={event.id} />
              <input type="hidden" name="currency" value={event.currency} />
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Category" required>
                  <Select name="category" defaultValue={defaultCategory}>
                    {ProviderCategory.options.map((c) => (
                      <option key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </option>
                    ))}
                  </Select>
                </FormField>
                <FormField label="Title" required>
                  <Input
                    name="title"
                    required
                    maxLength={120}
                    placeholder="e.g. Meals for 24-hour hackathon"
                  />
                </FormField>
              </div>
              <FormField
                label="Requirements"
                hint="What you need, constraints (dietary, access, setup times), and anything a quote should cover."
                required
              >
                <Textarea name="requirements" required minLength={10} maxLength={4000} rows={6} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Needed from" hint={`Times in ${event.timezone}.`} required>
                  <Input
                    name="neededFrom"
                    type="datetime-local"
                    required
                    defaultValue={toLocalInput(event.starts_at, event.timezone)}
                  />
                </FormField>
                <FormField label="Needed until" required>
                  <Input
                    name="neededTo"
                    type="datetime-local"
                    required
                    defaultValue={toLocalInput(event.ends_at, event.timezone)}
                  />
                </FormField>
                <FormField label="Expected attendance" required>
                  <Input
                    name="expectedAttendance"
                    type="number"
                    min={1}
                    max={100000}
                    required
                    defaultValue={event.capacity}
                  />
                </FormField>
                <FormField
                  label={`Maximum budget (${event.currency})`}
                  hint="Optional. Shared with invited providers."
                >
                  <Input name="budgetMax" type="number" min={0} inputMode="decimal" />
                </FormField>
                <FormField label="Respond by" hint="Optional deadline for quotes.">
                  <Input name="respondBy" type="datetime-local" />
                </FormField>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Send to (max 10)</legend>
                {[...candidates].map(([id, c]) => (
                  <label
                    key={id}
                    className="flex items-center gap-3 rounded-md border border-line p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary-soft"
                  >
                    <input
                      type="checkbox"
                      name="providerIds"
                      value={id}
                      defaultChecked={
                        id === (preselected.success ? preselected.data : undefined) ||
                        candidates.size === 1
                      }
                      className="size-4 accent-[var(--primary)]"
                    />
                    <span className="font-medium">{c.name}</span>
                    <span className="text-ink-muted">
                      {CATEGORY_LABELS[c.category as keyof typeof CATEGORY_LABELS]}
                    </span>
                  </label>
                ))}
              </fieldset>
              <SubmitButton>Send request</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/** Data-dependent route behind the app shell Suspense; blocking navigation is intended. */
export const instant = false;
