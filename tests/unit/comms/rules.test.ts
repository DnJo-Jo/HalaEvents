import { describe, expect, it } from "vitest";
import {
  draftErrors,
  DELIVERY_LABELS,
  personalize,
  unknownPlaceholders,
} from "@/modules/comms/rules";
import { DraftInput } from "@/modules/comms/schemas";
import { participationOptions } from "@/modules/attendees/rules";
import { PublicRegistrationInput } from "@/modules/attendees/schemas";
import { canBookingTransition, directActions } from "@/modules/bookings/booking-rules";

describe("message rules", () => {
  it("fills only known placeholders, in code", () => {
    const vars = { name: "Sara", event_name: "Hack", event_date: "1 Dec", event_city: "Dubai" };
    expect(personalize("Hi {{ name }}, {{event_name}} in {{event_city}} {{unknown}}", vars)).toBe(
      "Hi Sara, Hack in Dubai {{unknown}}",
    );
    expect(unknownPlaceholders("{{name}} {{ticket_link}}")).toEqual(["ticket_link"]);
  });

  it("rejects AI drafts with unknown placeholders, links or confirmation claims", () => {
    expect(
      draftErrors({ subject: "Hello", body: "Hi {{name}}, see you at {{event_name}}." }),
    ).toEqual([]);
    expect(
      draftErrors({ subject: "Hello", body: "Hi {{first_name}}, welcome aboard!" })[0],
    ).toMatch(/Unknown placeholders/);
    expect(
      draftErrors({ subject: "Hello", body: "Details at https://example.com today." })[0],
    ).toMatch(/links/);
    expect(
      draftErrors({
        subject: "Update",
        body: "Good news: the permit has been approved by DET.",
      })[0],
    ).toMatch(/approved or confirmed/);
    expect(
      draftErrors({
        subject: "Update",
        body: "The venue is confirmed for the whole weekend.",
      })[0],
    ).toMatch(/approved or confirmed/);
    expect(
      draftErrors({ subject: "Confirmed", body: "Your registration is confirmed, {{name}}." }),
    ).toEqual([]);
  });

  it("delivery labels never claim more than the transport knows", () => {
    expect(DELIVERY_LABELS.simulated).toMatch(/not sent/);
    expect(DELIVERY_LABELS.accepted).toMatch(/delivery not confirmed/);
  });

  it("draft input requires a person exactly for single-recipient messages", () => {
    const base = { kind: "reminder", subject: "Hi there", body: "Body text long enough" };
    expect(DraftInput.safeParse({ ...base, audience: "single", attendeeId: "" }).success).toBe(
      false,
    );
    expect(DraftInput.safeParse({ ...base, audience: "accepted", attendeeId: "" }).success).toBe(
      true,
    );
    expect(
      DraftInput.safeParse({
        ...base,
        audience: "accepted",
        attendeeId: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(false);
  });
});

describe("attendee rules", () => {
  it("explains why a place can't be given", () => {
    const opts = participationOptions({
      participation: "pending",
      review: "pending",
      registered: true,
      placesLeft: 0,
    });
    expect(opts.find((o) => o.to === "accepted")?.blockers).toEqual([
      "Approve the application first.",
      "The event is full: waitlist instead.",
    ]);
    expect(opts.find((o) => o.to === "waitlisted")?.blockers).toEqual([]);
    const invited = participationOptions({
      participation: "pending",
      review: "not_required",
      registered: false,
      placesLeft: 5,
    });
    expect(invited.find((o) => o.to === "accepted")?.blockers).toEqual([
      "They haven't registered yet.",
    ]);
  });

  it("public registration collects the minimum and requires consent", () => {
    expect(
      PublicRegistrationInput.safeParse({ fullName: "Sara K", email: "S@x.test" }).success,
    ).toBe(false);
    const ok = PublicRegistrationInput.parse({
      fullName: "Sara K",
      email: "S@Example.test",
      phone: "",
      consent: "yes",
    });
    expect(ok).toEqual({
      fullName: "Sara K",
      email: "s@example.test",
      phone: undefined,
      applicationNote: undefined,
      consent: "yes",
    });
  });
});

describe("booking rules", () => {
  it("only providers confirm; organizers can't cancel a confirmed booking directly", () => {
    expect(canBookingTransition("awaiting_provider", "confirmed", "provider")).toBe(true);
    expect(canBookingTransition("awaiting_provider", "confirmed", "organizer")).toBe(false);
    expect(canBookingTransition("proposed", "confirmed", "provider")).toBe(false);
    expect(directActions("confirmed", "organizer")).toEqual(["completed", "disputed"]);
    expect(canBookingTransition("confirmed", "cancelled", "approval")).toBe(true);
    expect(directActions("disputed", "organizer")).toEqual([]);
  });
});
