import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, fakeClient, member, type FakeState } from "../helpers/fake-supabase";

// Review actions with an in-memory Supabase double. Eligibility, duplicates and moderation rules are
// enforced (and tested) in the database: tests/db/reviews.test.ts.

let state: FakeState;

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(async () => fakeClient(state)),
}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  }),
  notFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  }),
  usePathname: () => "/app",
}));

const actions = await import("@/modules/reviews/actions");
const service = await import("@/modules/reviews/service");

const BOOKING = "b0000000-0000-4000-8000-000000000001";
const REVIEW = "a1000000-0000-4000-8000-000000000001";
const fd = (entries: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};
const rpc = (fn: string) =>
  state.rpcCalls.filter((c) => c.fn === fn).map((c) => c.args as Record<string, unknown>);
const good = {
  bookingId: BOOKING,
  direction: "organizer_to_provider",
  rating: "5",
  body: "Excellent venue, very helpful.",
};

beforeEach(() => {
  state = createFakeState({ sub: "user-1" });
  member(state, "user-1", ["organizer"]);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
});

describe("submitting", () => {
  it("passes a validated review to the database and nothing else (no verified flag)", async () => {
    state.rpc.create_review = { data: REVIEW };
    const r = await actions.submitReviewAction({}, fd({ ...good, verified: "true" }));
    expect(r).toMatchObject({ ok: true });
    expect(rpc("create_review")).toEqual([
      {
        p_booking_id: BOOKING,
        p_direction: "organizer_to_provider",
        p_rating: 5,
        p_body: "Excellent venue, very helpful.",
      },
    ]);
  });

  it("invalid ratings and text are refused before the database", async () => {
    for (const over of [
      { rating: "0" },
      { rating: "6" },
      { rating: "abc" },
      { body: "short" },
      { bookingId: "nope" },
    ]) {
      const r = await actions.submitReviewAction({}, fd({ ...good, ...over }));
      expect(r.ok).toBe(false);
    }
    expect(rpc("create_review")).toEqual([]);
  });

  it("a signed-out caller is sent to sign in", async () => {
    state = createFakeState({ sub: null });
    await expect(actions.submitReviewAction({}, fd(good))).rejects.toMatchObject({
      to: expect.stringMatching(/^\/sign-in/),
    });
    expect(rpc("create_review")).toEqual([]);
  });

  it.each([
    [
      "not_eligible: only a completed booking can be reviewed",
      "23514",
      /can't review this booking yet/,
    ],
    ["duplicate_review: this booking already has a review", "23505", /already has a review/],
    ["conflict_of_interest: you are on both sides", "23514", /both sides/],
    ["forbidden", "42501", /permission/],
  ])("database refusal '%s' becomes a readable message", async (message, code, expected) => {
    state.rpc.create_review = { error: { code, message } };
    const r = await actions.submitReviewAction({}, fd(good));
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(expected) });
  });
});

describe("responses and reports", () => {
  it("malformed ids and short text never reach the database", async () => {
    expect(
      (await actions.respondAction("x", {}, fd({ body: "Thank you for the feedback." }))).ok,
    ).toBe(false);
    expect((await actions.respondAction(REVIEW, {}, fd({ body: "ok" }))).ok).toBe(false);
    expect(
      (await actions.reportAction(REVIEW, {}, fd({ kind: "report", reason: "spam", details: "x" })))
        .ok,
    ).toBe(false);
    expect(rpc("respond_to_review")).toEqual([]);
    expect(rpc("report_review")).toEqual([]);
  });

  it("valid ones are forwarded, and duplicates are explained", async () => {
    await actions.respondAction(REVIEW, {}, fd({ body: "Thank you for the feedback." }));
    expect(rpc("respond_to_review")[0]).toMatchObject({ p_review_id: REVIEW });
    state.rpc.report_review = { error: { code: "23505", message: "duplicate_report: already" } };
    expect(
      await actions.reportAction(
        REVIEW,
        {},
        fd({ kind: "report", reason: "spam", details: "It is spam" }),
      ),
    ).toMatchObject({
      ok: false,
      message: "You already reported this review.",
    });
  });
});

describe("moderation is for platform admins only", () => {
  it("a non-admin is refused before any database call", async () => {
    expect(
      await actions.moderateAction(REVIEW, {}, fd({ status: "hidden", note: "Not appropriate" })),
    ).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Only platform admins/),
    });
    expect(
      await actions.resolveReportAction(
        REVIEW,
        {},
        fd({ resolution: "upheld", note: "Valid report", hide: "on" }),
      ),
    ).toMatchObject({ ok: false });
    expect(await actions.setProviderReviewsAction({}, fd({ enabled: "on" }))).toMatchObject({
      ok: false,
    });
    await expect(service.getModerationView()).rejects.toMatchObject({ code: "forbidden" });
    for (const fn of ["moderate_review", "resolve_review_report", "set_platform_setting"])
      expect(rpc(fn)).toEqual([]);
  });

  it("an admin's moderation is forwarded with a required reason", async () => {
    state = createFakeState({ sub: "admin-1" });
    member(state, "admin-1", ["organizer"], { admin: true });
    expect(
      (await actions.moderateAction(REVIEW, {}, fd({ status: "hidden", note: "no" }))).ok,
    ).toBe(false);
    expect(rpc("moderate_review")).toEqual([]);
    await actions.moderateAction(
      REVIEW,
      {},
      fd({ status: "hidden", note: "Contains personal data" }),
    );
    expect(rpc("moderate_review")[0]).toMatchObject({ p_review_id: REVIEW, p_status: "hidden" });
    await actions.setProviderReviewsAction({}, fd({ enabled: "on" }));
    expect(rpc("set_platform_setting")[0]).toEqual({
      p_key: "provider_reviews_of_organizers",
      p_enabled: true,
    });
    await actions.setProviderReviewsAction({}, fd());
    expect(rpc("set_platform_setting")[1]).toEqual({
      p_key: "provider_reviews_of_organizers",
      p_enabled: false,
    });
  });
});

describe("displayed ratings", () => {
  it("an empty history is 0 reviews with no average; a provider the caller can't see is null", async () => {
    state.rpc.provider_rating_summary = {
      data: [
        {
          review_count: 0,
          average: null,
          stars_1: 0,
          stars_2: 0,
          stars_3: 0,
          stars_4: 0,
          stars_5: 0,
        },
      ],
    };
    state.rpc.provider_reviews = { data: [] };
    expect(await service.getProviderRatings("c0000000-0000-4000-8000-000000000001")).toEqual({
      summary: { count: 0, average: null, distribution: [0, 0, 0, 0, 0] },
      reviews: [],
    });
    state.rpc.provider_rating_summary = { data: [] };
    expect(await service.getProviderRatings("c0000000-0000-4000-8000-000000000001")).toBeNull();
  });

  it("numeric strings from the database become numbers", async () => {
    state.rpc.provider_rating_summary = {
      data: [{ review_count: 2, average: "4.50", stars_4: 1, stars_5: 1 }],
    };
    state.rpc.provider_reviews = { data: [] };
    const r = await service.getProviderRatings("c0000000-0000-4000-8000-000000000001");
    expect(r?.summary).toEqual({ count: 2, average: 4.5, distribution: [0, 0, 0, 1, 1] });
  });
});
