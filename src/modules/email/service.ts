import "server-only";
import { aiSetup, generateJson, type AiSetup } from "@/lib/ai/gateway";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";
import { inputHash } from "@/lib/input-hash";
import { allowRequest } from "@/lib/rate-limit";
import { formatAnswer } from "@/modules/events/interview-rules";
import { EVENT_TYPE_LABELS, EventType } from "@/modules/events/schemas";
import { getEventForMember, planningContext } from "@/modules/events/service";
import { localDate } from "@/modules/planning/rules";
import { getCurrentPlan } from "@/modules/planning/repo";
import { requireMember } from "@/modules/profiles/service";
import { gmailConfig } from "@/lib/integrations/gmail";
import * as inboxRepo from "@/modules/inbox/repo";
import * as vendorsRepo from "@/modules/vendors/repo";
import { SERVICE_LABELS } from "@/modules/vendors/schemas";
import { EMAIL_PROMPT_VERSION, buildEmailPrompt, isRelevant } from "./prompt";
import {
  assembleBody,
  bodyProblems,
  emailReference,
  emailSubject,
  templateBody,
  type EmailFacts,
} from "./rules";
import { AiEmailBody, DraftRequestInput, type DraftResult, type EmailDraft } from "./schemas";

/**
 * Vendor quotation-request drafts. Reads the event's persisted data with the caller's own session,
 * optionally asks the AI gateway for the body (one request per explicit click, never retried), and
 * falls back to a labelled template. Nothing is stored or sent: the organizer edits the draft and
 * sends it from their own mail account.
 */

const BURST = { limit: 3, windowMs: 60_000 };
const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX = 100;
/** Accepted model bodies by input hash, so an identical request never calls the model twice. */
const cache = new Map<string, { body: string; at: number }>();

function configuredAi(): AiSetup | null {
  try {
    return aiSetup();
  } catch {
    return null;
  }
}

/** Whether a custom (AI-written) draft can be offered. No request is made. */
export function customDraftAvailable(): boolean {
  return configuredAi() !== null;
}

const dateRange = (start: string, end: string, tz: string) => {
  const fmt = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(new Date(iso));
  return localDate(start, tz) === localDate(end, tz) ? fmt(start) : `${fmt(start)} – ${fmt(end)}`;
};

export async function draftVendorEmail(
  eventId: string,
  raw: unknown,
  mode: "custom" | "template",
): Promise<DraftResult> {
  const parsed = DraftRequestInput.safeParse(raw);
  if (!parsed.success)
    return {
      ok: false,
      message: "Choose a service to write to.",
      fieldErrors: { category: ["Choose a service."] },
    };
  const { category, placeId } = parsed.data;

  const { user, profile } = await requireMember();
  const { event, canManage } = await getEventForMember(eventId);
  if (!canManage)
    throw new AppError("forbidden", "Only the event's owner or organizers can draft emails.");

  const db = await createSupabaseServerClient();
  const [shortlist, ctx, plan] = await Promise.all([
    vendorsRepo.listShortlist(db, eventId),
    planningContext(db, event),
    getCurrentPlan(db, eventId),
  ]);
  const vendor = placeId
    ? shortlist.find((v) => v.place_id === placeId && v.category === category)
    : null;
  if (placeId && !vendor)
    return {
      ok: false,
      message: "That vendor isn't on this event's shortlist.",
      fieldErrors: { vendor: ["Choose a shortlisted vendor."] },
    };

  const facts: EmailFacts = {
    eventName: event.name,
    eventTypeLabel: EVENT_TYPE_LABELS[EventType.parse(event.event_type)],
    dateText: dateRange(event.starts_at, event.ends_at, event.timezone),
    timeZone: event.timezone,
    city: event.city,
    attendees: event.capacity,
    requirements: ctx.state.answered
      .filter((a) => a.value !== null)
      .filter((a) => isRelevant(category, `${a.question.key} ${a.question.text}`))
      .slice(0, 8)
      .map(
        (a) =>
          `${a.question.text.replace(/\?$/, "")}: ${formatAnswer(a.question, a.value).slice(0, 120)}`,
      ),
    planNotes: (plan?.plan.overview?.requirements ?? [])
      .filter((r) => isRelevant(category, r))
      .slice(0, 5),
    additionalDetails: event.additional_details,
    category,
    vendorName: vendor?.name ?? null,
    vendorAddress: vendor?.address ?? null,
    organizerName: profile.display_name?.trim() || null,
    reference: emailReference(eventId, category, vendor?.place_id),
  };

  const base = {
    to: "",
    subject: emailSubject(facts),
    reference: facts.reference,
    vendorName: facts.vendorName,
    category,
  };
  const template = (notice?: string): DraftResult => ({
    ok: true,
    draft: {
      ...base,
      body: assembleBody(facts, templateBody(facts)),
      source: "template",
      ...(notice ? { notice } : {}),
    },
  });

  if (mode === "template") return template();
  const setup = configuredAi();
  if (!setup)
    return template("A custom draft isn't available right now, so this is a template draft.");

  const prompt = buildEmailPrompt(facts);
  const key = inputHash({
    user: user.id,
    v: EMAIL_PROMPT_VERSION,
    m: setup.provider.model,
    p: prompt,
  });
  const now = Date.now();
  const hit = cache.get(key);
  const custom = (body: string): DraftResult => ({
    ok: true,
    draft: { ...base, body: assembleBody(facts, body), source: "custom" } satisfies EmailDraft,
  });
  if (hit && now - hit.at < CACHE_TTL_MS) return custom(hit.body);

  if (!allowRequest(`email-draft:${user.id}`, BURST.limit, BURST.windowMs))
    return template(
      "Please wait a minute before asking for another custom draft. This is a template draft.",
    );

  const result = await generateJson(setup, {
    ...prompt,
    schema: AiEmailBody,
    check: (v) => bodyProblems(v.body, facts),
    temperature: 0.3,
  });
  if (!result.ok)
    return template("A custom draft couldn't be written this time, so this is a template draft.");

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { body: result.data.body, at: now });
  return custom(result.data.body);
}

/** The categories the organizer can write to, with their shortlisted vendors. */
export async function draftTargets(eventId: string) {
  const { event, canManage } = await getEventForMember(eventId);
  if (!canManage) return null;
  const db = await createSupabaseServerClient();
  const { user } = await requireMember();
  const cfg = gmailConfig();
  const [shortlist, connection] = await Promise.all([
    vendorsRepo.listShortlist(db, eventId),
    cfg ? inboxRepo.getConnection(db, user.id).catch(() => null) : null,
  ]);
  const categories = [
    ...new Set([...event.services, ...shortlist.map((v) => v.category)]),
  ] as (keyof typeof SERVICE_LABELS)[];
  return {
    categories: categories.map((c) => ({ value: c, label: SERVICE_LABELS[c] })),
    vendors: shortlist.map((v) => ({ placeId: v.place_id, name: v.name, category: v.category })),
    customAvailable: customDraftAvailable(),
    /** The organizer's connected Gmail address: the account "Open in Gmail" composes from. */
    organizerEmail: connection?.email ?? null,
    /** Single-vendor prototype: prefilled in To, still editable. */
    vendorEmail: cfg?.demoVendorEmail ?? null,
  };
}
