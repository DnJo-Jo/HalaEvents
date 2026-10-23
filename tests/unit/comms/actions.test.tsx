import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockTransport } from "@/lib/integrations/email/mock";
import type { EmailTransport } from "@/lib/integrations/email/types";
import { createFakeState, fakeClient, member, type FakeState } from "../helpers/fake-supabase";

// Messages, approvals, attendees and bookings through their server actions, with an in-memory
// Supabase double, a scripted AI provider and the mock email transport. The database rules
// themselves are tested in tests/db/{attendees,communications,bookings}.test.ts.

let state: FakeState;
let transport: EmailTransport & { outbox?: unknown[] };

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: vi.fn(async () => fakeClient(state)),
}));
vi.mock("@/lib/integrations/email", () => ({ getEmailTransport: () => transport }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
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

const comms = await import("@/modules/comms/actions");
const attendees = await import("@/modules/attendees/actions");
const bookings = await import("@/modules/bookings/booking-actions");

const EVENT = "11111111-1111-4111-8111-111111111111";
const MSG = "22222222-2222-4222-8222-222222222222";
const APPROVAL = "33333333-3333-4333-8333-333333333333";
const A1 = "44444444-4444-4444-8444-444444444444";
const A2 = "55555555-5555-4555-8555-555555555555";
const BOOKING = "66666666-6666-4666-8666-666666666666";
const PROVIDER = "77777777-7777-4777-8777-777777777777";
const future = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();

const attendee = (id: string, name: string, participation = "accepted") => ({
  id,
  event_id: EVENT,
  full_name: name,
  email: `${name.toLowerCase()}@example.test`,
  phone: null,
  application_note: null,
  source: "organizer",
  registration_status: "registered",
  review_status: "not_required",
  participation_status: participation,
  decision_reason: null,
  registered_at: future(0),
  confirmed_at: null,
  checked_in_at: null,
  created_at: future(0),
});

function setup(role: "owner" | "organizer" | "viewer" | null) {
  member(state, "user-1", ["organizer"]);
  state.tables.events = [
    {
      id: EVENT,
      owner_id: "user-1",
      name: "Campus Hack",
      event_type: "university_hackathon",
      status: "planning",
      venue_type: "indoor",
      location_text: null,
      city: "Dubai",
      country: "AE",
      timezone: "Asia/Dubai",
      starts_at: "2026-12-01T05:00:00Z",
      ends_at: "2026-12-02T05:00:00Z",
      capacity: 2,
      budget_amount: null,
      currency: "AED",
    },
  ];
  state.tables.event_members = role ? [{ event_id: EVENT, user_id: "user-1", role }] : [];
  state.tables.attendees = [attendee(A1, "Amal"), attendee(A2, "Badr")];
  state.tables.communications = [
    {
      id: MSG,
      event_id: EVENT,
      kind: "reminder",
      audience: "accepted",
      attendee_id: null,
      subject: "See you {{name}}",
      body: "Hello {{name}}, {{event_name}} starts {{event_date}}.",
      status: "approved",
      drafted_by: "organizer",
      is_mock_draft: false,
      recovery_plan_id: null,
      version: 1,
      created_at: future(0),
      updated_at: future(0),
      sent_at: null,
    },
  ];
  state.tables.approvals = [
    {
      id: APPROVAL,
      event_id: EVENT,
      action_type: "send_communication",
      target_id: MSG,
      recipient_summary: "2 recipient(s)",
      payload: {},
      payload_hash: "a".repeat(64),
      status: "approved",
      requested_by: "user-1",
      requested_at: future(0),
      decided_by: "user-1",
      decided_at: future(0),
      decision_note: null,
      executed_by: null,
      executed_at: null,
      result: null,
      failure_reason: null,
    },
  ];
  state.tables.communication_deliveries = [];
  state.tables.ai_runs = [];
  state.rpc.claim_approval = {
    data: {
      status: "executing",
      payload_hash: "a".repeat(64),
      payload: {
        communication_id: MSG,
        subject: "See you {{name}}",
        body: "Hello {{name}}, {{event_name}} starts {{event_date}}.",
        recipients: [
          { attendee_id: A1, email: "amal@example.test", name: "Amal" },
          { attendee_id: A2, email: "badr@example.test", name: "Badr" },
        ],
      },
    },
  };
  state.rpc.finish_communication = { data: "sent" };
  state.rpc.communication_recipients = { data: [] };
  state.rpc.save_communication = { data: MSG };
  state.rpc.register_attendee = { data: "accepted" };
}

const fd = (entries: Record<string, string> = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
};
const rpc = (fn: string) =>
  state.rpcCalls.filter((c) => c.fn === fn).map((c) => c.args as Record<string, unknown>);
beforeEach(() => {
  state = createFakeState({ sub: "user-1" });
  transport = createMockTransport();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "public-key");
});

describe("sending", () => {
  it("viewers and outsiders can't send, approve or draft — nothing reaches the database or transport", async () => {
    for (const role of ["viewer", null] as const) {
      setup(role);
      expect((await comms.sendApprovedAction(EVENT, APPROVAL, {}, fd())).ok).toBe(false);
      expect(
        (await comms.decideApprovalAction(EVENT, APPROVAL, {}, fd({ decision: "approve" }))).ok,
      ).toBe(false);
      expect(
        (
          await comms.saveDraftAction(
            EVENT,
            null,
            {},
            fd({ kind: "reminder", audience: "accepted", subject: "Hi", body: "Some body text" }),
          )
        ).ok,
      ).toBe(false);
      // Only the identity lookup (is_platform_admin) may run; no write or send function is called.
      expect(state.rpcCalls.map((c) => c.fn).filter((f) => f !== "is_platform_admin")).toEqual([]);
      expect(transport.outbox).toHaveLength(0);
      state.rpcCalls = [];
    }
  });

  it("sends the approved payload once per recipient, personalized in code, labelled simulated", async () => {
    setup("organizer");
    const r = await comms.sendApprovedAction(EVENT, APPROVAL, {}, fd());
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining("nothing was emailed") });
    expect(transport.outbox).toEqual([
      expect.objectContaining({
        to: "amal@example.test",
        subject: "See you Amal",
        idempotencyKey: `${APPROVAL}:${A1}`,
      }),
      expect.objectContaining({
        to: "badr@example.test",
        subject: "See you Badr",
        idempotencyKey: `${APPROVAL}:${A2}`,
      }),
    ]);
    const [finish] = rpc("finish_communication");
    expect(finish.p_transport).toBe("mock");
    expect((finish.p_results as { status: string }[]).map((x) => x.status)).toEqual([
      "simulated",
      "simulated",
    ]);
  });

  it("a changed payload (superseded at claim) sends nothing", async () => {
    setup("owner");
    state.rpc.claim_approval = { data: { status: "superseded" } };
    const r = await comms.sendApprovedAction(EVENT, APPROVAL, {}, fd());
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("nothing was sent") });
    expect(transport.outbox).toHaveLength(0);
    expect(rpc("finish_communication")).toEqual([]);
  });

  it("a second execution is refused by the database and nothing is re-sent", async () => {
    setup("owner");
    state.rpc.claim_approval = { error: { code: "23505", message: "already_executed" } };
    const r = await comms.sendApprovedAction(EVENT, APPROVAL, {}, fd());
    expect(r).toMatchObject({ ok: false, message: expect.stringContaining("already used") });
    expect(transport.outbox).toHaveLength(0);
  });

  it("a real transport's per-recipient failures are recorded, acceptance isn't called delivery", async () => {
    setup("owner");
    let n = 0;
    transport = {
      name: "resend",
      isSimulated: false,
      send: async () =>
        n++ === 0
          ? { status: "accepted", providerMessageId: "re_1", providerResponse: { id: "re_1" } }
          : { status: "failed", error: "Resend refused the message (HTTP 422)." },
    };
    state.rpc.finish_communication = { data: "partially_failed" };
    const r = await comms.sendApprovedAction(EVENT, APPROVAL, {}, fd());
    expect(r.message).toBe("1 of 2 accepted by the email provider (delivery not confirmed yet).");
    const [finish] = rpc("finish_communication");
    expect(finish.p_transport).toBe("resend");
    expect((finish.p_results as { status: string }[]).map((x) => x.status)).toEqual([
      "accepted",
      "failed",
    ]);
  });
});

