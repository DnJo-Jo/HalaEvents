import type { EmailTransport, OutgoingEmail, SendResult } from "./types";

/**
 * Mock transport (EMAIL_PROVIDER=mock, the default). Sends nothing. Every result is "simulated"
 * and the UI labels it "Simulated — not sent". `outbox` lets tests inspect what would have gone out.
 */
export function createMockTransport(opts: { failFor?: (to: string) => boolean } = {}) {
  const outbox: OutgoingEmail[] = [];
  const transport: EmailTransport & { outbox: OutgoingEmail[] } = {
    name: "mock",
    isSimulated: true,
    outbox,
    async send(email): Promise<SendResult> {
      if (opts.failFor?.(email.to)) return { status: "failed", error: "Simulated failure (mock)." };
      outbox.push(email);
      return { status: "simulated", providerMessageId: `mock-${email.idempotencyKey}` };
    },
  };
  return transport;
}
