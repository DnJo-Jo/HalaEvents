import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";

export const NotificationKind = z.enum([
  "missing_information",
  "compliance_concern",
  "deadline_approaching",
  "decision_required",
  "compliance_status_changed",
]);
export type NotificationKind = z.infer<typeof NotificationKind>;

export const NotificationRow = z.object({
  id: z.string(),
  event_id: z.string().nullable(),
  kind: NotificationKind,
  title: z.string(),
  body: z.string(),
  link_path: z.string().nullable(),
  channel: z.literal("in_app"),
  delivery_status: z.enum(["delivered", "read"]),
  read_at: z.string().nullable(),
  created_at: z.string(),
});
export type NotificationRow = z.infer<typeof NotificationRow>;
const COLUMNS = Object.keys(NotificationRow.shape).join(", ");

/** RLS limits rows to the caller's own notifications. */
export async function listNotifications(db: SupabaseServerClient, userId: string) {
  const { data, error } = await db
    .from("notifications")
    .select(COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw fromDbError(error);
  return z
    .array(NotificationRow)
    .parse(data)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function markRead(db: SupabaseServerClient, ids: string[] | null): Promise<number> {
  const { data, error } = await db.rpc("mark_notifications_read", { p_ids: ids });
  if (error) throw fromDbError(error);
  return z.number().parse(data ?? 0);
}

export async function refreshEventNotifications(
  db: SupabaseServerClient,
  eventId: string,
  missing: { key: string; label: string }[],
): Promise<number> {
  const { data, error } = await db.rpc("refresh_event_notifications", {
    p_event_id: eventId,
    p_missing: missing.slice(0, 20),
  });
  if (error) throw fromDbError(error);
  return z.number().parse(data ?? 0);
}
