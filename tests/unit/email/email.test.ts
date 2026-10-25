// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeState, fakeClient, member, type FakeState } from "../helpers/fake-supabase";

// Vendor email drafts: facts → template/AI body → validation → Gmail link. Cloudflare is only ever
// reached through a fake fetch; nothing here touches the network.

let state: FakeState;
vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(async () => fakeClient(state)),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: vi.fn(async () => {}),
}));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((to: string) => {
    throw new Error(`NEXT_REDIRECT:${to}`);
  }),
  notFound: vi.fn(() => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { notFound: true });
  }),
}));

const { draftVendorEmail, draftTargets } = await import("@/modules/email/service");
const { draftEmailAction } = await import("@/modules/email/actions");
const { emailReference, emailSubject, bodyProblems } = await import("@/modules/email/rules");
const { gmailComposeUrl, GMAIL_URL_MAX } = await import("@/lib/integrations/gmail-compose");

const EVENT = "11111111-1111-4111-8111-111111111111";
const event = {
  id: EVENT,
  owner_id: "owner",
  name: "Campus Hack 2026",
  event_type: "university_hackathon",
  status: "planning",
  venue_type: "indoor",
  location_text: "Main hall",
  city: "Dubai",
  country: "AE",
  timezone: "Asia/Dubai",
  starts_at: "2026-12-01T05:00:00Z",
  ends_at: "2026-12-02T14:00:00Z",
  capacity: 120,
  budget_amount: 50000,
  currency: "AED",
  services: ["venue", "catering"],
  additional_details: "Most attendees are students.",
};
const vendor = {
  event_id: EVENT,
  category: "catering",
  place_id: "p1",
  name: "Cafe One",
  address: "Dubai Marina",
  phone: "+971 4 000 0000",
  website: null,
  latitude: 25.2,
  longitude: 55.3,
  note: null,
  created_at: "2026-10-24T00:00:00Z",
};
const BODY =
  "We would like to ask about catering for our two-day event with about 120 attendees. Could you share availability, menu options, dietary accommodations and an estimate?";

const fetchSpy = vi.fn();
let n = 0;
function setup(role: "owner" | "organizer" | "viewer" | null = "organizer", ai = true) {
  const user = `user-${++n}`;
  state = createFakeState({ sub: user });
  member(state, user, ["organizer"]);
  state.tables.events = [event];
  state.tables.event_members = role ? [{ event_id: EVENT, user_id: user, role }] : [];
  state.tables.event_vendor_shortlist = [vendor];
  state.tables.ai_plans = [];
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
  vi.stubEnv("AI_PROVIDER", ai ? "cloudflare" : "none");
  if (ai) {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "0123456789abcdef0123456789abcdef");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-token-not-real");
    vi.stubEnv("AI_PLAN_MODEL", "@cf/test/model-1");
  }
}
const reply = (response: unknown) =>
  new Response(JSON.stringify({ success: true, errors: [], result: { response } }), {
    status: 200,
  });

beforeEach(() => {
  vi.unstubAllEnvs();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
});

describe("template drafts (no AI)", () => {
  it("uses real event facts, the vendor name and a stable reference; no model call", async () => {
    setup();
    const r = await draftVendorEmail(EVENT, { category: "catering", placeId: "p1" }, "template");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const d = r.draft;
    expect(d.source).toBe("template");
    expect(d.to).toBe("");
    expect(d.subject).toBe(`Catering quotation request: Campus Hack 2026 [${d.reference}]`);
    expect(d.reference).toBe(emailReference(EVENT, "catering", "p1"));
    expect(d.reference).toMatch(/^HE-[0-9A-F]{8}$/);
    expect(d.body).toContain("Hello Cafe One team,");
    expect(d.body).toContain("Campus Hack 2026");
    expect(d.body).toContain("1 Dec 2026 – 2 Dec 2026");
    expect(d.body).toContain("Location: Dubai");
    expect(d.body).toContain("Expected attendees: 120");
    expect(d.body).toMatch(/dietary accommodations/);
    expect(d.body).toMatch(/\[Your name\]|Kind regards/);
    // Nothing invented: the vendor's phone number and the internal event id never appear.
    expect(d.body + d.subject).not.toContain(EVENT);
    expect(d.body).not.toContain("+971");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks category-appropriate questions", async () => {
    setup();
    const venue = await draftVendorEmail(EVENT, { category: "venue" }, "template");
    const transport = await draftVendorEmail(EVENT, { category: "transport" }, "template");
    expect(venue.ok && venue.draft.body).toMatch(/capacity[\s\S]*rental cost/i);
    expect(transport.ok && transport.draft.body).toMatch(/passenger capacity[\s\S]*pickup/i);
    expect(venue.ok && venue.draft.body.startsWith("Hello,")).toBe(true);
  });

  it("handles missing optional data without placeholders or invented facts", async () => {
    setup();
    state.tables.events = [{ ...event, city: null, additional_details: null }];
    const r = await draftVendorEmail(EVENT, { category: "venue" }, "template");
    expect(r.ok && r.draft.body).not.toMatch(/Location:|null|undefined/);
  });

  it("the reference differs per vendor/category and never contains the event id", () => {
    const a = emailReference(EVENT, "catering", "p1");
    expect(emailReference(EVENT, "catering", "p2")).not.toBe(a);
    expect(emailReference(EVENT, "venue")).not.toBe(a);
    expect(
      emailSubject({ eventName: "x".repeat(200), category: "venue", reference: a }).length,
    ).toBeLessThan(140);
  });
});

