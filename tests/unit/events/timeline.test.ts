import { describe, expect, it } from "vitest";
import { fromDbError } from "@/lib/errors";
import { describeTimelineEntry, type TimelineEntry } from "@/modules/events/timeline";

const e = (
  entity_type: string,
  action: string,
  details: Record<string, unknown>,
): TimelineEntry => ({
  at: "2026-10-22T10:00:00Z",
  actor_kind: "user",
  actor_name: "Sara",
  entity_type,
  entity_id: "x",
  action,
  details,
});

describe("timeline sentences", () => {
  it("describes task, plan and compliance changes in plain language", () => {
    expect(
      describeTimelineEntry(e("tasks", "update", { title: "Book hall", from: "todo", to: "done" })),
    ).toBe("moved task “Book hall” from todo to done");
    expect(
      describeTimelineEntry(e("tasks", "update", { title: "Book hall", owner_changed: true })),
    ).toBe("changed the owner of “Book hall”");
    expect(describeTimelineEntry(e("ai_plans", "insert", { source: "playbook" }))).toMatch(/no AI/);
    expect(
      describeTimelineEntry(e("ai_suggestions", "update", { from: "proposed", to: "accepted" })),
    ).toBe("accepted a suggestion");
    expect(
      describeTimelineEntry(
        e("compliance_checks", "update", { title: "Permit", from: "under_review", to: "cleared" }),
      ),
    ).toBe("moved compliance check “Permit” from under review to cleared");
    expect(describeTimelineEntry(e("official_submissions", "insert", { simulated: true }))).toMatch(
      /simulated.*demonstration/,
    );
    expect(
      describeTimelineEntry(
        e("compliance_evidence", "insert", { kind: "submission_reference", simulated: true }),
      ),
    ).toBe("recorded simulated evidence (submission reference)");
  });
});

describe("database rule errors", () => {
  it("map to clear messages without leaking SQL", () => {
    const blocked = fromDbError({
      code: "23514",
      message: "task_blocked: finish or cancel its dependencies first",
    });
    expect(blocked.code).toBe("invalid_transition");
    expect(blocked.message).toMatch(/blocked/);
    expect(fromDbError({ code: "23514", message: "dependency_cycle" }).message).toMatch(/loop/);
    expect(fromDbError({ code: "42501", message: "reviewer_only: ..." }).code).toBe("forbidden");
    expect(fromDbError({ code: "23514", message: "evidence_required: ..." }).message).toMatch(
      /not a simulation/,
    );
    expect(fromDbError({ code: "23514", message: "invalid_transition: a -> b" }).code).toBe(
      "invalid_transition",
    );
  });
});
