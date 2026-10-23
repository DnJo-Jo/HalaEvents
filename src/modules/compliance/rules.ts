import type { Condition, Playbook, Question } from "@/modules/planning/playbook";
import { conditionHolds, formatAnswer, type Context } from "@/modules/events/interview-rules";
import type { ComplianceCategory, ComplianceItem, ComplianceStatus } from "./schemas";

/**
 * Compliance workflow rules (event.md §19). Pure and deterministic.
 *
 * - The transition table mirrors compliance_transition_allowed() in migration 0008.
 * - detectComplianceItems() turns the playbook's compliance topics and a few explicit concern rules
 *   into checks. A rule can only say "not assessed", "needs information" or "conditional": it never
 *   decides that something is legally required or cleared, and it never accuses anyone.
 */

export const COMPLIANCE_TRANSITIONS: Record<ComplianceStatus, readonly ComplianceStatus[]> = {
  not_assessed: [
    "needs_information",
    "conditional",
    "source_supported",
    "under_review",
    "action_required",
    "closed",
  ],
  needs_information: [
    "conditional",
    "source_supported",
    "under_review",
    "action_required",
    "closed",
  ],
  conditional: [
    "needs_information",
    "source_supported",
    "under_review",
    "action_required",
    "closed",
  ],
  source_supported: ["needs_information", "under_review", "action_required"],
  action_required: ["needs_information", "under_review", "awaiting_official_response"],
  under_review: [
    "needs_information",
    "action_required",
    "awaiting_official_response",
    "cleared",
    "rejected",
  ],
  awaiting_official_response: ["under_review", "action_required"],
  cleared: ["under_review"],
  rejected: ["under_review"],
  closed: ["under_review"],
};

export function canComplianceTransition(from: ComplianceStatus, to: ComplianceStatus): boolean {
  return COMPLIANCE_TRANSITIONS[from].includes(to);
}

/** Labels shown everywhere a status appears. "Cleared" always says "based on recorded evidence". */
export const COMPLIANCE_STATUS: Record<
  ComplianceStatus,
  {
    label: string;
    meaning: string;
    tone: "neutral" | "info" | "warning" | "success" | "danger" | "primary" | "accent";
  }
> = {
  not_assessed: {
    label: "Not assessed",
    meaning: "Nobody has looked at this yet.",
    tone: "neutral",
  },
  needs_information: {
    label: "Needs information",
    meaning: "An answer or detail is missing before this can be judged.",
    tone: "warning",
  },
  conditional: {
    label: "Conditional – needs confirmation",
    meaning: "May apply depending on details; confirm with the venue or authority.",
    tone: "info",
  },
  source_supported: {
    label: "Source-supported finding",
    meaning: "Linked to an official source a person has verified. Not a legal opinion.",
    tone: "primary",
  },
  under_review: {
    label: "Under human review",
    meaning: "The assigned reviewer is checking the evidence.",
    tone: "accent",
  },
  awaiting_official_response: {
    label: "Awaiting official response",
    meaning: "A submission was recorded; waiting for the authority.",
    tone: "info",
  },
  cleared: {
    label: "Cleared based on recorded evidence",
    meaning:
      "The reviewer cleared it on the evidence recorded here. HalaEvents did not verify it with any authority.",
    tone: "success",
  },
  action_required: {
    label: "Action required",
    meaning: "Something must be done before the event (see next action).",
    tone: "danger",
  },
  rejected: {
    label: "Rejected",
    meaning: "The reviewer decided the flag doesn't apply (reason recorded).",
    tone: "neutral",
  },
  closed: { label: "Closed", meaning: "No longer relevant (reason recorded).", tone: "neutral" },
};

export interface TransitionFacts {
  hasVerifiedReference: boolean;
  hasReviewer: boolean;
  callerIsReviewerOrAdmin: boolean;
  hasRealEvidence: boolean;
  hasSubmission: boolean;
}

export const REASON_REQUIRED: readonly ComplianceStatus[] = [
  "rejected",
  "closed",
  "action_required",
  "cleared",
];

/** Why a transition can't happen yet (empty = allowed). Same checks as set_compliance_status(). */
export function transitionBlockers(
  from: ComplianceStatus,
  to: ComplianceStatus,
  f: TransitionFacts,
): string[] {
  if (!canComplianceTransition(from, to))
    return [`Not possible from “${COMPLIANCE_STATUS[from].label}”.`];
  const out: string[] = [];
  if (to === "source_supported" && !f.hasVerifiedReference)
    out.push("Needs a referenced source that a person has verified.");
  if (to === "under_review" && !f.hasReviewer) out.push("Assign a reviewer first.");
  if ((to === "cleared" || to === "rejected") && !f.callerIsReviewerOrAdmin)
    out.push("Only the assigned reviewer or a platform admin decides.");
  if (to === "cleared" && !f.hasRealEvidence)
    out.push("Record real (not simulated) evidence first.");
  if (to === "awaiting_official_response" && !f.hasSubmission)
    out.push("Record the submission reference first.");
  return out;
}

// ------------------------------------------------------------------------------------------------
// Detection
// ------------------------------------------------------------------------------------------------

interface TopicMeta {
  category: ComplianceCategory;
  /** Curated knowledge_sources keys attached as references (starting points, not verification). */
  sourceKeys: string[];
  /** The knowledge source naming the official channel, when one is curated. */
  channel?: string;
  nextAction: string;
}

