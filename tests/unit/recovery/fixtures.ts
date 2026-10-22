import type { Impact } from "@/modules/recovery/schemas";

export const IDS = {
  venueBooking: "b0000000-0000-4000-8000-000000000001",
  venueProvider: "c0000000-0000-4000-8000-000000000001",
  catererBooking: "b0000000-0000-4000-8000-000000000002",
  catererProvider: "c0000000-0000-4000-8000-000000000002",
  altProvider: "c0000000-0000-4000-8000-000000000003",
  taskHall: "a0000000-0000-4000-8000-000000000001",
  taskSignage: "a0000000-0000-4000-8000-000000000002",
  taskDone: "a0000000-0000-4000-8000-000000000003",
  taskMenu: "a0000000-0000-4000-8000-000000000004",
  check: "d0000000-0000-4000-8000-000000000001",
};
/** Today in the fixtures; the event starts 30 days later. */
export const TODAY = "2026-11-01";
export const EVENT_DAY = "2026-12-01";

export function makeImpact(over: Partial<Impact> = {}): Impact {
  return {
    version: 1,
    event: {
      name: "Campus Hack",
      status: "planning",
      starts_at: "2026-12-01T05:00:00Z",
      ends_at: "2026-12-02T05:00:00Z",
      timezone: "Asia/Dubai",
      city: "Dubai",
      capacity: 100,
      budget_amount: 20000,
      currency: "AED",
    },
    venue: {
      booking_id: IDS.venueBooking,
      provider_id: IDS.venueProvider,
      provider_name: "Original Hall",
      status: "confirmed",
      amount: 9000,
      currency: "AED",
      conditions: "Deposit 30%",
      service_from: "2026-12-01T05:00:00Z",
      service_to: "2026-12-02T05:00:00Z",
      confirmed_at: "2026-10-20T10:00:00Z",
    },
    plan_tasks: [
      {
        id: IDS.taskHall,
        title: "Finalize hall layout",
        category: "venue",
        status: "todo",
        priority: "high",
        due_date: "2026-11-03",
      },
      {
        id: IDS.taskSignage,
        title: "Print venue signage",
        category: "logistics",
        status: "in_progress",
        priority: "medium",
        due_date: "2026-11-20",
      },
      {
        id: IDS.taskDone,
        title: "Collect floor plan",
        category: "venue",
        status: "done",
        priority: "low",
        due_date: "2026-10-25",
      },
      {
        id: IDS.taskMenu,
        title: "Confirm lunch menu",
        category: "catering",
        status: "todo",
        priority: "medium",
        due_date: "2026-11-10",
      },
    ],
    affected_tasks: [
      {
        id: IDS.taskHall,
        title: "Finalize hall layout",
        category: "venue",
        status: "todo",
        priority: "high",
        due_date: "2026-11-03",
        reason: "venue_task",
      },
      {
        id: IDS.taskSignage,
        title: "Print venue signage",
        category: "logistics",
        status: "in_progress",
        priority: "medium",
        due_date: "2026-11-20",
        reason: "depends_on_venue_work",
      },
      {
        id: IDS.taskDone,
        title: "Collect floor plan",
        category: "venue",
        status: "done",
        priority: "low",
        due_date: "2026-10-25",
        reason: "venue_task",
      },
    ],
    services: [
      {
        booking_id: IDS.catererBooking,
        provider_id: IDS.catererProvider,
        provider_name: "Test Kitchen",
        category: "catering",
        status: "confirmed",
        amount: 4000,
        currency: "AED",
        conditions: null,
        service_from: "2026-12-01T05:00:00Z",
        service_to: "2026-12-02T05:00:00Z",
      },
    ],
    compliance: [
      {
        id: IDS.check,
        title: "Event permit",
        category: "permit",
        status: "under_review",
        topic_key: "event_permit",
        reason: "Unresolved and may depend on the venue.",
      },
    ],
    candidates: [
      {
        provider_id: IDS.altProvider,
        name: "Alternative Hall",
        city: "Dubai",
        min_capacity: 10,
        max_capacity: 500,
        price_min: 5000,
        price_max: 12000,
        currency: "AED",
        quote: {
          quote_id: "q1",
          amount: 10500,
          currency: "AED",
          valid_until: "2026-11-30T00:00:00Z",
          conditions: null,
        },
        availability: "unknown",
      },
    ],
    ...over,
  };
}
