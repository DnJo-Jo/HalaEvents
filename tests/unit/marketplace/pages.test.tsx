import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, fakeClient, member, type FakeState } from "../helpers/fake-supabase";

// Server-component render smoke tests with an in-memory Supabase double. They catch runtime errors
// and missing labels in page logic; they do NOT prove the PostgREST queries work against a real
// database (no live Supabase was available — see event.md §15.7).

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

const P = "33333333-3333-4333-8333-333333333333";
const DEMO = "d0000000-0000-4000-8000-000000000001";
const EVENT = "11111111-1111-4111-8111-111111111111";
const REQ = "22222222-2222-4222-8222-222222222222";
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

const provider = (over: Record<string, unknown> = {}) => ({
  id: P,
  kind: "service",
  category: "catering",
  name: "Test Caterer",
  description: "Good food",
  city: "Dubai",
  country: "AE",
  service_area: ["Dubai", "Sharjah"],
  min_capacity: 10,
  max_capacity: 500,
  price_min: "45",
  price_max: 120,
  currency: "AED",
  pricing_model: "per_person",
  capabilities: ["Halal"],
  availability_note: "Weekends usually free",
  website: "https://example.test",
  is_listed: true,
  verification_status: "verified",
  verification_note: null,
  verified_at: "2026-10-01T00:00:00Z",
  submitted_at: "2026-09-30T00:00:00Z",
  moderation_status: "active",
  moderation_reason: null,
  is_demo: false,
  created_at: "2026-09-01T00:00:00Z",
  ...over,
});
const event = {
  id: EVENT,
  owner_id: "user-1",
  name: "Campus Hack",
  event_type: "university_hackathon",
  status: "planning",
  venue_type: null,
  location_text: null,
  city: "Dubai",
  country: "AE",
  timezone: "Asia/Dubai",
  starts_at: future(30),
  ends_at: future(31),
  capacity: 120,
  budget_amount: null,
  currency: "AED",
};
const request = {
  id: REQ,
  event_id: EVENT,
  event_name: "Campus Hack",
  event_city: "Dubai",
  timezone: "Asia/Dubai",
  category: "catering",
  title: "Hackathon meals",
  requirements: "Meals for 120 people",
  needed_from: future(30),
  needed_to: future(31),
  expected_attendance: 120,
  budget_max: "15000",
  currency: "AED",
  respond_by: null,
  status: "open",
  created_at: future(0),
};
const quote = (over: Record<string, unknown> = {}) => ({
  id: "q1",
  request_id: REQ,
  provider_id: P,
  amount: "13500",
  currency: "AED",
  inclusions: "Four meals",
  exclusions: null,
  conditions: "50% deposit",
  valid_until: future(10),
  status: "submitted",
  revision: 2,
  submitted_at: future(0),
  decline_reason: null,
  updated_at: future(0),
  ...over,
});

async function html(el: Promise<React.ReactElement> | React.ReactElement) {
  return renderToStaticMarkup(await el);
}

beforeEach(() => {
  state = createFakeState({ sub: "user-1" });
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
});

describe("marketplace pages render", () => {
  it("directory shows indicative prices, verification and demo labels", async () => {
    member(state, "user-1", ["organizer"]);
    state.rpc.search_providers = {
      data: [
        provider(),
        provider({
          id: DEMO,
          name: "Demo Atrium Hall",
          is_demo: true,
          kind: "venue",
          category: "venue",
        }),
      ],
    };
    const { default: Page } = await import("@/app/app/marketplace/page");
    const out = await html(Page({ searchParams: Promise.resolve({ category: "catering" }) }));
    expect(out).toContain("Test Caterer");
    expect(out).toContain("Indicative: AED 45–120 per person");
    expect(out).toContain("Verified");
    expect(out).toContain("Demo listing");
    expect(out).toContain("Some results are demo listings");
  });

  it("provider detail labels availability as a statement and quotes as not bookings", async () => {
    member(state, "user-1", ["organizer"]);
    state.tables.providers = [provider()];
    state.tables.provider_services = [];
    state.tables.event_members = [{ user_id: "user-1", role: "owner", events: event }];
    const { default: Page } = await import("@/app/app/marketplace/[providerId]/page");
    const out = await html(Page({ params: Promise.resolve({ providerId: P }) }));
    expect(out).toContain("Availability (as stated by the provider)");
    expect(out).toContain("not a live calendar");
    expect(out).toContain("A quote is not a booking");
    expect(out).toContain("Campus Hack");
  });

  it("an invisible provider is a 404", async () => {
    member(state, "user-1", ["organizer"]);
    state.tables.providers = [];
    const { default: Page } = await import("@/app/app/marketplace/[providerId]/page");
    await expect(Page({ params: Promise.resolve({ providerId: P }) })).rejects.toMatchObject({
      notFound: true,
    });
  });
});

