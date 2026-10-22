import "server-only";
import { z } from "zod";
import type { EmailTransport, SendResult } from "./types";

/**
 * Resend over its REST API (POST https://api.resend.com/emails) with plain fetch, no SDK — the same
 * approach as the Gemini adapter. Only used when EMAIL_PROVIDER=resend with RESEND_API_KEY and
 * EMAIL_FROM (a sender on a domain verified in Resend). A 2xx response means Resend ACCEPTED the
 * message; it is recorded as "accepted", never as delivered. Not exercised against the real API yet.
 */
const API = "https://api.resend.com/emails";
const Accepted = z.object({ id: z.string().min(1).max(200) });
const ErrorBody = z.object({ name: z.string().optional(), message: z.string().optional() }).loose();

export function createResendTransport(opts: {
  apiKey: string;
  from: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): EmailTransport {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    name: "resend",
    isSimulated: false,
    async send(email): Promise<SendResult> {
      let res: Response;
      try {
        res = await fetchImpl(API, {
          method: "POST",
          headers: {
            authorization: `Bearer ${opts.apiKey}`,
            "content-type": "application/json",
            "idempotency-key": email.idempotencyKey,
          },
          body: JSON.stringify({
            from: opts.from,
            to: [email.to],
            subject: email.subject,
            text: email.text,
          }),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 15_000),
          cache: "no-store",
        });
      } catch (e) {
        const name = (e as { name?: string }).name;
        return {
          status: "failed",
          error:
            name === "TimeoutError"
              ? "Resend did not answer in time (outcome unknown)."
              : "Couldn't reach Resend.",
        };
      }
      const raw = await res.json().catch(() => null);
      if (res.ok) {
        const body = Accepted.safeParse(raw);
        return body.success
          ? {
              status: "accepted",
              providerMessageId: body.data.id,
              providerResponse: { id: body.data.id, http: res.status },
            }
          : {
              status: "failed",
              error: "Unexpected Resend response.",
              providerResponse: { http: res.status },
            };
      }
      const err = ErrorBody.safeParse(raw);
      return {
        status: "failed",
        error: `Resend refused the message (HTTP ${res.status}${err.success && err.data.name ? `, ${err.data.name.slice(0, 60)}` : ""}).`,
        providerResponse: {
          http: res.status,
          ...(err.success && err.data.message ? { message: err.data.message.slice(0, 300) } : {}),
        },
      };
    },
  };
}
