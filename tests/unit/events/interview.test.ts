import { describe, expect, it } from "vitest";
import { PlaybookSchema, type Playbook } from "@/modules/planning/playbook";
import {
  ROUND_SIZE,
  conditionHolds,
  eventContext,
  formatAnswer,
  interviewEditable,
  interviewState,
  parseAnswer,
  parseSubmission,
  type Answers,
} from "@/modules/events/interview-rules";
import { EventStatus } from "@/modules/events/schemas";
import { playbookFor } from "@/playbooks";
import universityHackathon from "../../../playbooks/university-hackathon.json";

const playbook = playbookFor("university_hackathon");
const event = (over: Partial<Parameters<typeof eventContext>[0]> = {}) =>
  eventContext({
    venue_type: "indoor",
    capacity: 120,
    starts_at: "2026-12-01T05:00:00Z",
    ends_at: "2026-12-02T14:00:00Z", // 33 h
    city: "Dubai",
    budget_amount: null,
    ...over,
  });
const keys = (qs: { key: string }[]) => qs.map((q) => q.key);
const question = (key: string) => playbook.questions.find((q) => q.key === key)!;

/** Answers every applicable question with the first option / minimum, until complete. */
function answerAll(ctx: ReturnType<typeof event>, overrides: Answers = {}): Answers {
  let stored: Answers = {};
  for (let i = 0; i < 20; i++) {
    const { next } = interviewState(playbook, ctx, stored);
    if (next.length === 0) return stored;
    for (const q of next) {
      stored[q.key] =
        q.key in overrides
          ? overrides[q.key]
          : q.type === "boolean"
            ? true
            : q.type === "number"
              ? q.min
              : q.type === "text"
                ? "Zoom"
                : q.type === "multi_choice"
                  ? [q.options[0].value]
                  : q.options[0].value;
    }
    stored = { ...stored };
  }
  throw new Error("interview never completed");
}

describe("playbook", () => {
  it("the university hackathon playbook is valid", () => {
    expect(PlaybookSchema.safeParse(universityHackathon).success).toBe(true);
    expect(playbook.questions.length).toBeGreaterThan(10);
  });

  const base = {
    id: "test",
    version: 1,
    eventType: "university_hackathon",
    title: "Test",
    summary: "A test playbook used by the unit tests.",
  } as const;
  const bool = (key: string, when: unknown[] = []) => ({
    key,
    type: "boolean",
    required: true,
    text: `Question ${key}?`,
    why: "Because it matters.",
    when,
  });
  const issues = (p: unknown) =>
    PlaybookSchema.safeParse(p).error?.issues.map((i) => i.message) ?? [];

  it("rejects duplicate keys", () => {
    expect(issues({ ...base, questions: [bool("a.one"), bool("a.one")] })).toContain(
      "Duplicate key a.one",
    );
  });

  it("rejects conditions on later or unknown questions (no cycles, no dangling refs)", () => {
    expect(
      issues({
        ...base,
        questions: [bool("a.one", [{ key: "a.two", op: "equals", value: true }]), bool("a.two")],
      }),
    ).toContain("a.two is not an earlier question");
  });

  it("rejects condition values that the referenced question can't produce", () => {
    expect(
      issues({
        ...base,
        questions: [bool("a.one"), bool("a.two", [{ key: "a.one", op: "equals", value: "yes" }])],
      }),
    ).toContain("Condition value doesn't fit a.one");
  });

  it("rejects unknown event facts and malformed keys", () => {
    expect(
      issues({
        ...base,
        questions: [bool("a.one", [{ key: "event.secret", op: "equals", value: 1 }])],
      }),
    ).toContain("event.secret is not a known event fact");
    expect(issues({ ...base, questions: [bool("event.capacity")] })).toContain(
      "event.* keys are reserved",
    );
    expect(PlaybookSchema.safeParse({ ...base, questions: [bool("NoDots")] }).success).toBe(false);
  });
});

describe("conditions", () => {
  const ctx = { a: "x", n: 5, list: ["p"], skipped: null };
  it("evaluates each operator; unanswered never matches", () => {
    expect(conditionHolds({ key: "a", op: "equals", value: "x" }, ctx)).toBe(true);
    expect(conditionHolds({ key: "a", op: "in", values: ["y", "x"] }, ctx)).toBe(true);
    expect(conditionHolds({ key: "a", op: "not_in", values: ["x"] }, ctx)).toBe(false);
    expect(conditionHolds({ key: "skipped", op: "not_in", values: ["x"] }, ctx)).toBe(true);
    expect(conditionHolds({ key: "list", op: "includes", value: "p" }, ctx)).toBe(true);
    expect(conditionHolds({ key: "n", op: "gte", value: 5 }, ctx)).toBe(true);
    expect(conditionHolds({ key: "n", op: "gte", value: 6 }, ctx)).toBe(false);
    for (const op of ["equals", "in", "not_in", "includes", "gte"] as const) {
      const c = (
        op === "in" || op === "not_in"
          ? { key: "missing", op, values: ["x"] }
          : { key: "missing", op, value: op === "gte" ? 1 : "x" }
      ) as Parameters<typeof conditionHolds>[0];
      expect(conditionHolds(c, ctx), op).toBe(false);
    }
  });

  it("derives event facts from the event row", () => {
    expect(event()).toEqual({
      "event.venue_type": "indoor",
      "event.capacity": 120,
      "event.duration_hours": 33,
      "event.city": "Dubai",
      "event.budget_amount": null,
    });
  });
});

