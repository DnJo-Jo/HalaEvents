/**
 * Email transport (event.md §21.4). A transport sends ONE already-approved, already-personalized
 * message and reports what it actually knows:
 * - "simulated": mock transport; nothing left the server.
 * - "accepted": the provider's API accepted the message for delivery. This is NOT delivery, and
 *   certainly not "read": final delivery needs provider webhooks, which are not implemented.
 * - "failed": refused or errored (with the provider's error, sanitized).
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  /** Stable per (approval, recipient): a retry can't create a second message at the provider. */
  idempotencyKey: string;
}

export type SendResult =
  | { status: "simulated"; providerMessageId: string }
  | { status: "accepted"; providerMessageId: string; providerResponse: Record<string, unknown> }
  | { status: "failed"; error: string; providerResponse?: Record<string, unknown> };

export interface EmailTransport {
  readonly name: "mock" | "resend";
  readonly isSimulated: boolean;
  send(email: OutgoingEmail): Promise<SendResult>;
}
