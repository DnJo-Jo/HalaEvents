import type { EventStatus } from "./schemas";

/**
 * Event lifecycle (event.md §4). Mirrored by event_status_transition_allowed() in migration 0003;
 * tests/db/events.test.ts checks every pair against the database.
 */
export const EVENT_TRANSITIONS: Record<EventStatus, readonly EventStatus[]> = {
  draft: ["planning", "cancelled"],
  planning: ["ready", "cancelled"],
  ready: ["live", "planning", "cancelled"],
  live: ["completed"],
  completed: ["archived"],
  archived: [],
  cancelled: [],
};

export function canTransition(from: EventStatus, to: EventStatus): boolean {
  return EVENT_TRANSITIONS[from].includes(to);
}
