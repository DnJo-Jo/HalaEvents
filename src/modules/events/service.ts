import "server-only";
import { notFound } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";
import { requireMember } from "@/modules/profiles/service";
import * as repo from "./repo";
import type { EventFormInput, EventMemberRole } from "./schemas";

export async function listMyEvents() {
  const { user } = await requireMember();
  return repo.listMyEvents(await createSupabaseServerClient(), user.id);
}

/** The event plus the caller's role, or 404 when the caller is not a member. */
export async function getEventForMember(eventId: string) {
  const { user } = await requireMember();
  const db = await createSupabaseServerClient();
  const [event, role] = await Promise.all([
    repo.getEvent(db, eventId),
    repo.getRole(db, eventId, user.id),
  ]);
  if (!event || !role) notFound();
  return { event, role, canManage: role === "owner" || role === "organizer" };
}

export async function requireEventManager(eventId: string): Promise<EventMemberRole> {
  const { user } = await requireMember();
  const role = await repo.getRole(await createSupabaseServerClient(), eventId, user.id);
  if (role !== "owner" && role !== "organizer") {
    throw new AppError("forbidden", "Only the event's owner or organizers can do this.");
  }
  return role;
}

export async function createEvent(input: EventFormInput): Promise<string> {
  const { user, roles } = await requireMember();
  if (!roles.includes("organizer"))
    throw new AppError("forbidden", "Add the “Organizer” role in Settings first.");
  return repo.createEvent(await createSupabaseServerClient(), user.id, input);
}
