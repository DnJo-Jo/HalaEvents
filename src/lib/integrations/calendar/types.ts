/**
 * Future calendar / messaging integration point (event.md §25). Interface only: no adapter exists
 * and nothing in the app calls it. Adding one means a new approval action type first (§10.1),
 * because publishing to a calendar or messaging channel is an outward-facing action.
 */
export interface CalendarEntry {
  title: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
}

export interface CalendarPublisher {
  readonly name: string;
  readonly isMock: boolean;
  /** Must only be called for an executed approval; returns the provider's own id. */
  publish(entry: CalendarEntry, idempotencyKey: string): Promise<{ providerEventId: string }>;
}
