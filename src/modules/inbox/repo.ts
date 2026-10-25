import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import { ReplyAnalysis, ReplyRow } from "./schemas";
import type { GmailMessage } from "@/lib/integrations/gmail";
import type { RefTarget } from "./rules";

const COLUMNS =
  "id, category, place_id, reference, from_email, from_name, subject, body, received_at, analysis, analyzed_at";

export async function getConnection(db: SupabaseServerClient, userId: string) {
  const { data, error } = await db
    .from("gmail_connections")
    .select("email, refresh_token_enc")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data ? z.object({ email: z.string(), refresh_token_enc: z.string() }).parse(data) : null;
}

export async function saveConnection(
  db: SupabaseServerClient,
  userId: string,
  email: string,
  refreshTokenEnc: string,
) {
  const { error } = await db.from("gmail_connections").upsert({
    user_id: userId,
    email,
    refresh_token_enc: refreshTokenEnc,
    updated_at: new Date().toISOString(),
  });
  if (error) throw fromDbError(error);
}

export async function deleteConnection(db: SupabaseServerClient, userId: string) {
  const { error } = await db.from("gmail_connections").delete().eq("user_id", userId);
  if (error) throw fromDbError(error);
}

export async function listReplies(db: SupabaseServerClient, eventId: string) {
  const { data, error } = await db
    .from("vendor_replies")
    .select(COLUMNS)
    .eq("event_id", eventId)
    .order("received_at", { ascending: false });
  if (error) throw fromDbError(error);
  return z.array(ReplyRow).parse(data ?? []);
}

export async function existingMessageIds(db: SupabaseServerClient, eventId: string) {
  const { data, error } = await db
    .from("vendor_replies")
    .select("gmail_message_id")
    .eq("event_id", eventId);
  if (error) throw fromDbError(error);
  return new Set((data ?? []).map((r: { gmail_message_id: string }) => r.gmail_message_id));
}

export async function insertReply(
  db: SupabaseServerClient,
  eventId: string,
  m: GmailMessage,
  t: RefTarget & { reference: string },
) {
  const { error } = await db.from("vendor_replies").upsert(
    {
      event_id: eventId,
      category: t.category,
      place_id: t.placeId,
      reference: t.reference,
      gmail_message_id: m.id,
      from_email: m.fromEmail,
      from_name: m.fromName,
      subject: m.subject.slice(0, 500),
      body: m.body.slice(0, 20000),
      received_at: m.receivedAt,
    },
    { onConflict: "event_id,gmail_message_id", ignoreDuplicates: true },
  );
  if (error) throw fromDbError(error);
}

export async function getReply(db: SupabaseServerClient, eventId: string, replyId: string) {
  const { data, error } = await db
    .from("vendor_replies")
    .select(COLUMNS)
    .eq("event_id", eventId)
    .eq("id", replyId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data ? ReplyRow.parse(data) : null;
}

export async function saveAnalysis(
  db: SupabaseServerClient,
  eventId: string,
  replyId: string,
  analysis: ReplyAnalysis,
) {
  const { error } = await db
    .from("vendor_replies")
    .update({ analysis, analyzed_at: new Date().toISOString() })
    .eq("event_id", eventId)
    .eq("id", replyId);
  if (error) throw fromDbError(error);
}
