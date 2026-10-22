import { describe, expect, it } from "vitest";
import { describeRating, stars } from "@/modules/reviews/rules";
import { ReportInput, ReviewInput } from "@/modules/reviews/schemas";

const B = "b0000000-0000-4000-8000-000000000001";

describe("rating display", () => {
  it("an empty history is never shown as a zero rating", () => {
    expect(describeRating({ count: 0, average: null })).toBe("No reviews yet");
    expect(describeRating({ count: 0, average: 0 })).toBe("No reviews yet");
  });
  it("shows the average with one decimal and a correct plural", () => {
    expect(describeRating({ count: 1, average: 5 })).toBe("5.0 out of 5 · 1 review");
    expect(describeRating({ count: 3, average: 4.333 })).toBe("4.3 out of 5 · 3 reviews");
  });
  it("renders stars within 0–5", () => {
    expect(stars(4.4)).toBe("★★★★☆");
    expect(stars(9)).toBe("★★★★★");
    expect(stars(-1)).toBe("☆☆☆☆☆");
  });
});

describe("review input", () => {
  const ok = {
    bookingId: B,
    direction: "organizer_to_provider",
    rating: "4",
    body: "Helpful, on time.",
  };
  it("accepts a valid review (form strings are coerced)", () => {
    expect(ReviewInput.safeParse(ok)).toMatchObject({ success: true, data: { rating: 4 } });
  });
  it.each([
    ["rating 0", { rating: "0" }],
    ["rating 6", { rating: "6" }],
    ["rating 3.5", { rating: "3.5" }],
    ["rating text", { rating: "great" }],
    ["rating missing", { rating: undefined }],
    ["short feedback", { body: "ok" }],
    ["blank feedback", { body: "           " }],
    ["long feedback", { body: "x".repeat(2001) }],
    ["bad booking id", { bookingId: "1; drop" }],
    ["bad direction", { direction: "sideways" }],
  ])("rejects %s", (_name, over) => {
    expect(ReviewInput.safeParse({ ...ok, ...over }).success).toBe(false);
  });
  it("there is no field to claim a verified transaction", () => {
    const parsed = ReviewInput.parse({ ...ok, verified: true, status: "published" });
    expect(Object.keys(parsed).sort()).toEqual(["body", "bookingId", "direction", "rating"]);
  });
  it("reports need a known reason and details", () => {
    expect(
      ReportInput.safeParse({ kind: "report", reason: "spam", details: "Looks like spam" }).success,
    ).toBe(true);
    expect(
      ReportInput.safeParse({ kind: "report", reason: "dislike", details: "Looks like spam" })
        .success,
    ).toBe(false);
    expect(
      ReportInput.safeParse({ kind: "other", reason: "spam", details: "Looks like spam" }).success,
    ).toBe(false);
  });
});
