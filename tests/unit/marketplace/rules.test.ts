import { describe, expect, it } from "vitest";
import { toLocalInput } from "@/lib/dates";
import { toUtcIso } from "@/lib/schemas/common";
import {
  canTransitionQuote,
  quoteDisplayStatus,
  sortForComparison,
} from "@/modules/bookings/rules";
import { DirectorySearchInput } from "@/modules/marketplace/schemas";
import { indicativePrice } from "@/modules/profiles/labels";
import { isPubliclyListed } from "@/modules/profiles/rules";

const now = new Date("2026-10-21T12:00:00Z");

describe("quotes", () => {
  it("has no 'accepted' path — a quote is never a booking here", () => {
    for (const actor of ["provider", "organizer"] as const) {
      expect(canTransitionQuote("submitted", "accepted" as never, actor)).toBe(false);
    }
  });

  it("derives 'expired' from valid_until for submitted quotes only", () => {
    expect(
      quoteDisplayStatus({ status: "submitted", valid_until: "2026-10-20T00:00:00Z" }, now),
    ).toBe("expired");
    expect(
      quoteDisplayStatus({ status: "declined", valid_until: "2026-10-20T00:00:00Z" }, now),
    ).toBe("declined");
    expect(
      quoteDisplayStatus({ status: "submitted", valid_until: "2026-11-01T00:00:00Z" }, now),
    ).toBe("submitted");
  });

  it("comparison puts live quotes first, then cheapest", () => {
    const q = (
      id: string,
      amount: number,
      status: "submitted" | "withdrawn",
      valid = "2026-12-01T00:00:00Z",
    ) => ({
      id,
      amount,
      currency: "AED",
      status,
      valid_until: valid,
    });
    const sorted = sortForComparison(
      [
        q("a", 9000, "submitted"),
        q("b", 5000, "withdrawn"),
        q("c", 7000, "submitted"),
        q("d", 1000, "submitted", "2026-01-01T00:00:00Z"),
      ],
      now,
    );
    expect(sorted.map((x) => x.id)).toEqual(["c", "a", "d", "b"]);
  });
});

describe("listing labels", () => {
  it("never shows a price for 'price on request'", () => {
    expect(indicativePrice("quote_only", 100, 200, "AED")).toBe("Price on request");
    expect(indicativePrice("per_person", null, null, "AED")).toBe("Price on request");
  });
  it("labels prices as indicative with their unit", () => {
    expect(indicativePrice("per_person", 45, 120, "AED")).toBe("Indicative: AED 45–120 per person");
    expect(indicativePrice("per_day", 900, null, "AED")).toBe("Indicative: from AED 900 per day");
  });
  it("is public only when verified, active and listed", () => {
    const base = {
      verification_status: "verified",
      moderation_status: "active",
      is_listed: true,
    } as const;
    expect(isPubliclyListed(base)).toBe(true);
    expect(isPubliclyListed({ ...base, is_listed: false })).toBe(false);
    expect(isPubliclyListed({ ...base, moderation_status: "hidden" })).toBe(false);
    expect(isPubliclyListed({ ...base, verification_status: "submitted" })).toBe(false);
  });
});

describe("timezones", () => {
  it("interprets datetime-local values in the event's timezone", () => {
    expect(toUtcIso("2026-12-01T09:00", "Asia/Dubai")).toBe("2026-12-01T05:00:00.000Z");
    expect(toUtcIso("2026-07-01T09:00", "Europe/London")).toBe("2026-07-01T08:00:00.000Z"); // BST
    expect(toUtcIso("2026-12-01T09:00:00+04:00", "UTC")).toBe("2026-12-01T05:00:00.000Z");
    expect(toUtcIso("garbage", "Asia/Dubai")).toBeNull();
  });
  it("round-trips through the form input format", () => {
    expect(toLocalInput("2026-12-01T05:00:00.000Z", "Asia/Dubai")).toBe("2026-12-01T09:00");
  });
});

describe("directory filters", () => {
  it("drops invalid query-string values instead of failing", () => {
    expect(
      DirectorySearchInput.parse({
        category: "weapons",
        attendance: "-5",
        budget: "abc",
        page: "0",
        q: "  hall ",
      }),
    ).toEqual({
      category: undefined,
      attendance: undefined,
      budget: undefined,
      page: undefined,
      q: "hall",
      city: undefined,
    });
  });
});