describe("authorization and input", () => {
  it.each(["viewer", null] as const)("%s cannot draft", async (role) => {
    setup(role);
    await expect(draftVendorEmail(EVENT, { category: "venue" }, "template")).rejects.toMatchObject(
      role ? { code: "forbidden" } : { notFound: true }, // outsiders get a 404
    );
    expect(await draftTargets(EVENT).catch(() => "denied")).toBeOneOf([null, "denied"]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an unknown category or a vendor that isn't on this event's shortlist", async () => {
    setup();
    expect((await draftVendorEmail(EVENT, { category: "dj" }, "template")).ok).toBe(false);
    const r = await draftVendorEmail(
      EVENT,
      { category: "catering", placeId: "other-event" },
      "template",
    );
    expect(r).toMatchObject({ ok: false });
    const wrongCat = await draftVendorEmail(
      EVENT,
      { category: "venue", placeId: "p1" },
      "template",
    );
    expect(wrongCat.ok).toBe(false);
  });

  it("the action rejects a malformed event id before any work", async () => {
    setup();
    const fd = new FormData();
    fd.set("target", "venue");
    expect(await draftEmailAction("nope", null, fd)).toMatchObject({ ok: false });
  });

  it("returns the connected organizer account and the demo vendor address for Gmail", async () => {
    setup();
    state.tables.gmail_connections = [
      { user_id: state.sub, email: "organizer@gmail.com", refresh_token_enc: "x".repeat(40) },
    ];
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "id");
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "secret");
    vi.stubEnv("GMAIL_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
    vi.stubEnv("GMAIL_DEMO_VENDOR_EMAIL", "Vendor@Gmail.com");
    const t = await draftTargets(EVENT);
    expect(t?.organizerEmail).toBe("organizer@gmail.com");
    expect(t?.vendorEmail).toBe("vendor@gmail.com");
    // Neither token nor secrets are part of what reaches the page.
    expect(JSON.stringify(t)).not.toMatch(/xxxx|secret/);
  });

  it("lists targets for organizers only, with the shortlist", async () => {
    setup();
    const t = await draftTargets(EVENT);
    expect(t?.categories.map((c) => c.value)).toEqual(["venue", "catering"]);
    expect(t?.vendors).toEqual([{ placeId: "p1", name: "Cafe One", category: "catering" }]);
    expect(t?.customAvailable).toBe(true);
    expect(t?.vendorEmail).toBeNull();
    expect(t?.organizerEmail).toBeNull();
  });
});

