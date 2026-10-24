import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, fakeClient, member, type FakeState } from "../helpers/fake-supabase";

// Authorization and orchestration with an in-memory Supabase double and a fake fetch. RLS and the
// SQL functions are covered on PGlite in tests/db/vendors.test.ts. No test reaches Geoapify.

let state: FakeState;
vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(async () => fakeClient(state)),
}));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));

const actions = await import("@/modules/vendors/actions");

const EVENT = "11111111-1111-4111-8111-111111111111";
const fetchSpy = vi.fn<typeof fetch>();

function setup(
  role: "owner" | "organizer" | "viewer" | null,
  services: string[] = ["catering"],
  status = "planning",
) {
  member(state, "user-1", ["organizer"]);
  state.tables.events = [
    {
      id: EVENT,
      owner_id: "owner",
      name: "Campus Hack",
      event_type: "university_hackathon",
      status,
      venue_type: null,
      location_text: null,
      city: "Dubai",
      country: "AE",
      timezone: "Asia/Dubai",
      starts_at: "2026-12-01T09:00:00Z",
      ends_at: "2026-12-02T09:00:00Z",
      capacity: 100,
      budget_amount: null,
      currency: "AED",
      services,
    },
  ];
  state.tables.event_members = role ? [{ event_id: EVENT, user_id: "user-1", role }] : [];
  state.tables.event_vendor_shortlist = [];
}
const calls = (fn: string) => state.rpcCalls.filter((c) => c.fn === fn).map((c) => c.args);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const GEO = { results: [{ lat: 25.2, lon: 55.3, formatted: "Dubai, UAE" }] };
const PLACES = {
  features: [
    {
      properties: {
        place_id: "p1",
        name: "Cafe One",
        formatted: "Cafe One, Dubai",
        lat: 25.2,
        lon: 55.3,
      },
    },
  ],
};

beforeEach(() => {
  state = createFakeState({ sub: "user-1" });
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
  vi.stubEnv("GEOAPIFY_API_KEY", "geo-test-key");
});

const form = (o: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) for (const x of [v].flat()) f.append(k, x);
  return f;
};

