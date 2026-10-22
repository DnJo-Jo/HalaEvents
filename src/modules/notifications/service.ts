import "server-only";
import { createSupabaseServerClient } from "@/lib/db/server";
import { missingInformation } from "@/modules/ai/rules";
import * as eventsRepo from "@/modules/events/repo";
import { planningContext } from "@/modules/events/service";
import { requireMember } from "@/modules/profiles/service";
import * as repo from "./repo";

/**
 * In-app notifications (event.md §18.5). Rows are created by database triggers (plans, compliance)
 * and by refreshReminders() (deadlines, missing information). There is no scheduler and no
 * email/push channel: "delivered" means stored in the recipient's in-app inbox.
 */

export async function listMyNotifications() {
  const { user } = await requireMember();
  return repo.listNotifications(await createSupabaseServerClient(), user.id);
}

export async function markNotificationsRead(ids: string[] | null): Promise<number> {
  await requireMember();
  return repo.markRead(await createSupabaseServerClient(), ids);
}

/**
 * Creates deadline and missing-information reminders for an event (idempotent: each reminder has a
 * dedupe key). Called after organizers change tasks, answers or compliance checks, and from the
 * workspace's "Check reminders" button. The RPC re-checks that the caller manages the event.
 */
export async function refreshReminders(eventId: string): Promise<number> {
  await requireMember();
  const db = await createSupabaseServerClient();
  const event = await eventsRepo.getEvent(db, eventId);
  if (!event) return 0;
  const { playbook, ctx } = await planningContext(db, event);
  const missing = missingInformation(playbook, ctx);
  return repo.refreshEventNotifications(db, eventId, missing);
}