describe("custom drafts (AI gateway, fake fetch)", () => {
  it("one request; the model writes the body, code adds greeting, subject and sign-off", async () => {
    setup();
    fetchSpy.mockResolvedValueOnce(reply({ body: BODY }));
    const r = await draftVendorEmail(EVENT, { category: "catering", placeId: "p1" }, "custom");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r.ok && r.draft).toMatchObject({ source: "custom", to: "" });
    expect(r.ok && r.draft.body).toContain(BODY);
    expect(r.ok && r.draft.body.startsWith("Hello Cafe One team,")).toBe(true);
    expect(r.ok && r.draft.subject).toContain("[HE-");
    // The prompt carries event facts but no contact details or internal ids.
    const sent = String(fetchSpy.mock.calls[0][1].body);
    expect(sent).toContain("Campus Hack 2026");
    expect(sent).not.toContain("+971");
    expect(sent).not.toContain(EVENT);
    expect(sent).not.toContain("test-token-not-real");
  });

  it("an identical request is served from memory (no duplicate AI call)", async () => {
    setup();
    fetchSpy.mockResolvedValueOnce(reply({ body: BODY }));
    await draftVendorEmail(EVENT, { category: "catering", placeId: "p1" }, "custom");
    const again = await draftVendorEmail(EVENT, { category: "catering", placeId: "p1" }, "custom");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(again.ok && again.draft.source).toBe("custom");
  });

  it.each([
    ["provider error", () => fetchSpy.mockResolvedValueOnce(new Response("x", { status: 500 }))],
    ["network failure", () => fetchSpy.mockRejectedValueOnce(new TypeError("offline"))],
    ["invalid JSON shape", () => fetchSpy.mockResolvedValueOnce(reply({ nope: 1 }))],
    [
      "contact details in the text",
      () =>
        fetchSpy.mockResolvedValueOnce(
          reply({ body: `${BODY} Reply to sales@cafe.example today.` }),
        ),
    ],
    [
      "an invented confirmation",
      () =>
        fetchSpy.mockResolvedValueOnce(reply({ body: `${BODY} We have booked the date already.` })),
    ],
  ])("%s → labelled template fallback, still one request", async (_n, arrange) => {
    setup();
    arrange();
    const r = await draftVendorEmail(EVENT, { category: "catering", placeId: "p1" }, "custom");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(r.ok && r.draft.source).toBe("template");
    expect(r.ok && r.draft.notice).toMatch(/template draft/);
    expect(r.ok && r.draft.body).toContain("Hello Cafe One team,");
  });

  it("falls back without any request when AI isn't configured", async () => {
    setup("organizer", false);
    const r = await draftVendorEmail(EVENT, { category: "venue" }, "custom");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.ok && r.draft.source).toBe("template");
    expect((await draftTargets(EVENT))?.customAvailable).toBe(false);
  });

  it("rate-limits bursts and falls back instead of calling the model", async () => {
    setup();
    fetchSpy.mockImplementation(async () => reply({ body: BODY }));
    // Distinct requests (different vendors/categories) so the cache can't absorb them.
    for (const c of ["venue", "transport", "catering"] as const)
      await draftVendorEmail(EVENT, { category: c }, "custom");
    const r = await draftVendorEmail(EVENT, { category: "catering", placeId: "p1" }, "custom");
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(r.ok && r.draft.source).toBe("template");
  });
});

describe("body validation", () => {
  it("flags urls, emails, phones, placeholders and confirmations", () => {
    const f = { vendorName: "Cafe One" };
    expect(bodyProblems(BODY, f)).toEqual([]);
    expect(bodyProblems("See https://x.example", f)).toContain("url");
    expect(bodyProblems("Mail a@b.co", f)).toContain("email");
    expect(bodyProblems("Call 050 123 4567 now", f)).toContain("phone");
    expect(bodyProblems("Between 120 - 150 guests on 2026-12-01", f)).toEqual([]);
    expect(bodyProblems("Dear [Name]", f)).toContain("placeholder");
    expect(bodyProblems("Hello team", { vendorName: null })).toContain("greeting");
  });
});

describe("Gmail compose link", () => {
  it("encodes to, subject and body", () => {
    const body = "Line one\nLine two & more = 100% — «ok»?";
    const url = gmailComposeUrl({ to: " a@b.co ", subject: "Quote: A&B [HE-1]", body })!;
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe("https://mail.google.com/mail/");
    expect(u.searchParams.get("view")).toBe("cm");
    expect(u.searchParams.get("fs")).toBe("1");
    expect(u.searchParams.get("to")).toBe("a@b.co");
    expect(u.searchParams.get("su")).toBe("Quote: A&B [HE-1]");
    expect(u.searchParams.get("body")).toBe(body);
  });
  it("selects the account by email address and keeps every field encoded", () => {
    const body = "Line one\nPrice & more = 100%";
    const subject = "Quote: A&B [HE-ABCD1234]";
    const u = new URL(
      gmailComposeUrl({
        account: "organizer+test@gmail.com",
        to: "vendor@gmail.com",
        subject,
        body,
      })!,
    );
    expect(u.searchParams.get("authuser")).toBe("organizer+test@gmail.com");
    expect(u.searchParams.get("to")).toBe("vendor@gmail.com");
    expect(u.searchParams.get("su")).toBe(subject);
    expect(u.searchParams.get("body")).toBe(body);
    // "+" in the address is percent-encoded, not read back as a space.
    expect(u.search).toContain("authuser=organizer%2Btest%40gmail.com");
    expect(new URL(gmailComposeUrl({ subject, body })!).searchParams.has("authuser")).toBe(false);
  });
  it("omits an empty recipient and refuses over-long links", () => {
    const u = new URL(gmailComposeUrl({ subject: "s", body: "b" })!);
    expect(u.searchParams.has("to")).toBe(false);
    expect(gmailComposeUrl({ subject: "s", body: "x ".repeat(GMAIL_URL_MAX) })).toBeNull();
  });
});
