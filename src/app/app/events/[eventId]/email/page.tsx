import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { EmailDraft } from "@/components/email/email-draft";
import { Alert } from "@/components/ui/alert";
import { PageHeader } from "@/components/ui/page-header";
import { getEventForMember } from "@/modules/events/service";
import { draftTargets } from "@/modules/email/service";

export const metadata: Metadata = { title: "Draft an email" };

// Every read here is per-request (session, event data), so the route renders on demand.
export const instant = false;

export default async function EmailPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  const { event } = await getEventForMember(eventId);
  const targets = await draftTargets(eventId);

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}`} className="text-ink-muted hover:text-ink">
          ← {event.name}
        </Link>
      </nav>
      <PageHeader
        title="Draft an email to a vendor"
        description="Ask for a quotation using your event's details. Nothing is sent from HalaEvents: you review the message and send it from Gmail."
      />
      {!targets ? (
        <Alert tone="info" title="Organizers only">
          Email drafts are available to the event&apos;s owner and organizers.
        </Alert>
      ) : targets.categories.length === 0 ? (
        <Alert tone="info" title="No services selected">
          Choose the services you need (venue, catering, transportation) first.{" "}
          <Link className="underline" href={`/app/events/${event.id}/services`}>
            Select services
          </Link>
        </Alert>
      ) : (
        <EmailDraft eventId={event.id} targets={targets} />
      )}
    </div>
  );
}
