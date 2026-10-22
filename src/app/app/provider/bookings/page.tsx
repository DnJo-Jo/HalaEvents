import type { Metadata } from "next";
import { BookingStatusBadge, BookingTerms } from "@/components/workspace/booking-card";
import { ActionForm } from "@/components/ui/action-form";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { providerBookingAction } from "@/modules/bookings/booking-actions";
import { BOOKING_LABELS } from "@/modules/bookings/booking-rules";
import { providerBookings } from "@/modules/bookings/booking-service";

export const metadata: Metadata = { title: "Bookings" };

export default async function ProviderBookingsPage() {
  const bookings = await providerBookings();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Bookings"
        description="Booking requests organizers sent you after approving your quote. Nothing is booked until you confirm. Venues can't confirm overlapping bookings."
      />
      {bookings.length === 0 ? (
        <EmptyState
          title="No bookings"
          description="Requests appear here when an organizer books one of your quotes."
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
                  <BookingTerms b={b} timeZone="Asia/Dubai" />
                  {b.organizer_note && <p>Organizer note: {b.organizer_note}</p>}
                  {b.providerActions.length > 0 && (
                    <ActionForm
                      action={providerBookingAction.bind(null, b.id)}
                      className="flex flex-wrap items-end gap-2 space-y-0"
                    >
                      <FormField label="Your answer">
                        <Select name="to" defaultValue={b.providerActions[0]}>
                          {b.providerActions.map((s) => (
                            <option key={s} value={s}>
                              {BOOKING_LABELS[s]}
                            </option>
                          ))}
                        </Select>
                      </FormField>
                      <FormField label="Reason (decline, cancel, dispute)">
                        <Input name="reason" maxLength={1000} />
                      </FormField>
                      <SubmitButton size="sm">Submit</SubmitButton>
                    </ActionForm>
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
