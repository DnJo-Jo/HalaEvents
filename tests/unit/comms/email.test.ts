import { describe, expect, it, vi } from "vitest";
import { createMockTransport } from "@/lib/integrations/email/mock";
import { createResendTransport } from "@/lib/integrations/email/resend";

const email = { to: "a@example.test", subject: "Hi", text: "Body", idempotencyKey: "appr-1:att-1" };
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("mock transport", () => {
  it("sends nothing and reports simulated", async () => {
    const t = createMockTransport();
    const r = await t.send(email);
    expect(r).toEqual({ status: "simulated", providerMessageId: "mock-appr-1:att-1" });
    expect(t.isSimulated).toBe(true);
    expect(t.outbox).toHaveLength(1);
  });
});

describe("Resend transport (REST, fake fetch)", () => {
  it("authenticates in a header, sends an idempotency key, and records 2xx as accepted — not delivered", async () => {
    const fetchImpl = vi.fn(async () => json(200, { id: "re_abc" }));
    const t = createResendTransport({
      apiKey: "re_secret",
      from: "Hala <hi@example.test>",
      fetchImpl,
    });
    const r = await t.send(email);
    expect(r).toEqual({
      status: "accepted",
      providerMessageId: "re_abc",
      providerResponse: { id: "re_abc", http: 200 },
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_secret");
    expect(headers["idempotency-key"]).toBe("appr-1:att-1");
    expect(url).not.toContain("re_secret");
    expect(JSON.parse(init.body as string)).toEqual({
      from: "Hala <hi@example.test>",
      to: ["a@example.test"],
      subject: "Hi",
      text: "Body",
    });
    expect(t.isSimulated).toBe(false);
  });

  it("maps refusals and network failures to failed without leaking the key", async () => {
    const refused = createResendTransport({
      apiKey: "re_secret",
      from: "x@example.test",
      fetchImpl: async () => json(422, { name: "validation_error", message: "Invalid `to` field" }),
    });
    const r = await refused.send(email);
    expect(r).toMatchObject({ status: "failed", error: expect.stringContaining("HTTP 422") });
    expect(JSON.stringify(r)).not.toContain("re_secret");
    const down = createResendTransport({
      apiKey: "k",
      from: "x@example.test",
      fetchImpl: async () => {
        throw Object.assign(new Error("boom"), { name: "TypeError" });
      },
    });
    expect(await down.send(email)).toEqual({ status: "failed", error: "Couldn't reach Resend." });
    const slow = createResendTransport({
      apiKey: "k",
      from: "x@example.test",
      fetchImpl: async () => {
        throw Object.assign(new Error("t"), { name: "TimeoutError" });
      },
    });
    expect((await slow.send(email)).status).toBe("failed");
  });
});
