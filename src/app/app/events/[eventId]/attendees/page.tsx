import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  addAttendeeAction,
  participationAction,
  registrationSettingsAction,
  reviewAction,
  withdrawAction,
} from "@/modules/attendees/actions";
import { PARTICIPATION_LABELS, REVIEW_LABELS } from "@/modules/attendees/rules";
import type { ParticipationStatus } from "@/modules/attendees/schemas";
import { getAttendeeBoard } from "@/modules/attendees/service";

export const metadata: Metadata = { title: "Attendees" };

const PARTICIPATION_TONE: Record<ParticipationStatus, BadgeTone> = {
  pending: "neutral",
  accepted: "primary",
  waitlisted: "warning",
  rejected: "neutral",
  confirmed: "info",
  checked_in: "success",
  cancelled: "neutral",
};

export default async function AttendeesPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  const { event, canManage, canEdit, summary, settings, attendees } =
    await getAttendeeBoard(eventId);
  const placesLeft = summary ? summary.capacity - summary.taken : 0;

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}`} className="text-ink-muted hover:text-ink">
          ← {event.name}
        </Link>
      </nav>
      <PageHeader
        title="Attendees"
        description="Registration, application review and participation are tracked separately. Message delivery is on the Messages page and never changes these."
      />

      {summary && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            ["Places taken", `${summary.taken} / ${summary.capacity}`],
            ["Places left", String(Math.max(placesLeft, 0))],
            ["Waitlisted", String(summary.waitlisted)],
            ["Checked in", String(summary.checked_in)],
          ].map(([label, value]) => (
            <Card key={label}>
              <CardBody>
                <p className="text-xs text-ink-muted">{label}</p>
                <p className="text-2xl font-semibold tabular-nums">{value}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {!canManage && (
        <Alert tone="info" title="Counts only">
          Attendee names and contact details are visible to the event&apos;s owner and organizers
          only.
        </Alert>
      )}

      {canEdit && settings && (
        <Card>
          <CardHeader>
            <CardTitle>Public registration</CardTitle>
          </CardHeader>
          <CardBody className="space-y-3 text-sm">
            {settings.registration_open && settings.published_slug ? (
              <p>
                Registration page: <code>/register/{settings.published_slug}</code> (open while the
                event is planning or ready). Without application review, people get a place while
                places remain, then join the waitlist.
              </p>
            ) : (
              <p className="text-ink-muted">Registration is closed.</p>
            )}
            <ActionForm
              action={registrationSettingsAction.bind(null, event.id)}
              className="grid gap-4 sm:grid-cols-4"
              aria-label="Registration settings"
            >
              <FormField label="Registration">
                <Select
                  name="registrationOpen"
                  defaultValue={settings.registration_open ? "yes" : "no"}
                >
                  <option value="yes">Open</option>
                  <option value="no">Closed</option>
                </Select>
              </FormField>
              <FormField label="Application review">
                <Select
                  name="requiresApplication"
                  defaultValue={settings.requires_application ? "yes" : "no"}
                >
                  <option value="no">Not required</option>
                  <option value="yes">Required</option>
                </Select>
              </FormField>
              <FormField label="Page address">
                <Input
                  name="slug"
                  required
                  maxLength={80}
                  defaultValue={settings.published_slug ?? ""}
                  placeholder="campus-hack-2026"
                />
              </FormField>
              <div className="flex items-end">
                <SubmitButton size="sm" variant="secondary">
                  Save
                </SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      )}

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle>Add a person</CardTitle>
          </CardHeader>
          <CardBody>
            <ActionForm
              action={addAttendeeAction.bind(null, event.id)}
              resetOnSuccess
              className="grid gap-4 sm:grid-cols-5"
              labels={{ fullName: "Name", email: "Email" }}
            >
              <FormField label="Name" required>
                <Input name="fullName" required minLength={2} maxLength={120} />
              </FormField>
              <FormField label="Email" required>
                <Input name="email" type="email" required maxLength={254} />
              </FormField>
              <FormField label="Phone">
                <Input name="phone" type="tel" maxLength={20} />
              </FormField>
              <FormField label="Status">
                <Select name="registered" defaultValue="no">
                  <option value="no">Invited (send an invitation)</option>
                  <option value="yes">Registered (on their behalf)</option>
                </Select>
              </FormField>
              <div className="flex items-end">
                <SubmitButton size="sm">Add</SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      )}

      {canManage &&
        (attendees.length === 0 ? (
          <EmptyState title="Nobody yet" description="Open registration or add people by hand." />
        ) : (
          <ul className="space-y-3">
            {attendees.map((a) => {
              const available = a.participationOptions.filter((o) => o.blockers.length === 0);
              const blocked = a.participationOptions.filter((o) => o.blockers.length > 0);
              return (
                <li key={a.id}>
                  <Card>
                    <CardBody className="space-y-3 text-sm">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{a.full_name}</p>
                          <p className="text-ink-muted">
                            {a.email}
                            {a.phone ? ` · ${a.phone}` : ""}
                          </p>
                          {a.application_note && <p className="mt-1">“{a.application_note}”</p>}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge>Registration: {a.registration_status}</Badge>
                          <Badge
                            tone={a.review_status === "needs_information" ? "warning" : "neutral"}
                          >
                            {REVIEW_LABELS[a.review_status]}
                          </Badge>
                          <Badge tone={PARTICIPATION_TONE[a.participation_status]}>
                            {PARTICIPATION_LABELS[a.participation_status]}
                          </Badge>
                        </div>
                      </div>
                      {a.decision_reason && (
                        <p className="text-xs text-ink-muted">Note: {a.decision_reason}</p>
                      )}
                      {canEdit && a.registration_status !== "withdrawn" && (
                        <div className="grid gap-4 sm:grid-cols-3">
                          {a.reviewOptions.length > 0 && (
                            <ActionForm
                              action={reviewAction.bind(null, event.id, a.id)}
                              aria-label={`Application of ${a.full_name}`}
                            >
                              <FormField label="Application">
                                <Select name="status" defaultValue={a.reviewOptions[0]}>
                                  {a.reviewOptions.map((s) => (
                                    <option key={s} value={s}>
                                      {REVIEW_LABELS[s]}
                                    </option>
                                  ))}
                                </Select>
                              </FormField>
                              <FormField label="Note (e.g. what's missing)">
                                <Input name="reason" maxLength={500} />
                              </FormField>
                              <SubmitButton size="sm" variant="secondary">
                                Save review
                              </SubmitButton>
                            </ActionForm>
                          )}
                          {available.length > 0 && (
                            <ActionForm
                              action={participationAction.bind(null, event.id, a.id)}
                              aria-label={`Participation of ${a.full_name}`}
                            >
                              <FormField label="Participation">
                                <Select name="status" defaultValue={available[0].to}>
                                  {available.map((o) => (
                                    <option key={o.to} value={o.to}>
                                      {PARTICIPATION_LABELS[o.to]}
                                    </option>
                                  ))}
                                </Select>
                              </FormField>
                              <SubmitButton size="sm" variant="secondary">
                                Update
                              </SubmitButton>
                              {blocked.length > 0 && (
                                <p className="text-xs text-ink-muted">
                                  {blocked
                                    .map(
                                      (o) =>
                                        `${PARTICIPATION_LABELS[o.to]}: ${o.blockers.join(" ")}`,
                                    )
                                    .join(" · ")}
                                </p>
                              )}
                            </ActionForm>
                          )}
                          {a.participation_status !== "checked_in" && (
                            <ActionForm
                              action={withdrawAction.bind(null, event.id, a.id)}
                              aria-label={`Withdraw ${a.full_name}`}
                            >
                              <FormField label="Withdraw (on their request)">
                                <Input
                                  name="reason"
                                  maxLength={500}
                                  placeholder="Reason (optional)"
                                />
                              </FormField>
                              <SubmitButton size="sm" variant="ghost">
                                Withdraw registration
                              </SubmitButton>
                            </ActionForm>
                          )}
                        </div>
                      )}
                    </CardBody>
                  </Card>
                </li>
              );
            })}
          </ul>
        ))}
    </div>
  );
}