describe("interview rounds", () => {
  it("round 1 is deterministic, at most ROUND_SIZE questions, starting with the audience", () => {
    const a = interviewState(playbook, event(), {});
    const b = interviewState(playbook, event(), {});
    expect(keys(a.next)).toEqual(keys(b.next));
    expect(a.next.length).toBe(ROUND_SIZE);
    expect(a.next[0].key).toBe("audience.level");
    expect(a.complete).toBe(false);
  });

  it("school students ⇒ age and guardian-consent questions follow", () => {
    const state = interviewState(playbook, event(), { "audience.level": "school_students" });
    expect(keys(state.next)).toContain("audience.min_age");
    expect(keys(state.next)).toContain("audience.guardian_consent");
  });

  it("university students ⇒ no age or guardian questions, but an external-participants question", () => {
    const all = answerAll(event(), { "audience.level": "university_students" });
    expect(all).not.toHaveProperty("audience.min_age");
    expect(all).not.toHaveProperty("audience.guardian_consent");
    expect(all).toHaveProperty("audience.multi_institution");
  });

  it("asks about overnight stays only for events of 12 hours or more", () => {
    const short = answerAll(event({ ends_at: "2026-12-01T13:00:00Z" })); // 8 h
    const long = answerAll(event());
    expect(short).not.toHaveProperty("format.overnight");
    expect(long).toHaveProperty("format.overnight");
  });

  it("minors overnight ⇒ supervision question; adults overnight ⇒ none", () => {
    const minors = answerAll(event(), { "audience.level": "school_students" });
    const adults = answerAll(event(), { "audience.level": "university_students" });
    expect(minors).toHaveProperty("format.overnight_supervision");
    expect(adults).not.toHaveProperty("format.overnight_supervision");
  });

  it("online events skip campus questions and ask for the platform; an undecided venue still asks", () => {
    const online = answerAll(event({ venue_type: "online" }));
    expect(online).not.toHaveProperty("venue.on_campus");
    expect(online).toHaveProperty("online.platform");
    expect(answerAll(event({ venue_type: null }))).toHaveProperty("venue.on_campus");
  });

  it("completes once every applicable question is answered", () => {
    const state = interviewState(playbook, event(), answerAll(event()));
    expect(state.complete).toBe(true);
    expect(state.next).toEqual([]);
    expect(state.stale).toEqual([]);
  });

  it("changing a parent answer hides its whole dependent chain and marks those answers stale", () => {
    const all = answerAll(event(), { "audience.level": "school_students" });
    const changed = { ...all, "audience.level": "university_students" };
    const state = interviewState(playbook, event(), changed);
    expect(state.stale).toEqual(
      expect.arrayContaining([
        "audience.min_age",
        "audience.guardian_consent",
        "format.overnight_supervision",
      ]),
    );
    expect(keys(state.answered.map((a) => a.question))).not.toContain("audience.min_age");
  });

  it("never marks AI follow-up (custom.*) answers or unknown keys as live playbook answers", () => {
    const state = interviewState(playbook, event(), { "custom.parking": "yes", "old.key": true });
    expect(state.stale).toEqual(["old.key"]);
  });
});

describe("answer validation", () => {
  it("parses each question type from form values", () => {
    expect(parseAnswer(question("audience.level"), ["school_students"])).toEqual({
      ok: true,
      value: "school_students",
    });
    expect(parseAnswer(question("catering.provided"), ["no"])).toEqual({ ok: true, value: false });
    expect(parseAnswer(question("format.team_size"), ["4"])).toEqual({ ok: true, value: 4 });
    expect(parseAnswer(question("catering.dietary"), ["halal", "vegan", "halal"])).toEqual({
      ok: true,
      value: ["halal", "vegan"],
    });
    expect(parseAnswer(question("online.platform"), ["  Teams  "])).toEqual({
      ok: true,
      value: "Teams",
    });
  });

  it("rejects unknown options, out-of-range numbers, fractions and over-long text", () => {
    expect(parseAnswer(question("audience.level"), ["aliens"]).ok).toBe(false);
    expect(parseAnswer(question("catering.dietary"), ["halal", "bacon"]).ok).toBe(false);
    expect(parseAnswer(question("catering.provided"), ["maybe"]).ok).toBe(false);
    expect(parseAnswer(question("format.team_size"), ["11"]).ok).toBe(false);
    expect(parseAnswer(question("format.team_size"), ["2.5"]).ok).toBe(false);
    expect(parseAnswer(question("format.team_size"), ["four"]).ok).toBe(false);
    expect(parseAnswer(question("online.platform"), ["x".repeat(121)]).ok).toBe(false);
    expect(parseAnswer(question("audience.level"), "not-an-array").ok).toBe(false);
    expect(parseAnswer(question("audience.level"), Array(21).fill("mixed")).ok).toBe(false);
  });

  it("requires required answers; blank optional answers are stored as skipped (null)", () => {
    expect(parseAnswer(question("audience.level"), [])).toEqual({
      ok: false,
      message: "Answer this question.",
    });
    expect(parseAnswer(question("format.team_size"), ["  "]).ok).toBe(false);
    expect(parseAnswer(question("catering.dietary"), [])).toEqual({ ok: true, value: null });
    expect(parseAnswer(question("online.platform"), undefined)).toEqual({ ok: true, value: null });
  });
});

