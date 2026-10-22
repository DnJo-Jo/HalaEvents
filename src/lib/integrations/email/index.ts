import "server-only";
import { parseServerEnv } from "@/lib/env.server";
import { createMockTransport } from "./mock";
import { createResendTransport } from "./resend";
import type { EmailTransport } from "./types";

let cached: EmailTransport | undefined;

/** The configured transport. A misconfigured "resend" fails env validation; no silent mock fallback. */
export function getEmailTransport(): EmailTransport {
  if (cached) return cached;
  const env = parseServerEnv();
  cached =
    env.EMAIL_PROVIDER === "resend"
      ? createResendTransport({ apiKey: env.RESEND_API_KEY!, from: env.EMAIL_FROM! })
      : createMockTransport();
  return cached;
}
