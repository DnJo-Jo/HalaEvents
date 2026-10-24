import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { VENDOR_CATEGORIES } from "@/lib/integrations/vendor-categories";
import { saveServicesAction } from "@/modules/vendors/actions";
import { SERVICE_HINTS, SERVICE_LABELS } from "@/modules/vendors/schemas";
import { getVendorsView } from "@/modules/vendors/service";

export const metadata: Metadata = { title: "Event services" };

export default async function ServicesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  const { event, canEdit } = await getVendorsView(eventId);

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}`} className="text-ink-muted hover:text-ink">
          ← {event.name}
        </Link>
      </nav>
      <PageHeader
        title="What services do you need for your event?"
        description="Optional. Pick any that apply, or none. You can change this later; it helps the plan and the vendor search, and nothing is searched or sent until you ask."
      />
      <Card>
        <CardBody>
          {canEdit ? (
            <ActionForm
              action={saveServicesAction.bind(null, event.id)}
              aria-label="Services"
              className="space-y-4"
            >
              <fieldset className="space-y-3">
                <legend className="sr-only">Services</legend>
                {VENDOR_CATEGORIES.map((c) => (
                  <label key={c} className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      name="services"
                      value={c}
                      defaultChecked={event.services.includes(c)}
                      className="mt-1 size-4"
                    />
                    <span>
                      <span className="font-medium">{SERVICE_LABELS[c]}</span>
                      <span className="block text-ink-muted">{SERVICE_HINTS[c]}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <SubmitButton>Save services</SubmitButton>
            </ActionForm>
          ) : (
            <p className="text-sm">
              {event.services.length
                ? event.services.map((s) => SERVICE_LABELS[s]).join(", ")
                : "No services selected."}
            </p>
          )}
        </CardBody>
      </Card>
      {!canEdit && (
        <Alert tone="info" title="View only">
          Only the event&apos;s owner or organizers can change this.
        </Alert>
      )}
      <div className="flex flex-wrap gap-2">
        <ButtonLink href={`/app/events/${event.id}/interview`}>Continue to Talk to Hala</ButtonLink>
        {event.services.length > 0 && (
          <ButtonLink href={`/app/events/${event.id}/vendors`} variant="secondary">
            Find vendors
          </ButtonLink>
        )}
      </div>
    </div>
  );
}
