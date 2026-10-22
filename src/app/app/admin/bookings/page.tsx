import type { Metadata } from "next";
import { BookingStatusBadge, BookingTerms } from "@/components/workspace/booking-card";
import { ActionForm } from "@/components/ui/action-form";
import { Card, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FormField } from "@/components/ui/form-field";
import { Input, Select } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SubmitButton } from "@/components/ui/submit-button";
import { resolveDisputeAction } from "@/modules/bookings/booking-actions";
import { BOOKING_LABELS } from "@/modules/bookings/booking-rules";
import { disputedBookings } from "@/modules/bookings/booking-service";

export const metadata: Metadata = { title: "Booking disputes" };

export default async function AdminBookingsPage() {
  const bookings = await disputedBookings();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Booking disputes"
        description="Resolve disputed bookings after hearing both sides. Record why."
      />
      {bookings.length === 0 ? (
        <EmptyState title="No open disputes" description="Disputed bookings appear here." />
      ) : (
        <ul className="space-y-4">
          {bookings.map((b) => (
            <li key={b.id}>
              <Card>
                <CardBody className="space-y-3 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{b.provider_name}</p>
                    <BookingStatusBadge status={b.status} />
                  </div>
                  <BookingTerms b={b} timeZone="Asia/Dubai" />
                  <ActionForm
                    action={resolveDisputeAction.bind(null, b.id)}
                    className="flex flex-wrap items-end gap-2 space-y-0"
                  >
                    <FormField label="Outcome">
                      <Select name="to" defaultValue="confirmed">
                        {(["confirmed", "completed", "cancelled"] as const).map((s) => (
                          <option key={s} value={s}>
                            {BOOKING_LABELS[s]}
                          </option>
                        ))}
                      </Select>
                    </FormField>
                    <FormField label="Reason">
                      <Input name="reason" required minLength={5} maxLength={1000} />
                    </FormField>
                    <SubmitButton size="sm">Resolve</SubmitButton>
                  </ActionForm>
                </CardBody>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