describe("request pages render", () => {
  it("organizer comparison table shows quotes and the not-a-booking note", async () => {
    member(state, "user-1", ["organizer"]);
    state.tables.service_requests = [request];
    state.tables.event_members = [{ event_id: EVENT, user_id: "user-1", role: "owner" }];
    state.tables.service_request_invites = [
      {
        request_id: REQ,
        provider_id: P,
        status: "invited",
        decline_reason: null,
        invited_at: future(0),
        responded_at: null,
        providers: { name: "Test Caterer", category: "catering", is_demo: false },
      },
    ];
    state.tables.quotes = [quote()];
    state.tables.service_request_messages = [];
    const { default: Page } = await import("@/app/app/requests/[requestId]/page");
    const out = await html(Page({ params: Promise.resolve({ requestId: REQ }) }));
    expect(out).toContain("Compare quotes");
    expect(out).toContain("AED 13,500");
    expect(out).toContain("Revision 2");
    expect(out).toContain("nothing here books a provider");
  });

  it("a provider cannot open the organizer view (404)", async () => {
    member(state, "user-1", ["service_provider"]);
    state.tables.service_requests = [request];
    state.tables.event_members = [];
    const { default: Page } = await import("@/app/app/requests/[requestId]/page");
    await expect(Page({ params: Promise.resolve({ requestId: REQ }) })).rejects.toMatchObject({
      notFound: true,
    });
  });

  it("provider response page shows the quote form for an open request", async () => {
    member(state, "user-1", ["service_provider"]);
    state.tables.provider_members = [{ provider_id: P, user_id: "user-1", role: "owner" }];
    state.tables.providers = [provider()];
    state.tables.service_requests = [request];
    state.tables.service_request_invites = [
      {
        request_id: REQ,
        provider_id: P,
        status: "invited",
        decline_reason: null,
        invited_at: future(0),
        responded_at: null,
        providers: { name: "Test Caterer", category: "catering", is_demo: false },
      },
    ];
    state.tables.quotes = [quote({ status: "draft", revision: 0 })];
    state.tables.service_request_messages = [];
    const { default: Page } =
      await import("@/app/app/provider/requests/[requestId]/[providerId]/page");
    const out = await html(Page({ params: Promise.resolve({ requestId: REQ, providerId: P }) }));
    expect(out).toContain("Draft (not sent)");
    expect(out).toContain("Send quote");
    expect(out).toContain("Save draft");
    expect(out).toContain("other providers never see it");
  });
});

describe("provider and admin pages render", () => {
  it("manage page separates verification, moderation and pause", async () => {
    member(state, "user-1", ["service_provider"]);
    state.tables.provider_members = [{ provider_id: P, user_id: "user-1", role: "owner" }];
    state.tables.providers = [
      provider({
        verification_status: "rejected",
        verification_note: "Licence expired",
        moderation_status: "hidden",
        moderation_reason: "Duplicate",
      }),
    ];
    state.tables.provider_private = [
      {
        provider_id: P,
        legal_name: null,
        trade_license_number: null,
        contact_email: "ops@example.test",
        contact_phone: null,
      },
    ];
    state.tables.provider_services = [];
    state.tables.provider_documents = [];
    const { default: Page } = await import("@/app/app/provider/[providerId]/page");
    const out = await html(Page({ params: Promise.resolve({ providerId: P }) }));
    expect(out).toContain("Licence expired");
    expect(out).toContain("Hidden by moderators");
    expect(out).toContain("Submit for verification");
    expect(out).toContain("Pause listing");
    expect(out).toContain("never to organizers");
  });

  it("admin review page renders decisions for a submitted provider", async () => {
    member(state, "user-1", ["organizer"], { admin: true });
    state.tables.providers = [provider({ verification_status: "submitted", verified_at: null })];
    state.tables.provider_private = [];
    state.tables.provider_services = [];
    state.tables.provider_documents = [];
    const { default: Page } = await import("@/app/app/admin/providers/[providerId]/page");
    const out = await html(Page({ params: Promise.resolve({ providerId: P }) }));
    expect(out).toContain("Verify");
    expect(out).toContain("Moderation");
  });

  it("admin pages are a 404 for non-admins", async () => {
    member(state, "user-1", ["organizer"]);
    const { default: Page } = await import("@/app/app/admin/providers/page");
    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toMatchObject({
      notFound: true,
    });
  });
});
