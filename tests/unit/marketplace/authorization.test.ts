import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, fakeClient, member, type FakeState } from "../helpers/fake-supabase";

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
}));

const bookings = await import("@/modules/bookings/actions");
const providers = await import("@/modules/profiles/providers-actions");

const EVENT = "11111111-1111-4111-8111-111111111111";
const REQUEST = "22222222-2222-4222-8222-222222222222";
const PROVIDER = "33333333-3333-4333-8333-333333333333";
const QUOTE = "44444444-4444-4444-8444-444444444444";

function form(entries: Record<string, string | string[]>) {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of [v].flat()) f.append(k, x);
  return f;
}
const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

const requestRow = {
  id: REQUEST,
  event_id: EVENT,
  event_name: "Hack",
  event_city: "Dubai",
  timezone: "Asia/Dubai",
  category: "catering",
  title: "Meals",
  requirements: "Meals for 100 people",
  needed_from: future(30),
  needed_to: future(31),
  expected_attendance: 100,
  budget_max: null,
  currency: "AED",
  respond_by: null,
  status: "open",
  created_at: future(0),
};

beforeEach(() => {
  state = createFakeState({ sub: "user-1" });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
  state.tables.service_requests = [requestRow];
  state.tables.events = [
    {
      id: EVENT,
      owner_id: "owner",
      name: "Hack",
      event_type: "university_hackathon",
      status: "planning",
      venue_type: null,
      location_text: null,
      city: "Dubai",
      country: "AE",
      timezone: "Asia/Dubai",
      starts_at: future(30),
      ends_at: future(31),
      capacity: 100,
      budget_amount: null,
      currency: "AED",
    },
  ];
});

describe("service requests (organizer side)", () => {
  const requestForm = {
    eventId: EVENT,
    category: "catering",
    title: "Meals",
    requirements: "Meals for 100 people, halal",
    neededFrom: "2026-12-01T09:00",
    neededTo: "2026-12-02T18:00",
    expectedAttendance: "100",
    providerIds: [PROVIDER],
  };

  it("an event viewer cannot create a request — nothing reaches the database", async () => {
    member(state, "user-1", ["organizer"]);
    state.tables.event_members = [{ event_id: EVENT, user_id: "user-1", role: "viewer" }];
    const result = await bookings.createRequestAction({}, form(requestForm));
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringMatching(/owner or organizers/),
    });
    expect(state.rpcCalls.filter((c) => c.fn === "create_service_request")).toEqual([]);
  });

  it("an organizer's request converts event-local times to UTC and redirects to the request", async () => {
    member(state, "user-1", ["organizer"]);
    state.tables.event_members = [{ event_id: EVENT, user_id: "user-1", role: "organizer" }];
    state.rpc.create_service_request = { data: REQUEST };
    await expect(bookings.createRequestAction({}, form(requestForm))).rejects.toMatchObject({
      to: `/app/requests/${REQUEST}`,
    });
    const call = state.rpcCalls.find((c) => c.fn === "create_service_request")!;
    expect(call.args).toMatchObject({
      p_event_id: EVENT,
      p_needed_from: "2026-12-01T05:00:00.000Z", // 09:00 in Dubai (UTC+4)
      p_provider_ids: [PROVIDER],
    });
  });

  it("a provider cannot decline someone else's received quote", async () => {
    member(state, "user-1", ["service_provider"]);
    state.tables.quotes = [
      {
        id: QUOTE,
        request_id: REQUEST,
        provider_id: PROVIDER,
        amount: 1,
        currency: "AED",
        inclusions: "x",
        exclusions: null,
        conditions: null,
        valid_until: future(5),
        status: "submitted",
        revision: 1,
        submitted_at: null,
        decline_reason: null,
        updated_at: future(0),
      },
    ];
    state.tables.event_members = [];
    const result = await bookings.declineQuoteAction({}, form({ quoteId: QUOTE }));
    expect(result.ok).toBe(false);
    expect(state.rpcCalls.filter((c) => c.fn === "decline_quote")).toEqual([]);
  });
});

