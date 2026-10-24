import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { VendorSearch } from "@/components/vendors/vendor-search";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { removeVendorAction, saveVendorNoteAction } from "@/modules/vendors/actions";
import { SERVICE_LABELS } from "@/modules/vendors/schemas";
import { getVendorsView } from "@/modules/vendors/service";

export const metadata: Metadata = { title: "Find vendors" };

export default async function VendorsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  const { event, canManage, canEdit, shortlist } = await getVendorsView(eventId);
  const link = "underline underline-offset-2";

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}`} className="text-ink-muted hover:text-ink">
          ← {event.name}
        </Link>
      </nav>
      <PageHeader
        title="Find vendors"
        description="Search for businesses near your event. Results are candidates only: nothing here is a quote, a confirmed availability or a booking."
        actions={
          <ButtonLink href={`/app/events/${event.id}/services`} variant="secondary">
            Change services
          </ButtonLink>
        }
      />
      {!canManage ? (
        <Alert tone="info" title="Organizers only">
          Vendor search is available to the event&apos;s owner and organizers.
        </Alert>
      ) : event.services.length === 0 ? (
        <Alert tone="info" title="No services selected">
          Choose the services you need (venue, catering, transportation) to search for vendors.{" "}
          <Link className={link} href={`/app/events/${event.id}/services`}>
            Select services
          </Link>
        </Alert>
      ) : (
        <>
          <VendorSearch
            eventId={event.id}
            categories={event.services}
            defaultLocation={event.location_text || event.city || ""}
            shortlistedKeys={shortlist.map((v) => `${v.category}:${v.place_id}`)}
            canEdit={canEdit}
          />
          <p className="text-xs text-ink-muted">
            Powered by{" "}
            <a
              className={link}
              href="https://www.geoapify.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Geoapify
            </a>{" "}
            ·{" "}
            <a
              className={link}
              href="https://www.openstreetmap.org/copyright"
              target="_blank"
              rel="noopener noreferrer"
            >
              © OpenStreetMap contributors
            </a>
          </p>
        </>
      )}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Shortlist</CardTitle>
            <CardDescription>
              Candidates you kept for this event, with your own notes.
            </CardDescription>
          </CardHeader>
          <CardBody>
            {shortlist.length === 0 ? (
              <p className="text-sm text-ink-muted">Nothing shortlisted yet.</p>
            ) : (
              <ul className="space-y-4">
                {shortlist.map((v) => (
                  <li key={`${v.category}:${v.place_id}`} className="space-y-2 text-sm">
                    <p>
                      <span className="font-medium">{v.name}</span>{" "}
                      <span className="text-ink-muted">· {SERVICE_LABELS[v.category]}</span>
                    </p>
                    {v.address && <p className="text-ink-muted">{v.address}</p>}
                    <ActionForm
                      action={saveVendorNoteAction.bind(null, event.id)}
                      className="flex flex-wrap items-center gap-2 space-y-0"
                      aria-label={`Note for ${v.name}`}
                    >
                      <input type="hidden" name="category" value={v.category} />
                      <input type="hidden" name="placeId" value={v.place_id} />
                      <Input
                        name="note"
                        defaultValue={v.note ?? ""}
                        maxLength={500}
                        placeholder="Your note"
                        aria-label={`Note for ${v.name}`}
                        className="max-w-sm"
                        disabled={!canEdit}
                      />
                      {canEdit && (
                        <SubmitButton variant="secondary" size="sm">
                          Save note
                        </SubmitButton>
                      )}
                    </ActionForm>
                    {canEdit && (
                      <form action={removeVendorAction.bind(null, event.id)}>
                        <input type="hidden" name="category" value={v.category} />
                        <input type="hidden" name="placeId" value={v.place_id} />
                        <button type="submit" className="text-xs text-ink-muted underline">
                          Remove from shortlist
                        </button>
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