describe("template drafts", () => {
  it("a template draft is saved as an organizer draft and never sent", async () => {
    setup("owner");
    const r = await comms.templateDraftAction(
      EVENT,
      {},
      fd({ kind: "reminder", audience: "all_places", attendeeId: "" }),
    );
    expect(r).toMatchObject({ ok: true, message: expect.stringContaining("template") });
    const [save] = rpc("save_communication");
    expect(save.p_ai_run_id).toBeNull();
    expect(save.p_subject).toContain("{{event_name}}");
    expect(save.p_body).toMatch(/\{\{name\}\}/);
    expect(rpc("request_approval")).toEqual([]);
    expect(transport.outbox).toHaveLength(0);
  });

  it("the organizer's extra details are added to the draft", async () => {
    setup("owner");
    await comms.templateDraftAction(
      EVENT,
      {},
      fd({
        kind: "reminder",
        audience: "all_places",
        attendeeId: "",
        instructions: "Doors open at 8:30, bring a laptop.",
      }),
    );
    expect(rpc("save_communication")[0].p_body).toContain("Doors open at 8:30, bring a laptop.");
  });

  it("extra details with a link or a false confirmation are refused, nothing is saved", async () => {
    setup("owner");
    for (const instructions of [
      "Register at https://evil.example now",
      "The venue is confirmed and the permit has been approved.",
    ]) {
      const r = await comms.templateDraftAction(
        EVENT,
        {},
        fd({ kind: "venue_update", audience: "all_places", attendeeId: "", instructions }),
      );
      expect(r.ok).toBe(false);
      expect(r.message).toMatch(/can't be used/);
    }
    expect(rpc("save_communication")).toEqual([]);
  });
});

describe("attendees", () => {
  it("public registration is rate limited per IP and answers the same way for every outcome", async () => {
    setup(null);
    const form = { fullName: "Sara K", email: "sara@example.test", consent: "yes" };
    const first = await attendees.registerAction("campus-hack", {}, fd(form));
    state.rpc.register_attendee = { data: "already_registered" };
    const dup = await attendees.registerAction("campus-hack", {}, fd(form));
    expect(first.message).toBe(dup.message);
    expect(first.ok && dup.ok).toBe(true);
    for (let i = 0; i < 10; i++) await attendees.registerAction("campus-hack", {}, fd(form));
    const limited = await attendees.registerAction("campus-hack", {}, fd(form));
    expect(limited).toMatchObject({
      ok: false,
      message: expect.stringContaining("Too many attempts"),
    });
  });

  it("viewers can't change participation; capacity errors read clearly", async () => {
    setup("viewer");
    expect(
      (await attendees.participationAction(EVENT, A1, {}, fd({ status: "confirmed" }))).ok,
    ).toBe(false);
    expect(rpc("set_attendee_participation")).toEqual([]);
    setup("owner");
    state.tables.attendees.push(
      attendee("88888888-8888-4888-8888-888888888888", "Chen", "waitlisted"),
    );
    state.rpc.set_attendee_participation = { error: { code: "23514", message: "capacity_full" } };
    const r = await attendees.participationAction(
      EVENT,
      "88888888-8888-4888-8888-888888888888",
      {},
      fd({ status: "accepted" }),
    );
    expect(r.message).toBe("The event is full. Waitlist this person instead.");
  });
});

describe("bookings", () => {
  const booking = (status: string) => ({
    id: BOOKING,
    event_id: EVENT,
    request_id: "r",
    quote_id: "q",
    provider_id: PROVIDER,
    provider_name: "Test Hall",
    quote_revision: 1,
    amount: "9000.00",
    currency: "AED",
    inclusions: "Hall",
    conditions: null,
    service_from: future(30),
    service_to: future(31),
    organizer_note: null,
    status,
    status_reason: null,
    pending_cancellation_reason: null,
    confirmed_at: null,
    created_at: future(0),
    updated_at: future(0),
  });

  it("organizers can't confirm, and can't cancel a confirmed booking without approval", async () => {
    setup("owner");
    state.tables.bookings = [booking("awaiting_provider")];
    const r = await bookings.organizerBookingAction(EVENT, BOOKING, {}, fd({ to: "confirmed" }));
    expect(r.ok).toBe(false);
    state.tables.bookings = [booking("confirmed")];
    const c = await bookings.organizerBookingAction(
      EVENT,
      BOOKING,
      {},
      fd({ to: "cancelled", reason: "Changed plans" }),
    );
    expect(c.message).toBe("Cancelling a confirmed booking needs an approval.");
    expect(rpc("organizer_booking_action")).toEqual([]);
  });

  it("only members of the booked provider can confirm", async () => {
    setup("owner");
    state.tables.bookings = [booking("awaiting_provider")];
    state.tables.provider_members = [];
    const r = await bookings.providerBookingAction(BOOKING, {}, fd({ to: "confirmed" }));
    expect(r).toMatchObject({ ok: false, message: "Only the booked provider can do this." });
    state.tables.provider_members = [{ provider_id: PROVIDER, user_id: "user-1", role: "owner" }];
    expect((await bookings.providerBookingAction(BOOKING, {}, fd({ to: "confirmed" }))).ok).toBe(
      true,
    );
    expect(rpc("provider_booking_action")).toEqual([
      { p_booking_id: BOOKING, p_to: "confirmed", p_reason: null },
    ]);
  });
});

describe("pages", () => {
  const html = async (el: Promise<React.ReactElement>) => renderToStaticMarkup(await el);

  it("messages page labels mock sending and shows the exact approved payload", async () => {
    setup("owner");
    state.tables.approvals[0].status = "pending";
    state.tables.approvals[0].payload = {
      subject: "See you {{name}}",
      body: "Exact approved body",
      recipients: [{ email: "amal@example.test", name: "Amal" }],
    };
    state.tables.communications[0].status = "awaiting_approval";
    const { default: Page } = await import("@/app/app/events/[eventId]/messages/page");
    const out = await html(Page({ params: Promise.resolve({ eventId: EVENT }) }));
    expect(out).toContain("Test mode: no real emails");
    expect(out).toContain("Exactly what will be sent");
    expect(out).toContain("Exact approved body");
    expect(out).toContain("Approve this exact message");
  });

  it("attendee page shows viewers counts only", async () => {
    setup("viewer");
    state.rpc.event_attendance_summary = {
      data: [{ capacity: 2, taken: 2, waitlisted: 1, pending: 0, checked_in: 0 }],
    };
    const { default: Page } = await import("@/app/app/events/[eventId]/attendees/page");
    const out = await html(Page({ params: Promise.resolve({ eventId: EVENT }) }));
    expect(out).toContain("2 / 2");
    expect(out).toContain("Counts only");
    expect(out).not.toContain("amal@example.test");
  });
});
