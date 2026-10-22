import { describe, expect, it } from "vitest";
import {
  budgetView,
  buildChanges,
  buildInquiries,
  deterministicProposal,
  validateProposal,
} from "@/modules/recovery/rules";
import { RecoveryProposal } from "@/modules/recovery/schemas";
import { EVENT_DAY, IDS, TODAY, makeImpact } from "./fixtures";

const impact = makeImpact();
const good = () => deterministicProposal(impact, TODAY);
const errorsFor = (over: Partial<RecoveryProposal>, i = impact) =>
  validateProposal({ ...good(), ...over }, i, TODAY);

describe("the offline (mock) proposal", () => {
  it("passes the schema and every business rule", () => {
    for (const i of [impact, makeImpact({ candidates: [], services: [], compliance: [] })]) {
      const p = deterministicProposal(i, TODAY);
      expect(RecoveryProposal.safeParse(p).success).toBe(true);
      expect(validateProposal(p, i, TODAY)).toEqual([]);
    }
  });

  it("only moves open tasks that are due soon, inside the planning window", () => {
    const p = good();
    expect(p.taskChanges.map((c) => c.taskId)).toEqual([IDS.taskHall]);
    for (const c of p.taskChanges)
      expect(c.newDueDate >= TODAY && c.newDueDate <= EVENT_DAY).toBe(true);
  });

  it("never names a candidate venue to attendees and never claims availability", () => {
    const p = good();
    expect(p.attendeeUpdate.body).not.toMatch(/Alternative Hall/);
    expect(p.options.every((o) => !/\bis available\b/i.test(o.description))).toBe(true);
  });

  it("clamps dates when the event is close", () => {
    const soon = makeImpact({ event: { ...impact.event, starts_at: "2026-11-03T05:00:00Z" } });
    const p = deterministicProposal(soon, TODAY);
    expect(validateProposal(p, soon, TODAY)).toEqual([]);
    expect(p.timeline.every((t) => t.date <= "2026-11-03")).toBe(true);
  });
});

