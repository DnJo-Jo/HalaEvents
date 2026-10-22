import type { Metadata } from "next";
import Link from "next/link";
import { Stars, RatingSummaryView, VerifiedBadge } from "@/components/reviews/rating";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { formatDate } from "@/lib/dates";
import { reportAction, respondAction, submitReviewAction } from "@/modules/reviews/actions";
import { ELIGIBILITY_REASONS, REASON_LABELS } from "@/modules/reviews/rules";
import { getReviewsHub } from "@/modules/reviews/service";

export const metadata: Metadata = { title: "Reviews" };

export default async function ReviewsPage() {
  const v = await getReviewsHub();
  const open = v.candidates.filter((c) => c.eligible);
  const closed = v.candidates.filter((c) => !c.eligible);
  const hasProviderSide = v.candidates.some((c) => c.side === "provider");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Reviews"
        description="Review a provider or organizer after a completed booking. Every review is tied to a booking recorded on HalaEvents."
      />
      {hasProviderSide && !v.providerReviewsEnabled && (
        <Alert tone="info" title="Provider reviews of organizers are off">
          The platform doesn&apos;t let providers review organizers yet. You can still respond to
          reviews written about you.
        </Alert>
      )}

      <section aria-labelledby="write" className="space-y-3">
        <h2 id="write" className="text-lg font-semibold">
          Ready to review
        </h2>
        {open.length === 0 ? (
          <EmptyState
            title="Nothing to review right now"
            description="Completed bookings you can review show up here. A booking is completed by the organizer after the service period ends."
          />
        ) : (
          <ul className="space-y-3">
            {open.map((c) => (
              <li key={`${c.booking_id}-${c.side}`}>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {c.side === "organizer"
                        ? `Review ${c.provider_name}`
                        : `Review the organizer of ${c.event_name}`}
                    </CardTitle>
                  </CardHeader>
                  <CardBody className="space-y-3 text-sm">
                    <p className="text-xs text-ink-muted">
                      {c.event_name} · {c.provider_name} · service ended {formatDate(c.service_to)}{" "}
                      <VerifiedBadge />
                    </p>
                    <ActionForm
                      action={submitReviewAction}
                      labels={{ rating: "Rating", body: "Feedback" }}
                    >
                      <input type="hidden" name="bookingId" value={c.booking_id} />
                      <input
                        type="hidden"
                        name="direction"
                        value={
                          c.side === "organizer" ? "organizer_to_provider" : "provider_to_organizer"
                        }
                      />
                      <FormField label="Rating" required>
                        <Select name="rating" defaultValue="" required>
                          <option value="" disabled>
                            Choose…
                          </option>
                          {[5, 4, 3, 2, 1].map((n) => (
                            <option key={n} value={n}>
                              {n} — {["", "Poor", "Fair", "Good", "Very good", "Excellent"][n]}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField
                        label="Feedback"
                        required
                        hint="Describe what happened. One review per booking; it can't be edited, only responded to."
                      >
                        <Textarea name="body" required minLength={10} maxLength={2000} rows={4} />
                      </FormField>
                      <SubmitButton>Publish review</SubmitButton>
                    </ActionForm>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}
        {closed.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-primary">
              Completed bookings you can&apos;t review ({closed.length})
            </summary>
            <ul className="mt-2 space-y-1 text-ink-muted">
              {closed.map((c) => (
                <li key={`${c.booking_id}-${c.side}`}>
                  {c.event_name} · {c.provider_name} ({c.side}):{" "}
                  {ELIGIBILITY_REASONS[c.reason ?? ""] ?? "Not eligible."}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {v.organizerRating && v.organizerRating.count > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>How providers rated you as an organizer</CardTitle>
          </CardHeader>
          <CardBody>
            <RatingSummaryView summary={v.organizerRating} />
          </CardBody>
        </Card>
      )}

      <section aria-labelledby="mine" className="space-y-3">
        <h2 id="mine" className="text-lg font-semibold">
          Reviews you wrote or received
        </h2>
        {v.reviews.length === 0 ? (
          <p className="text-sm text-ink-muted">None yet.</p>
        ) : (
          <ul className="space-y-3">
            {v.reviews.map((r) => (
              <li key={r.id}>
                <Card>
                  <CardBody className="space-y-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-medium">
                        <Stars rating={r.rating} />{" "}
                        {r.direction === "organizer_to_provider"
                          ? `Review of ${r.provider_name}`
                          : `Review of the organizer of ${r.event_name}`}
                      </p>
                      <div className="flex gap-1.5">
                        <Badge>{r.side === "reviewer" ? "You wrote this" : "About you"}</Badge>
                        {r.status === "hidden" ? (
                          <Badge tone="danger">Hidden by moderators</Badge>
                        ) : (
                          <Badge tone="success">Published</Badge>
                        )}
                        <VerifiedBadge />
                      </div>
                    </div>
                    <p className="whitespace-pre-wrap">{r.body}</p>
                    <p className="text-xs text-ink-muted">
                      {r.event_name} · {formatDate(r.created_at)}
                    </p>
                    {r.status === "hidden" && r.moderation_note && (
                      <p className="text-xs text-ink-muted">Moderator note: {r.moderation_note}</p>
                    )}
                    {r.response_body && (
                      <div className="rounded border border-line p-2">
                        <p className="text-xs font-medium">
                          Response ({r.response_at ? formatDate(r.response_at) : ""})
                        </p>
                        <p className="whitespace-pre-wrap">{r.response_body}</p>
                      </div>
                    )}
                    {r.side === "reviewee" && !r.response_body && (
                      <details>
                        <summary className="cursor-pointer text-primary">Respond publicly</summary>
                        <ActionForm action={respondAction.bind(null, r.id)} className="mt-2">
                          <FormField label="Your response" hint="One response per review.">
                            <Textarea
                              name="body"
                              required
                              minLength={10}
                              maxLength={1500}
                              rows={3}
                            />
                          </FormField>
                          <SubmitButton size="sm">Publish response</SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                    {r.side === "reviewee" && !r.my_report_kinds.includes("dispute") && (
                      <details>
                        <summary className="cursor-pointer text-primary">
                          Dispute this review
                        </summary>
                        <ActionForm action={reportAction.bind(null, r.id)} className="mt-2">
                          <input type="hidden" name="kind" value="dispute" />
                          <FormField label="What is wrong?">
                            <Select name="reason" defaultValue="inaccurate">
                              {Object.entries(REASON_LABELS).map(([k, label]) => (
                                <option key={k} value={k}>
                                  {label}
                                </option>
                              ))}
                            </Select>
                          </FormField>
                          <FormField label="Details" required>
                            <Input name="details" required minLength={5} maxLength={1000} />
                          </FormField>
                          <SubmitButton size="sm" variant="secondary">
                            Send dispute to moderators
                          </SubmitButton>
                        </ActionForm>
                      </details>
                    )}
                    {r.my_report_kinds.includes("dispute") && (
                      <p className="text-xs text-ink-muted">You disputed this review.</p>
                    )}
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-ink-muted">
        Public ratings count only published reviews of bookings that are still completed.{" "}
        <Link href="/app/marketplace" className="underline">
          See them in the marketplace
        </Link>
        .
      </p>
    </div>
  );
}