describe("quotes (provider side)", () => {
  const quoteForm = {
    requestId: REQUEST,
    providerId: PROVIDER,
    amount: "12000",
    inclusions: "Four meals",
    validUntil: "2099-01-01T12:00",
    intent: "submit",
  };

  it("a non-member of the provider cannot submit a quote for it", async () => {
    member(state, "user-1", ["service_provider"]);
    state.tables.provider_members = [
      { provider_id: PROVIDER, user_id: "someone-else", role: "owner" },
    ];
    const result = await bookings.saveQuoteAction({}, form(quoteForm));
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/not a member/) });
    expect(state.rpcCalls.filter((c) => c.fn === "save_quote")).toEqual([]);
  });

  it("a member submits; the submit/draft intent comes from the clicked button", async () => {
    member(state, "user-1", ["service_provider"]);
    state.tables.provider_members = [{ provider_id: PROVIDER, user_id: "user-1", role: "staff" }];
    const result = await bookings.saveQuoteAction({}, form({ ...quoteForm, intent: "draft" }));
    expect(result.ok).toBe(true);
    expect(state.rpcCalls.find((c) => c.fn === "save_quote")!.args).toMatchObject({
      p_submit: false,
      p_amount: 12000,
    });
  });

  it("rejects a validity date in the past before calling the database", async () => {
    member(state, "user-1", ["service_provider"]);
    state.tables.provider_members = [{ provider_id: PROVIDER, user_id: "user-1", role: "owner" }];
    const result = await bookings.saveQuoteAction(
      {},
      form({ ...quoteForm, validUntil: "2020-01-01T12:00" }),
    );
    expect(result.fieldErrors?.validUntil).toBeTruthy();
    expect(state.rpcCalls.filter((c) => c.fn === "save_quote")).toEqual([]);
  });
});

describe("listing management", () => {
  const profile = {
    kind: "service",
    category: "catering",
    name: "Good Food",
    pricingModel: "per_person",
    priceMin: "50",
    priceMax: "90",
  };

  it("staff cannot edit the business profile", async () => {
    member(state, "user-1", ["service_provider"]);
    state.tables.provider_members = [{ provider_id: PROVIDER, user_id: "user-1", role: "staff" }];
    const result = await providers.updateProviderAction(PROVIDER, {}, form(profile));
    expect(result).toMatchObject({
      ok: false,
      message: expect.stringMatching(/Only the provider's owner/),
    });
    expect(state.writes).toEqual([]);
  });

  it("creating a venue listing requires the venue provider role", async () => {
    member(state, "user-1", ["service_provider"]);
    const result = await providers.createProviderAction(
      {},
      form({ ...profile, kind: "venue", category: "venue" }),
    );
    expect(result).toMatchObject({ ok: false, message: expect.stringMatching(/Venue provider/) });
    expect(state.rpcCalls.filter((c) => c.fn === "create_provider")).toEqual([]);
  });

  it("“price on request” cannot carry a price range", async () => {
    member(state, "user-1", ["service_provider"]);
    const result = await providers.createProviderAction(
      {},
      form({ ...profile, pricingModel: "quote_only" }),
    );
    expect(result.fieldErrors?.pricingModel).toBeTruthy();
  });

  it("a forged provider id in the bound argument is rejected", async () => {
    member(state, "user-1", ["service_provider"]);
    await expect(
      providers.submitForVerificationAction("not-a-uuid", {}, form({})),
    ).rejects.toThrow();
    expect(state.rpcCalls).toEqual([]);
    expect(state.writes).toEqual([]);
  });
});

describe("admin actions", () => {
  it("non-admins get a 404 and nothing is changed", async () => {
    member(state, "user-1", ["organizer"]);
    await expect(
      providers.moderateAction(PROVIDER, {}, form({ status: "suspended", reason: "x" })),
    ).rejects.toMatchObject({
      notFound: true,
    });
    expect(state.rpcCalls.filter((c) => c.fn === "set_provider_moderation")).toEqual([]);
  });

  it("rejecting requires a reason", async () => {
    member(state, "user-1", ["organizer"], { admin: true });
    const result = await providers.decideVerificationAction(
      PROVIDER,
      {},
      form({ decision: "rejected" }),
    );
    expect(result.fieldErrors?.note).toBeTruthy();
  });
});
