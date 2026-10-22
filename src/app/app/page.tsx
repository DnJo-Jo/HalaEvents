import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { visibleNav } from "@/components/shell/nav";
import { ACCOUNT_ROLE_LABELS } from "@/modules/profiles/schemas";
import { requireMember } from "@/modules/profiles/service";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const ctx = await requireMember();
  const { profile, roles, isAdmin } = ctx;
  const sections = visibleNav(ctx).filter((i) => i.href !== "/app");
  const isProvider = roles.includes("venue_provider") || roles.includes("service_provider");
  return (
    <div className="space-y-8">
      <PageHeader
        title={`Welcome, ${profile.display_name}`}
        description="Plan events, find verified providers and manage quotes. Task planning, attendees and messaging are still being built."
        badge={
          <span className="flex flex-wrap gap-1.5">
            {roles.map((r) => (
              <Badge key={r} tone="primary">
                {ACCOUNT_ROLE_LABELS[r].label}
              </Badge>
            ))}
          </span>
        }
      />

      <div className="flex flex-wrap gap-2">
        {roles.includes("organizer") && (
          <>
            <ButtonLink href="/app/events/new">Create an event</ButtonLink>
            <ButtonLink href="/app/marketplace" variant="secondary">
              Browse the marketplace
            </ButtonLink>
          </>
        )}
        {isProvider && (
          <>
            <ButtonLink href="/app/provider" variant="secondary">
              Manage your listings
            </ButtonLink>
            <ButtonLink href="/app/provider/requests" variant="secondary">
              Quote requests
            </ButtonLink>
          </>
        )}
        {isAdmin && (
          <ButtonLink href="/app/admin/providers" variant="secondary">
            Review providers
          </ButtonLink>
        )}
      </div>

      <section aria-labelledby="sections-heading" className="space-y-4">
        <h2 id="sections-heading" className="text-sm font-semibold text-ink-muted">
          Sections
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="group block h-full rounded-lg focus-visible:outline-offset-4"
              >
                <Card className="h-full transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-line-strong group-hover:shadow-md motion-reduce:transform-none">
                  <CardBody className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="flex size-9 items-center justify-center rounded-md bg-primary-soft text-primary">
                        <Icon path={item.icon} className="size-[1.1rem]" />
                      </span>
                      <Badge tone={item.phase === "live" ? "success" : "neutral"}>
                        {item.phase === "live" ? "Live" : item.phase}
                      </Badge>
                    </div>
                    <div>
                      <h3 className="font-semibold">{item.label}</h3>
                      <p className="mt-1 text-sm text-ink-muted">{item.summary}</p>
                    </div>
                  </CardBody>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
