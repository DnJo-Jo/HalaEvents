import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { CapacityLabel, ListingBadges, PriceLabel } from "@/components/marketplace/badges";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { listMyEvents } from "@/modules/events/service";
import { addToShortlistAction } from "@/modules/marketplace/actions";
import { getListing } from "@/modules/marketplace/service";
import { getProviderRatings } from "@/modules/reviews/service";
import { RatingSummaryView, Stars, VerifiedBadge } from "@/components/reviews/rating";
import { reportAction } from "@/modules/reviews/actions";
import { formatDate } from "@/lib/dates";
import {
  ACCESSIBILITY_LABELS,
  CATEGORY_LABELS,
  SUITABILITY_LABELS,
  indicativePrice,
} from "@/modules/profiles/labels";

export const metadata: Metadata = { title: "Provider" };

export default async function ProviderDetailPage({
  params,
}: {
  params: Promise<{ providerId: string }>;
}) {
  const { providerId } = await params;
  if (!z.uuid().safeParse(providerId).success) notFound();
  const [{ provider: p, venue, services, isOwnListing, shortlistedIn }, events, ratings] =
    await Promise.all([getListing(providerId), listMyEvents(), getProviderRatings(providerId)]);
  const manageable = events.filter(
    (e) =>
      (e.member_role === "owner" || e.member_role === "organizer") &&
      !["completed", "archived", "cancelled"].includes(e.status),
  );
  const canRequest =
    !p.is_demo &&
    p.verification_status === "verified" &&
    p.moderation_status === "active" &&
    p.is_listed;

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href="/app/marketplace" className="text-ink-muted hover:text-ink">
          ← Marketplace
        </Link>
      </nav>
      <PageHeader
        title={p.name}
        description={`${CATEGORY_LABELS[p.category]}${p.city ? ` · ${p.city}` : ""}`}
        badge={<ListingBadges p={p} />}
      />
      {isOwnListing && (
        <Alert tone="info" title="This is your listing">
          Manage it from{" "}
          <Link href={`/app/provider/${p.id}`} className="font-medium underline">
            My business
          </Link>
          .
        </Alert>
      )}
      {p.is_demo && (
        <Alert tone="warning" title="Demo listing">
          This provider is fictional sample data. You can shortlist it to try the workflow, but it
          can&rsquo;t receive requests or send quotes.
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-6">
          <Card>
            <CardBody className="space-y-4">
              {p.description && (
                <p className="text-sm whitespace-pre-line text-ink">{p.description}</p>
              )}
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <Fact label="Indicative price">
                  <PriceLabel
                    model={p.pricing_model}
                    min={p.price_min}
                    max={p.price_max}
                    currency={p.currency}
                  />
                </Fact>
                <Fact label="Capacity">
                  <CapacityLabel min={p.min_capacity} max={p.max_capacity} />{" "}
                  {p.min_capacity === null && p.max_capacity === null && "Not stated"}
                </Fact>
                <Fact label="Service area">
                  {p.service_area.length ? p.service_area.join(", ") : "Not stated"}
                </Fact>
                {p.website && (
                  <Fact label="Website">
                    <a
                      href={p.website}
                      rel="noopener noreferrer nofollow"
                      target="_blank"
                      className="text-primary underline"
                    >
                      {new URL(p.website).hostname}
                    </a>
                  </Fact>
                )}
              </dl>
              <div className="rounded-md border border-line bg-surface-muted p-3 text-sm">
                <p className="font-medium">Availability (as stated by the provider)</p>
                <p className="mt-1 text-ink-muted">
                  {p.availability_note ?? "No availability statement."} This is not a live calendar
                  — only a quote and, later, a confirmed booking reflect real availability.
                </p>
              </div>
              {p.capabilities.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold">
                    {p.kind === "venue" ? "Facilities" : "Capabilities"}
                  </h2>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {p.capabilities.map((c) => (
                      <li key={c}>
                        <Badge>{c}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>

          {venue && (
            <Card>
              <CardHeader>
                <CardTitle>Venue details</CardTitle>
              </CardHeader>
              <CardBody>
                <dl className="grid gap-4 text-sm sm:grid-cols-2">
                  <Fact label="Setting">{venue.setting}</Fact>
                  <Fact label="Seated / standing">
                    {venue.seated_capacity ?? "—"} / {venue.standing_capacity ?? "—"}
                  </Fact>
                  <Fact label="Area">{venue.area ?? "Not stated"}</Fact>
                  <Fact label="Address">{venue.address_text ?? "Not stated"}</Fact>
                  <Fact label="Suitable for">
                    {venue.suitability.map((s) => SUITABILITY_LABELS[s] ?? s).join(", ") ||
                      "Not stated"}
                  </Fact>
                  <Fact label="Accessibility">
                    {venue.accessibility.map((a) => ACCESSIBILITY_LABELS[a] ?? a).join(", ") ||
                      "Not stated"}
                  </Fact>
                </dl>
                {venue.access_conditions && (
                  <p className="mt-4 text-sm">
                    <span className="font-medium">Access conditions: </span>
                    <span className="text-ink-muted">{venue.access_conditions}</span>
                  </p>
                )}
              </CardBody>
            </Card>
          )}

          <section aria-labelledby="services-heading" className="space-y-3">
            <h2 id="services-heading" className="text-lg font-semibold">
              Services
            </h2>
            {services.length === 0 ? (
              <p className="text-sm text-ink-muted">No individual services listed.</p>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2">
                {services.map((s) => (
                  <li key={s.id}>
                    <Card className="h-full">
                      <CardBody className="space-y-2">
                        <p className="text-xs font-semibold text-accent">
                          {CATEGORY_LABELS[s.category]}
                        </p>
                        <h3 className="font-semibold">{s.title}</h3>
                        {s.description && <p className="text-sm text-ink-muted">{s.description}</p>}
                        <p className="text-sm">
                          {indicativePrice(s.pricing_model, s.price_from, s.price_to, s.currency)}
                        </p>
                        {s.inclusions.length > 0 && (
                          <p className="text-xs text-ink-muted">
                            Includes: {s.inclusions.join(", ")}
                          </p>
                        )}
                      </CardBody>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Reviews</CardTitle>
              <CardDescription>
                From organizers after a completed booking on HalaEvents. Hidden reviews are not
                counted.
              </CardDescription>
            </CardHeader>
            <CardBody className="space-y-3">
              {ratings ? (
                <>
                  <RatingSummaryView summary={ratings.summary} />
                  <ul className="space-y-3">
                    {ratings.reviews.map((r) => (
                      <li key={r.id} className="space-y-1 border-t border-line pt-2 text-sm">
                        <p>
                          <Stars rating={r.rating} /> {r.verified && <VerifiedBadge />}
                        </p>
                        <p className="whitespace-pre-wrap">{r.body}</p>
                        <p className="text-xs text-ink-muted">
                          {r.reviewer_name} · {formatDate(r.created_at)}
                        </p>
                        {r.response_body && (
                          <p className="rounded bg-surface-muted p-2 text-xs">
                            <span className="font-medium">Provider response:</span>{" "}
                            {r.response_body}
                          </p>
                        )}
                        {!isOwnListing && (
                          <details>
                            <summary className="cursor-pointer text-xs text-primary">
                              Report this review
                            </summary>
                            <ActionForm action={reportAction.bind(null, r.id)} className="mt-2">
                              <input type="hidden" name="kind" value="report" />
                              <input type="hidden" name="reason" value="inaccurate" />
                              <FormField label="What is wrong?">
                                <Input name="details" required minLength={5} maxLength={1000} />
                              </FormField>
                              <SubmitButton size="sm" variant="secondary">
                                Send report
                              </SubmitButton>
                            </ActionForm>
                          </details>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-sm text-ink-muted">
                  Reviews aren&rsquo;t shown for this listing.
                </p>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Shortlist for an event</CardTitle>
              <CardDescription>
                Keep track of providers you&rsquo;re considering. Nothing is sent to them.
              </CardDescription>
            </CardHeader>
            <CardBody>
              {manageable.length === 0 ? (
                <NoEventHint />
              ) : (
                <ActionForm
                  action={addToShortlistAction}
                  labels={{ eventId: "Event", note: "Note" }}
                >
                  <input type="hidden" name="providerId" value={p.id} />
                  <FormField label="Event">
                    <Select name="eventId" defaultValue={manageable[0].id}>
                      {manageable.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                          {shortlistedIn.includes(e.id) ? " (already shortlisted)" : ""}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <FormField label="Note" hint="Optional, visible to your event team.">
                    <Input name="note" maxLength={500} />
                  </FormField>
                  <SubmitButton variant="secondary" className="w-full">
                    Add to shortlist
                  </SubmitButton>
                </ActionForm>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Request a quote</CardTitle>
              <CardDescription>
                Describe what you need for a specific event. A quote is not a booking.
              </CardDescription>
            </CardHeader>
            <CardBody>
              {!canRequest ? (
                <p className="text-sm text-ink-muted">
                  {p.is_demo
                    ? "Demo listings can't receive requests."
                    : "This provider isn't accepting requests right now."}
                </p>
              ) : manageable.length === 0 ? (
                <NoEventHint />
              ) : (
                <form method="get" action="/app/requests/new" className="space-y-3">
                  <input type="hidden" name="provider" value={p.id} />
                  <FormField label="For event">
                    <Select name="event" defaultValue={manageable[0].id}>
                      {manageable.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </Select>
                  </FormField>
                  <Button type="submit" className="w-full">
                    Continue
                  </Button>
                </form>
              )}
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function NoEventHint() {
  return (
    <p className="text-sm text-ink-muted">
      You need an event you organize first.{" "}
      <Link href="/app/events/new" className="font-medium text-primary underline">
        Create an event
      </Link>
    </p>
  );
}

/** Data-dependent route behind the app shell Suspense; blocking navigation is intended. */
export const instant = false;