describe("service selection", () => {
  it("owners and organizers save any subset, including none, with no outside request", async () => {
    for (const role of ["owner", "organizer"] as const) {
      setup(role);
      expect(
        await actions.saveServicesAction(EVENT, {}, form({ services: ["venue", "transport"] })),
      ).toMatchObject({ ok: true });
      expect(await actions.saveServicesAction(EVENT, {}, form({}))).toMatchObject({ ok: true });
      expect(calls("save_event_services")).toEqual([
        { p_event_id: EVENT, p_services: ["venue", "transport"] },
        { p_event_id: EVENT, p_services: [] },
      ]);
      state.rpcCalls.length = 0;
    }
    expect(fetchSpy).not.toHaveBeenCalled(); // no vendor search or AI call on save
  });

  it("viewers, outsiders and closed events can't change it; unknown services are refused", async () => {
    setup("viewer");
    expect(await actions.saveServicesAction(EVENT, {}, form({ services: "venue" }))).toMatchObject({
      ok: false,
    });
    setup(null);
    expect(await actions.saveServicesAction(EVENT, {}, form({ services: "venue" }))).toMatchObject({
      ok: false,
    });
    setup("owner", [], "completed");
    expect(await actions.saveServicesAction(EVENT, {}, form({ services: "venue" }))).toMatchObject({
      ok: false,
    });
    setup("owner");
    expect(
      await actions.saveServicesAction(EVENT, {}, form({ services: "helicopter" })),
    ).toMatchObject({ ok: false });
    expect(await actions.saveServicesAction("nope", {}, form({}))).toMatchObject({ ok: false });
    expect(calls("save_event_services")).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("searchVendors", () => {
  it("geocodes the typed location, then searches once; the key stays in the header", async () => {
    setup("organizer");
    fetchSpy.mockResolvedValueOnce(json(GEO)).mockResolvedValueOnce(json(PLACES));
    const r = await actions.searchVendorsAction(
      EVENT,
      null,
      form({ category: "catering", location: "Dubai", radiusKm: "15" }),
    );
    expect(r).toMatchObject({ ok: true, vendors: [{ id: "p1", phone: null, website: null }] });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const places = fetchSpy.mock.calls[1][0] as URL;
    expect(places.searchParams.get("filter")).toBe("circle:55.3,25.2,15000");
    expect(String(fetchSpy.mock.calls[1][0])).not.toContain("geo-test-key");
  });

  it("rejects invalid categories, locations and radii before any request", async () => {
    setup("organizer", ["catering", "venue"]);
    const bad = (o: Record<string, string>) =>
      actions.searchVendorsAction(
        EVENT,
        null,
        form({ category: "catering", location: "Dubai", radiusKm: "15", ...o }),
      );
    expect(await bad({ category: "hotels" })).toMatchObject({ ok: false });
    expect(await bad({ location: " " })).toMatchObject({ ok: false });
    expect(await bad({ radiusKm: "9999" })).toMatchObject({ ok: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a service the event didn't select, and non-organizers", async () => {
    setup("organizer", ["venue"]);
    expect(
      await actions.searchVendorsAction(
        EVENT,
        null,
        form({ category: "catering", location: "Dubai", radiusKm: "15" }),
      ),
    ).toMatchObject({ ok: false });
    setup("viewer");
    expect(
      await actions.searchVendorsAction(
        EVENT,
        null,
        form({ category: "catering", location: "Dubai", radiusKm: "15" }),
      ),
    ).toMatchObject({ ok: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports unknown locations, empty results, a missing key and provider errors", async () => {
    setup("organizer");
    const run = () =>
      actions.searchVendorsAction(
        EVENT,
        null,
        form({ category: "catering", location: "Dubai", radiusKm: "15" }),
      );
    fetchSpy.mockResolvedValueOnce(json({ results: [] }));
    expect(await run()).toMatchObject({
      ok: false,
      message: expect.stringMatching(/find that location/),
    });
    fetchSpy.mockResolvedValueOnce(json(GEO)).mockResolvedValueOnce(json({ features: [] }));
    expect(await run()).toMatchObject({ ok: true, vendors: [] });
    fetchSpy.mockResolvedValueOnce(json({}, 500));
    expect(await run()).toMatchObject({ ok: false, message: expect.stringMatching(/failed/) });
    fetchSpy.mockRejectedValueOnce(new DOMException("t", "TimeoutError"));
    expect(await run()).toMatchObject({ ok: false, message: expect.stringMatching(/too long/) });
    vi.stubEnv("GEOAPIFY_API_KEY", "");
    fetchSpy.mockClear();
    expect(await run()).toMatchObject({
      ok: false,
      message: expect.stringMatching(/isn't set up/),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("shortlist", () => {
  const vendor = {
    category: "catering",
    placeId: "p1",
    name: "Cafe One",
    address: "Dubai",
    phone: "",
    website: "",
    latitude: "25.2",
    longitude: "55.3",
  };

  it("is saved per event through the RPC, and removed the same way", async () => {
    setup("organizer");
    await actions.shortlistVendorAction(EVENT, form(vendor));
    expect(calls("shortlist_vendor")).toEqual([
      {
        p_event_id: EVENT,
        p_category: "catering",
        p_place_id: "p1",
        p_name: "Cafe One",
        p_address: "Dubai",
        p_phone: null,
        p_website: null,
        p_latitude: 25.2,
        p_longitude: 55.3,
      },
    ]);
    await actions.removeVendorAction(EVENT, form({ category: "catering", placeId: "p1" }));
    expect(calls("remove_shortlisted_vendor")).toEqual([
      { p_event_id: EVENT, p_category: "catering", p_place_id: "p1" },
    ]);
    expect(
      await actions.saveVendorNoteAction(
        EVENT,
        {},
        form({ category: "catering", placeId: "p1", note: " ask about halal " }),
      ),
    ).toMatchObject({ ok: true });
    expect(calls("set_vendor_note")).toEqual([
      { p_event_id: EVENT, p_category: "catering", p_place_id: "p1", p_note: "ask about halal" },
    ]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("viewers, invalid snapshots and unselected services are refused", async () => {
    setup("viewer");
    await actions.shortlistVendorAction(EVENT, form(vendor));
    setup("organizer", ["venue"]);
    await actions.shortlistVendorAction(EVENT, form(vendor));
    setup("organizer");
    await actions.shortlistVendorAction(EVENT, form({ ...vendor, latitude: "999" }));
    await actions.shortlistVendorAction(EVENT, form({ ...vendor, website: "javascript:alert(1)" }));
    expect(calls("shortlist_vendor")).toEqual([]);
  });
});

describe("planning context", () => {
  it("selected services change the custom-draft fingerprint and the prompt; none keeps the old one", async () => {
    const { planInputHash } = await import("@/modules/planning/service");
    const { playbookFor } = await import("@/playbooks");
    const { interviewState, eventContext } = await import("@/modules/events/interview-rules");
    const { EventRow } = await import("@/modules/events/repo");
    setup("owner", []);
    const mk = (services: string[]) => {
      const event = EventRow.parse({ ...state.tables.events[0], services });
      const playbook = playbookFor("university_hackathon");
      const inputs = {
        playbook,
        state: interviewState(playbook, eventContext(event), {}),
        ctx: {},
        event,
      } as unknown as Parameters<typeof planInputHash>[0];
      return (d?: { model: string; promptVersion: string }) => planInputHash(inputs, d);
    };
    const draft = { model: "m", promptVersion: "planning.plan@2" };
    const none = mk([])(draft);
    expect(mk(["venue"])(draft)).not.toBe(none);
    expect(mk(["venue"])(draft)).not.toBe(mk(["venue", "catering"])(draft));
    expect(mk(["venue"])(draft)).toBe(mk(["venue"])(draft));
    expect(mk([])(draft)).toBe(mk([])(draft));
    expect(mk(["venue"])()).toBe(mk([])()); // template plans ignore services
  });
});