export const TOPIC_META: Record<string, TopicMeta> = {
  event_permit: {
    category: "permit",
    sourceKeys: [
      "det_event_permit",
      "det_epermits_register",
      "det_ticketed_events",
      "dda_event_permit",
    ],
    channel: "det_event_permit",
    nextAction:
      "Ask the venue whether it holds the permit; otherwise confirm with DET (or DDA for its free-zone areas) whether this event needs one.",
  },
  campus_event_policy: {
    category: "venue_policy",
    sourceKeys: [],
    nextAction: "Ask the university events office for its event policy and booking rules.",
  },
  minors_safeguarding: {
    category: "minors_safeguarding",
    sourceKeys: [],
    nextAction: "Agree consent, supervision and safeguarding rules with the participating schools.",
  },
  minors_overnight_supervision: {
    category: "minors_safeguarding",
    sourceKeys: [],
    nextAction:
      "Decide who supervises participants under 18 overnight, or end the event for them before night.",
  },
  food_safety: {
    category: "food_safety",
    sourceKeys: [],
    nextAction: "Ask caterers for their current food-handling approvals.",
  },
  photo_consent: {
    category: "privacy_media",
    sourceKeys: [],
    nextAction: "Choose how photo consent is collected and how people can opt out.",
  },
  prize_rules: {
    category: "prizes_finance",
    sourceKeys: [],
    nextAction: "Write prize terms and agree how prizes are paid or delivered.",
  },
};

const MINORS = ["school_students", "mixed"];
const undecided = (v: unknown) => v === undefined || v === null || v === "not_decided";

/** true / false, or "unknown" when the condition's key hasn't been answered (or the fact isn't set). */
function conditionState(c: Condition, ctx: Context): boolean | "unknown" {
  if (ctx[c.key] === undefined) return "unknown";
  return conditionHolds(c, ctx);
}

function describe(c: Condition, ctx: Context, questions: Map<string, Question>): string {
  const q = questions.get(c.key);
  const value = ctx[c.key];
  if (!q) return `${c.key.replace("event.", "event ").replace(/_/g, " ")}: ${String(value)}`;
  return `“${q.text}” → ${value === undefined ? "not answered" : formatAnswer(q, value ?? null)}`;
}

/**
 * Deterministic compliance checks for an event. Inputs are the playbook and the event/answer
 * context only. Output is a list of prompts to check, never a legal determination.
 */
export function detectComplianceItems(playbook: Playbook, ctx: Context): ComplianceItem[] {
  const questions = new Map(playbook.questions.map((q) => [q.key, q]));
  const items: ComplianceItem[] = [];

  for (const topic of playbook.complianceTopics) {
    const meta = TOPIC_META[topic.key] ?? {
      category: "other" as const,
      sourceKeys: [],
      nextAction: "Review this topic.",
    };
    const states = topic.when.map((c) => conditionState(c, ctx));
    if (states.includes(false)) continue;
    const unknown = topic.when.filter((_, i) => states[i] === "unknown");
    const base = {
      topicKey: topic.key,
      category: meta.category,
      title: topic.title,
      description: topic.description,
      nextAction: meta.nextAction,
      channelSourceKey: meta.channel,
      sourceKeys: meta.sourceKeys,
    };
    if (unknown.length) {
      items.push({
        ...base,
        reason:
          `We can't tell yet whether this applies: ${unknown.map((c) => describe(c, ctx, questions)).join("; ")}.`.slice(
            0,
            600,
          ),
        severity: "info",
        status: "needs_information",
        applicability: "unknown",
        nextAction: "Answer the planning interview questions listed in the reason.",
      });
      continue;
    }
    const because = topic.when.length
      ? `Flagged because ${topic.when.map((c) => describe(c, ctx, questions)).join("; ")}.`
      : "Applies to every event of this type.";
    items.push({
      ...base,
      reason: because.slice(0, 600),
      severity: "info",
      status: topic.confidence === "conditional" ? "conditional" : "not_assessed",
      applicability: "likely_applies",
    });
  }

  // Explicit concern rules: combinations that deserve attention before the event.
  const find = (key: string) => items.find((i) => i.topicKey === key);
  const minors = MINORS.includes(String(ctx["audience.level"]));

  const permit = find("event_permit");
  if (permit && permit.status === "conditional" && ctx["audience.level"] === "open_public") {
    permit.severity = "concern";
    permit.reason =
      `${permit.reason} The event is open to the public and not on campus, which is the kind of event official event-permit guidance is written for. This is a prompt to check, not a finding.`.slice(
        0,
        600,
      );
  }

  const safeguarding = find("minors_safeguarding");
  if (safeguarding && minors && undecided(ctx["audience.guardian_consent"])) {
    safeguarding.severity = "concern";
    safeguarding.status = "needs_information";
    safeguarding.reason =
      `${safeguarding.reason} Who collects guardian consent is not decided yet.`.slice(0, 600);
  }

  if (
    minors &&
    ctx["format.overnight"] === true &&
    undecided(ctx["format.overnight_supervision"])
  ) {
    items.push({
      topicKey: "minors_overnight_supervision",
      category: "minors_safeguarding",
      title: "Overnight supervision of participants under 18",
      description:
        "Participants under 18 may stay overnight, and nobody is named to supervise them.",
      reason: `Flagged because ${describe({ key: "audience.level", op: "in", values: MINORS }, ctx, questions)}; the event runs overnight; overnight supervision is ${ctx["format.overnight_supervision"] === undefined ? "not answered" : "not decided"}.`,
      severity: "concern",
      status: "needs_information",
      applicability: "applies",
      nextAction: TOPIC_META.minors_overnight_supervision.nextAction,
      sourceKeys: [],
    });
  }

  const photos = find("photo_consent");
  if (photos && undecided(ctx["media.consent"])) {
    photos.status = "needs_information";
    photos.severity = minors ? "concern" : "info";
    photos.reason =
      `${photos.reason} How consent is collected is not decided${minors ? ", and some participants may be under 18" : ""}.`.slice(
        0,
        600,
      );
  }

  return items;
}