describe("round submission", () => {
  const round1 = keys(interviewState(playbook, event(), {}).next);
  const fullRound1 = {
    round: round1,
    "audience.level": ["school_students"],
    "format.team_size": ["4"],
    "format.overnight": ["yes"],
    "venue.on_campus": ["no"],
    "catering.provided": ["yes"],
  };

  it("accepts a valid round", () => {
    const r = parseSubmission(playbook, event(), {}, fullRound1);
    expect(r).toEqual({
      ok: true,
      answers: {
        "audience.level": "school_students",
        "format.team_size": 4,
        "format.overnight": true,
        "venue.on_campus": false,
        "catering.provided": true,
      },
      removeKeys: [],
    });
  });

  it("returns an error per invalid question", () => {
    const r = parseSubmission(
      playbook,
      event(),
      {},
      {
        ...fullRound1,
        "audience.level": [],
        "format.team_size": ["99"],
      },
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.fieldErrors).sort()).toEqual(["audience.level", "format.team_size"]);
  });

  it("refuses rounds listing unknown or no questions (stale or forged form)", () => {
    for (const round of [undefined, [], ["custom.injected"], ["audience.level", "nope.key"]]) {
      const r = parseSubmission(playbook, event(), {}, { ...fullRound1, round });
      expect(r.ok, JSON.stringify(round)).toBe(false);
    }
  });

  it("ignores values for questions that aren't in the round or don't apply", () => {
    const r = parseSubmission(
      playbook,
      event(),
      {},
      {
        ...fullRound1,
        "audience.level": ["university_students"],
        "audience.min_age": ["10"], // not in the round and not applicable
        "media.consent": ["separate_form"], // not in the round
      },
    );
    expect(r.ok && Object.keys(r.answers)).not.toContain("audience.min_age");
    expect(r.ok && Object.keys(r.answers)).not.toContain("media.consent");
  });

  it("changing a parent in the same submission removes dependent answers", () => {
    const stored = answerAll(event(), { "audience.level": "school_students" });
    const shown = keys(interviewState(playbook, event(), stored).answered.map((a) => a.question));
    const raw: Record<string, unknown> = { round: shown };
    for (const k of shown) {
      const v = stored[k];
      raw[k] = Array.isArray(v) ? v : [typeof v === "boolean" ? (v ? "yes" : "no") : String(v)];
    }
    raw["audience.level"] = ["university_students"];
    const r = parseSubmission(playbook, event(), stored, raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.answers).not.toHaveProperty("audience.min_age");
    expect(r.removeKeys).toEqual(
      expect.arrayContaining(["audience.min_age", "audience.guardian_consent"]),
    );
    expect(Object.keys(r.answers).filter((k) => r.removeKeys.includes(k))).toEqual([]);
  });
});

describe("display and editability", () => {
  it("formats answers with option labels and units", () => {
    expect(formatAnswer(question("audience.level"), "mixed")).toBe(
      "Mixed: school and university students",
    );
    expect(formatAnswer(question("format.team_size"), 4)).toBe("4 people");
    expect(formatAnswer(question("catering.provided"), false)).toBe("No");
    expect(formatAnswer(question("catering.dietary"), ["halal", "vegan"])).toBe("Halal, Vegan");
    expect(formatAnswer(question("catering.dietary"), null)).toBe("Skipped");
  });

  it("answers are editable only while the event is being planned", () => {
    const editable = EventStatus.options.filter(interviewEditable);
    expect(editable).toEqual(["draft", "planning", "ready"]);
  });

  it("a playbook with no applicable questions is immediately complete", () => {
    const p: Playbook = {
      ...playbook,
      questions: [
        {
          ...question("format.overnight"),
          when: [{ key: "event.duration_hours", op: "gte", value: 1000 }],
        },
      ],
    };
    expect(interviewState(p, event(), {}).complete).toBe(true);
  });
});
