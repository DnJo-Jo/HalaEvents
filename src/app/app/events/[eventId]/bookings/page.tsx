import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { BookingStatusBadge, BookingTerms } from "@/components/workspace/booking-card";
import { ActionForm } from "@/components/ui/action-form";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import {
  executeBookingApprovalAction,
  organizerBookingAction,
  requestBookingApprovalAction,
  requestCancellationAction,
} from "@/modules/bookings/booking-actions";
import { BOOKING_LABELS } from "@/modules/bookings/booking-rules";
import { getEventBookings } from "@/modules/bookings/booking-service";
import { decideApprovalAction } from "@/modules/comms/actions";
import { APPROVAL_LABELS } from "@/modules/comms/rules";

export const metadata: Metadata = { title: "Bookings" };

export default async function BookingsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!z.uuid().safeParse(eventId).success) notFound();
  const { event, canManage, bookings } = await getEventBookings(eventId);

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="text-sm">
        <Link href={`/app/events/${event.id}`} className="text-ink-muted hover:text-ink">
          ← {event.name}
        </Link>
      </nav>
      <PageHeader
        title="Bookings"
        description="A quote isn't a booking. A booking request is approved first, then sent to the provider, and it is confirmed only when the provider confirms it. No payments are handled."
      />
      {!canManage ? (
        <Alert tone="info" title="Organizers only">
          Bookings are visible to the event&apos;s owner and organizers.
        </Alert>
      ) : bookings.length === 0 ? (
        <EmptyState
          title="No bookings"
          description="Propose a booking from a submitted quote on a service request."
        />
      ) : (
        <ul className="space-y-4">
          {bookings.map((b) => (
            <li key={b.id}>
              <Card>
                <CardBody className="space-y-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{b.provider_name}</p>
                    <BookingStatusBadge status={b.status} />
                  </div>
                  <BookingTerms b={b} timeZone={event.timezone} />

                  {b.approval && (
                    <div className="space-y-2 rounded border border-primary/40 p-3">
                      <p>
                        <span className="font-medium">
                          {b.approval.action_type === "cancel_booking"
                            ? "Cancellation"
                            : "Booking request"}{" "}
                          approval:
                        </span>{" "}
                        {APPROVAL_LABELS[b.approval.status]} · payload{" "}
                        {b.approval.payload_hash.slice(0, 12)}…
                      </p>
                      {b.approval.status === "pending" && (
                        <ActionForm
                          action={decideApprovalAction.bind(null, event.id, b.approval.id)}
                          className="flex flex-wrap items-end gap-2 space-y-0"
                        >
                          <FormField label="Decision">
                            <Select name="decision" defaultValue="approve">
                              <option value="approve">Approve these exact terms</option>
                              <option value="reject">Reject</option>
                            </Select>
                          </FormField>
                          <FormField label="Note">
                            <Input name="note" maxLength={500} />
                          </FormField>
                          <SubmitButton size="sm">Record decision</SubmitButton>
                        </ActionForm>
                      )}
                      {b.approval.status === "approved" && (
                        <ActionForm
                          action={executeBookingApprovalAction.bind(null, event.id, b.approval.id)}
                          className="space-y-0"
                        >
                          <SubmitButton size="sm">
                            {b.approval.action_type === "cancel_booking"
                              ? "Cancel the booking now"
                              : "Send the request to the provider"}
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-end gap-3">
                    {b.status === "proposed" && (
                      <ActionForm
                        action={requestBookingApprovalAction.bind(null, event.id, b.id)}
                        className="space-y-0"
                      >
                        <SubmitButton size="sm">Request approval</SubmitButton>
                      </ActionForm>
                    )}
                    {b.status === "confirmed" && !b.approval && (
                      <ActionForm
                        action={requestCancellationAction.bind(null, event.id, b.id)}
                        className="flex items-end gap-2 space-y-0"
                        labels={{ reason: "Reason" }}
                      >
                        <FormField label="Cancellation reason">
                          <Input name="reason" minLength={5} maxLength={1000} required />
                        </FormField>
                        <SubmitButton size="sm" variant="secondary">
                          Request cancellation approval
                        </SubmitButton>
                      </ActionForm>
                    )}
                    {b.organizerActions.length > 0 && (
                      <ActionForm
                        action={organizerBookingAction.bind(null, event.id, b.id)}
                        className="flex flex-wrap items-end gap-2 space-y-0"
                      >
                        <FormField label="Other action">
                          <Select name="to" defaultValue={b.organizerActions[0]}>
                            {b.organizerActions.map((s) => (
                              <option key={s} value={s}>
                                {BOOKING_LABELS[s]}
                              </option>
                            ))}
                          </Select>
                        </FormField>
                        <FormField label="Reason (cancel/dispute)">
                          <Input name="reason" maxLength={1000} />
                        </FormField>
                        <SubmitButton size="sm" variant="ghost">
                          Apply
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                  {b.status === "awaiting_provider" && (
                    <Badge tone="info">
                      Sent in-app to {b.provider_name}. Not confirmed until they confirm.
                    </Badge>
                  )}
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Data-dependent route behind the app shell Suspense; blocking navigation is intended. */
export const instant = false;
