import type { Metadata } from "next";
import Link from "next/link";
import {
  PROVIDER_FIELD_LABELS,
  ProviderProfileFields,
} from "@/components/marketplace/provider-profile-fields";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { createProviderAction } from "@/modules/profiles/providers-actions";
import { requireMember } from "@/modules/profiles/service";

export const metadata: Metadata = { title: "New listing" };

export default async function NewProviderPage() {
  const { roles } = await requireMember();
  const venue = roles.includes("venue_provider");
  const service = roles.includes("service_provider");
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/app/provider" className="text-ink-muted hover:text-ink">
          ← My business
        </Link>
      </nav>
      <PageHeader
        title="New listing"
        description="Start as a draft. Add services and credentials next, then submit it for verification."
      />
      {!venue && !service ? (
        <Alert tone="warning" title="Provider role needed">
          Add the Venue provider or Service provider role in{" "}
          <Link href="/app/settings" className="underline">
            Settings
          </Link>
          .
        </Alert>
      ) : (
        <Card>
          <CardBody>
            <ActionForm action={createProviderAction} labels={PROVIDER_FIELD_LABELS}>
              <ProviderProfileFields
                kind={venue && service ? undefined : venue ? "venue" : "service"}
              />
              <SubmitButton>Create draft listing</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
