import type { Metadata } from "next";
import Link from "next/link";
import { ListingBadges } from "@/components/marketplace/badges";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { CATEGORY_LABELS } from "@/modules/profiles/labels";
import { listMyProviders } from "@/modules/profiles/providers-service";
import { requireMember } from "@/modules/profiles/service";

export const metadata: Metadata = { title: "My business" };

export default async function MyBusinessPage() {
  const [{ roles }, providers] = await Promise.all([requireMember(), listMyProviders()]);
  const isProvider = roles.includes("venue_provider") || roles.includes("service_provider");
  return (
    <div className="space-y-6">
      <PageHeader
        title="My business"
        description="Your listings. Organizers only see a listing after the HalaEvents team verifies it."
        actions={
          isProvider ? (
            <div className="flex gap-2">
              <ButtonLink href="/app/provider/requests" variant="secondary">
                Quote requests
              </ButtonLink>
              <ButtonLink href="/app/provider/new">New listing</ButtonLink>
            </div>
          ) : undefined
        }
      />
      {!isProvider && (
        <Alert tone="info" title="Provider role needed">
          Add the Venue provider or Service provider role in{" "}
          <Link href="/app/settings" className="underline">
            Settings
          </Link>{" "}
          to create listings.
        </Alert>
      )}
      {providers.length === 0 ? (
        isProvider && (
          <EmptyState
            title="No listings yet"
            description="Create a business profile, add services and credentials, then submit it for verification."
            action={<ButtonLink href="/app/provider/new">Create a listing</ButtonLink>}
          />
        )
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {providers.map((p) => (
            <li key={p.id}>
              <Link href={`/app/provider/${p.id}`} className="group block h-full rounded-lg">
                <Card className="h-full transition-shadow group-hover:shadow-md">
                  <CardBody className="space-y-2">
                    <p className="text-xs font-semibold text-accent">
                      {CATEGORY_LABELS[p.category]}
                    </p>
                    <h2 className="font-semibold group-hover:text-primary">{p.name}</h2>
                    <p className="text-xs text-ink-muted">Your role: {p.member_role}</p>
                    <ListingBadges p={p} />
                  </CardBody>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