describe("invalid model proposals are rejected with a reason the model can repair", () => {
  it("unknown, finished or duplicated tasks and out-of-window dates", () => {
    const change = (taskId: string, newDueDate = "2026-11-10") => ({
      taskId,
      newDueDate,
      reason: "Needs a venue first.",
    });
    expect(errorsFor({ taskChanges: [change(IDS.taskMenu)] }).join()).toMatch(
      /isn't one of the affected tasks/,
    );
    expect(errorsFor({ taskChanges: [change("not-an-id")] }).join()).toMatch(
      /isn't one of the affected tasks/,
    );
    expect(errorsFor({ taskChanges: [change(IDS.taskDone)] }).join()).toMatch(
      /is done and can't be rescheduled/,
    );
    expect(errorsFor({ taskChanges: [change(IDS.taskHall), change(IDS.taskHall)] }).join()).toMatch(
      /changed twice/,
    );
    expect(errorsFor({ taskChanges: [change(IDS.taskHall, "2026-10-01")] }).join()).toMatch(
      /must be between/,
    );
    expect(errorsFor({ taskChanges: [change(IDS.taskHall, "2026-12-20")] }).join()).toMatch(
      /must be between/,
    );
  });

  it("options: duplicate keys, unknown recommendation, invented or repeated candidates", () => {
    const o = good().options[0];
    expect(errorsFor({ options: [o, { ...o }] }).join()).toMatch(/used twice/);
    expect(errorsFor({ recommendedOptionKey: "nonexistent" }).join()).toMatch(
      /doesn't match any option/,
    );
    expect(
      errorsFor({
        options: [{ ...o, candidateProviderId: "c0000000-0000-4000-8000-0000000000ff" }],
        recommendedOptionKey: o.key,
      }).join(),
    ).toMatch(/isn't in the candidate list/);
    expect(
      errorsFor({
        options: [
          { ...o, key: "a_one" },
          { ...o, key: "b_two" },
        ],
        recommendedOptionKey: "a_one",
      }).join(),
    ).toMatch(/same candidate/);
  });

  it("new tasks that duplicate the plan or fall outside the window", () => {
    const t = {
      title: "Confirm lunch menu",
      description: "Already exists in plan",
      category: "catering" as const,
      priority: "low" as const,
      dueDate: "2026-11-05",
    };
    expect(errorsFor({ newTasks: [t] }).join()).toMatch(/already exists/);
    expect(
      errorsFor({ newTasks: [{ ...t, title: "Brand new task", dueDate: "2027-01-01" }] }).join(),
    ).toMatch(/must be between/);
  });

  it("review notes about things outside the incident", () => {
    const n = {
      entityType: "booking" as const,
      entityId: IDS.venueBooking,
      reason: "Not a service.",
    };
    expect(errorsFor({ reviewNotes: [n] }).join()).toMatch(/isn't part of this incident/);
    expect(
      errorsFor({ reviewNotes: [{ ...n, entityType: "task", entityId: IDS.taskMenu }] }).join(),
    ).toMatch(/isn't part of this incident/);
  });

  it("inquiries to the wrong party for their purpose", () => {
    const q = (over: object) => ({
      providerId: IDS.altProvider,
      bookingId: "",
      purpose: "replacement_venue_availability" as const,
      subject: "Availability inquiry",
      body: "Could you tell us whether the dates are free for us?",
      ...over,
    });
    expect(errorsFor({ providerInquiries: [q({})] })).toEqual([]);
    expect(
      errorsFor({ providerInquiries: [q({ providerId: IDS.catererProvider })] }).join(),
    ).toMatch(/candidate list/);
    expect(
      errorsFor({ providerInquiries: [q({ purpose: "venue_cancellation_terms" })] }).join(),
    ).toMatch(/original venue only/);
    expect(
      errorsFor({
        providerInquiries: [
          q({
            purpose: "service_reconfirmation",
            providerId: IDS.catererProvider,
            bookingId: IDS.venueBooking,
          }),
        ],
      }).join(),
    ).toMatch(/provider and booking id/);
    expect(errorsFor({ providerInquiries: [q({}), q({})] }).join()).toMatch(/duplicate/);
  });
});

describe("the text may not invent availability, consent, clearance or prices", () => {
  const withSummary = (summary: string) =>
    errorsFor({ summary: `${summary} This is a practice scenario.` }).join();

  it.each([
    "Alternative Hall is available on the event dates.",
    "The replacement venue is confirmed for 1 December.",
    "The booking has been secured with the new hall.",
    "The hall has agreed to hold the dates.",
    "Your event permit carries over to the new venue.",
    "The permit has been approved for the new location.",
  ])("rejects: %s", (claim) => {
    expect(withSummary(claim)).toMatch(/don't state/);
  });

  it.each([
    "Please confirm whether the hall is available on the event dates.",
    "Is the replacement venue available?",
    "We will tell you once a venue is confirmed.",
    "Availability is unknown until the venue answers.",
  ])("allows questions and hedged statements: %s", (text) => {
    expect(withSummary(text)).toBe("");
  });

  it("allows prices from the data and rejects invented ones", () => {
    expect(withSummary("The recorded quote is AED 10,500 for Alternative Hall.")).toBe("");
    expect(withSummary("The cancelled venue cost 9000 AED.")).toBe("");
    expect(withSummary("The new hall will cost AED 7,500 in total.")).toMatch(
      /AED 7,500 isn't in the data/,
    );
    expect(withSummary("Expect to pay 12345 USD.")).toMatch(/isn't in the data/);
  });

  it("rejects links, unknown placeholders and candidate names in the attendee update", () => {
    const base = good().attendeeUpdate;
    const upd = (body: string) => errorsFor({ attendeeUpdate: { ...base, body } }).join();
    expect(
      upd("Hello {{name}}, see https://example.test/new-venue for the details of the change."),
    ).toMatch(/links/);
    expect(
      upd("Hello {{name}}, we will meet at {{secret_place}} for {{event_name}}, details soon."),
    ).toMatch(/unknown placeholders/);
    expect(
      upd("Hello {{name}}, we are talking to Alternative Hall about the event, details soon."),
    ).toMatch(/Don't name a candidate venue/);
  });

  it("rejects statements in inquiries too", () => {
    const q = {
      providerId: IDS.altProvider,
      bookingId: "",
      purpose: "replacement_venue_availability" as const,
      subject: "Availability",
      body: "Our permit has been approved for any venue, so we are ready to book.",
    };
    expect(errorsFor({ providerInquiries: [q] }).join()).toMatch(/permit or clearance/);
  });
});

describe("what the code decides, not the model", () => {
  const changes = buildChanges(good(), impact);

  it("only produces the three safe change kinds, never a cancellation or booking change", () => {
    expect(new Set(changes.map((c) => c.kind))).toEqual(
      new Set(["reschedule_task", "add_task", "flag_review"]),
    );
    expect(JSON.stringify(changes)).not.toMatch(/cancel_booking|rebook|confirm_booking/);
  });

  it("flags every service booking for reconfirmation, whatever the model said", () => {
    const flags = changes.filter((c) => c.entity_type === "booking");
    expect(flags).toHaveLength(impact.services.length);
    expect(flags.every((f) => f.kind === "flag_review" && f.payload.action === "reconfirm")).toBe(
      true,
    );
    const silent = buildChanges({ ...good(), reviewNotes: [] }, impact);
    expect(silent.filter((c) => c.entity_type === "booking")).toHaveLength(1);
  });

  it("flags every affected compliance check for reassessment", () => {
    const flags = changes.filter((c) => c.entity_type === "compliance_check");
    expect(flags.map((f) => f.entity_id)).toEqual([IDS.check]);
    expect(flags[0].payload.action).toBe("reassess");
  });

  it("uses the model's reason text when given", () => {
    const withNote = buildChanges(
      {
        ...good(),
        reviewNotes: [
          {
            entityType: "booking",
            entityId: IDS.catererBooking,
            reason: "Delivery address changes.",
          },
        ],
      },
      impact,
    );
    expect(withNote.find((c) => c.entity_id === IDS.catererBooking)?.payload.reason).toBe(
      "Delivery address changes.",
    );
  });

  it("adds a templated reconfirmation inquiry for each affected service the model skipped", () => {
    const q = buildInquiries(good(), impact);
    const re = q.filter((x) => x.purpose === "service_reconfirmation");
    expect(re).toHaveLength(1);
    expect(re[0]).toMatchObject({
      provider_id: IDS.catererProvider,
      booking_id: IDS.catererBooking,
    });
    expect(re[0].body).toMatch(/not cancelled/);
    const again = buildInquiries(
      {
        ...good(),
        providerInquiries: [
          ...good().providerInquiries,
          {
            providerId: IDS.catererProvider,
            bookingId: IDS.catererBooking,
            purpose: "service_reconfirmation",
            subject: "Please reconfirm",
            body: "Please reconfirm your booking once the venue is known.",
          },
        ],
      },
      impact,
    );
    expect(again.filter((x) => x.purpose === "service_reconfirmation")).toHaveLength(1);
  });
});

describe("budget implications come from recorded quotes only", () => {
  it("shows a quote and its difference, or nothing", () => {
    const b = budgetView(impact);
    expect(b.originalVenue.amount).toBe(9000);
    expect(b.candidates[0]).toMatchObject({ quoteAmount: 10500, difference: 1500 });
    const none = budgetView(makeImpact({ candidates: [{ ...impact.candidates[0], quote: null }] }));
    expect(none.candidates[0]).toMatchObject({ quoteAmount: null, difference: null });
  });

  it("does not compare different currencies, and handles a missing event budget", () => {
    const usd = makeImpact({
      event: { ...impact.event, budget_amount: null },
      candidates: [
        { ...impact.candidates[0], quote: { ...impact.candidates[0].quote!, currency: "USD" } },
      ],
    });
    const b = budgetView(usd);
    expect(b.eventBudget).toBeNull();
    expect(b.candidates[0]).toMatchObject({
      quoteAmount: 10500,
      currency: "USD",
      difference: null,
    });
  });
});

describe("schema", () => {
  it("rejects malformed dates and too many options", () => {
    const p = good();
    expect(
      RecoveryProposal.safeParse({
        ...p,
        timeline: [{ label: "x y z", date: "tomorrow", note: "" }],
      }).success,
    ).toBe(false);
    expect(
      RecoveryProposal.safeParse({ ...p, options: [...p.options, ...p.options] }).success,
    ).toBe(false);
    expect(RecoveryProposal.safeParse({ ...p, options: [] }).success).toBe(false);
    expect(
      RecoveryProposal.safeParse({
        ...p,
        newTasks: [{ ...(p.newTasks[0] ?? {}), category: "cancel_everything" }],
      }).success,
    ).toBe(false);
  });
});
