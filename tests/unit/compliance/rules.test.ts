import { describe, expect, it } from "vitest";
import type { Context } from "@/modules/events/interview-rules";
import {
  canComplianceTransition,
  COMPLIANCE_STATUS,
  COMPLIANCE_TRANSITIONS,
  detectComplianceItems,
  transitionBlockers,
} from "@/modules/compliance/rules";
import { ComplianceItem, CreateCheckInput, EvidenceInput } from "@/modules/compliance/schemas";
import { playbookFor } from "@/playbooks";

const playbook = playbookFor("university_hackathon");
const base: Context = {
  "event.venue_type": "indoor",
  "event.capacity": 120,
  "event.duration_hours": 24,
};
const detect = (answers: Context) => detectComplianceItems(playbook, { ...base, ...answers });
const byKey = (items: ReturnType<typeof detect>, key: string) =>
  items.find((i) => i.topicKey === key);

describe("detection", () => {
  it("unanswered conditions → needs information, never a finding", () => {
    const items = detect({});
    const permit = byKey(items, "event_permit");
    expect(permit).toMatchObject({
      status: "needs_information",
      applicability: "unknown",
      severity: "info",
    });
    expect(permit?.reason).toMatch(/can't tell yet/);
    expect(permit?.reason).toMatch(/not answered/);
  });

  it("off-campus open-public event → conditional permit check flagged as a possible concern, with curated sources", () => {
    const permit = byKey(
      detect({ "venue.on_campus": false, "audience.level": "open_public" }),
      "event_permit",
    );
    expect(permit).toMatchObject({
      status: "conditional",
      severity: "concern",
      channelSourceKey: "det_event_permit",
    });
    expect(permit?.sourceKeys).toContain("dda_event_permit");
    expect(permit?.reason).toMatch(/not a finding/);
  });

  it("on-campus university event → no permit check, campus policy instead", () => {
    const items = detect({ "venue.on_campus": true, "audience.level": "university_students" });
    expect(byKey(items, "event_permit")).toBeUndefined();
    expect(byKey(items, "campus_event_policy")).toMatchObject({ status: "not_assessed" });
    expect(byKey(items, "minors_safeguarding")).toBeUndefined();
  });

  it("minors: undecided consent and overnight without supervision are concerns needing information", () => {
    const items = detect({
      "audience.level": "school_students",
      "audience.guardian_consent": "not_decided",
      "format.overnight": true,
    });
    expect(byKey(items, "minors_safeguarding")).toMatchObject({
      severity: "concern",
      status: "needs_information",
    });
    expect(byKey(items, "minors_overnight_supervision")).toMatchObject({
      severity: "concern",
      status: "needs_information",
    });
    const ok = detect({
      "audience.level": "school_students",
      "audience.guardian_consent": "school",
      "format.overnight": true,
      "format.overnight_supervision": "school_staff",
    });
    expect(byKey(ok, "minors_overnight_supervision")).toBeUndefined();
    expect(byKey(ok, "minors_safeguarding")?.severity).toBe("info");
  });

  it("photography without a consent decision needs information", () => {
    expect(byKey(detect({ "media.photography": true }), "photo_consent")).toMatchObject({
      status: "needs_information",
    });
    expect(
      byKey(
        detect({ "media.photography": true, "media.consent": "separate_form" }),
        "photo_consent",
      ),
    ).toMatchObject({
      status: "not_assessed",
    });
  });

  it("rules only ever produce automatic states, and every item passes the RPC schema", () => {
    const all = [
      detect({}),
      detect({
        "venue.on_campus": false,
        "audience.level": "mixed",
        "format.overnight": true,
        "catering.provided": true,
        "media.photography": true,
        "prizes.offered": true,
      }),
    ].flat();
    for (const i of all) {
      expect(["not_assessed", "needs_information", "conditional"]).toContain(i.status);
      expect(ComplianceItem.safeParse(i).success).toBe(true);
      expect(i.reason).not.toMatch(/illegal|unlawful|violat/i);
    }
  });
});

describe("transitions and blockers", () => {
  const none = {
    hasVerifiedReference: false,
    hasReviewer: false,
    callerIsReviewerOrAdmin: false,
    hasRealEvidence: false,
    hasSubmission: false,
  };

  it("nothing jumps straight to cleared", () => {
    for (const from of Object.keys(
      COMPLIANCE_TRANSITIONS,
    ) as (keyof typeof COMPLIANCE_TRANSITIONS)[]) {
      if (from !== "under_review") expect(canComplianceTransition(from, "cleared")).toBe(false);
    }
  });

  it("explains missing evidence, reviewer, verified source and submission", () => {
    expect(transitionBlockers("conditional", "source_supported", none)).toEqual([
      "Needs a referenced source that a person has verified.",
    ]);
    expect(transitionBlockers("conditional", "under_review", none)).toEqual([
      "Assign a reviewer first.",
    ]);
    expect(transitionBlockers("under_review", "cleared", none)).toHaveLength(2);
    expect(
      transitionBlockers("under_review", "cleared", {
        ...none,
        callerIsReviewerOrAdmin: true,
        hasRealEvidence: true,
      }),
    ).toEqual([]);
    expect(transitionBlockers("action_required", "awaiting_official_response", none)).toEqual([
      "Record the submission reference first.",
    ]);
    expect(transitionBlockers("not_assessed", "cleared", none)[0]).toMatch(/Not possible/);
  });

  it("the cleared label never claims official verification", () => {
    expect(COMPLIANCE_STATUS.cleared.label).toBe("Cleared based on recorded evidence");
    expect(COMPLIANCE_STATUS.cleared.meaning).toMatch(/did not verify/);
  });
});

describe("inputs", () => {
  it("organizer checks get a custom.* key; links must be https", () => {
    expect(
      CreateCheckInput.parse({
        title: "Drone footage!",
        category: "privacy_media",
        reason: "Sponsor asked",
      }).topicKey,
    ).toBe("custom.drone_footage");
    expect(
      CreateCheckInput.parse({ title: "123 rule", category: "other", reason: "Why not" }).topicKey,
    ).toBe("custom.c_123_rule");
    expect(EvidenceInput.safeParse({ kind: "link", value: "http://example.com" }).success).toBe(
      false,
    );
    expect(
      EvidenceInput.safeParse({ kind: "link", value: "https://example.com/letter" }).success,
    ).toBe(true);
    expect(EvidenceInput.safeParse({ kind: "note", value: "ab" }).success).toBe(false);
  });
});
