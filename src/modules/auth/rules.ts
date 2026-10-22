/**
 * Post-auth redirect target. Only same-origin relative paths are allowed, so `?next=` can never
 * send a user to another site (open-redirect protection).
 */
export function safeNextPath(next: unknown, fallback = "/app"): string {
  if (typeof next !== "string" || next.length === 0 || next.length > 512) return fallback;
  // Must be a single leading slash followed by a non-slash, non-backslash character (or nothing).
  if (!/^\/(?![\/\\])/.test(next)) return fallback;
  // Reject control characters and backslashes anywhere (browsers normalise "\" to "/").
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const url = new URL(next, "http://halaevents.invalid");
    if (url.origin !== "http://halaevents.invalid") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}

/** Paths that require a signed-in session (checked by src/proxy.ts, enforced again by pages). */
export function isProtectedPath(pathname: string): boolean {
  return (
    pathname === "/app" ||
    pathname.startsWith("/app/") ||
    pathname === "/onboarding" ||
    pathname === "/account-status"
  );
}

export interface AuthErrorLike {
  code?: string;
  status?: number;
  message?: string;
}

/**
 * User-facing messages for Supabase Auth errors. Never echoes the provider's message, and keeps
 * sign-in failures generic so the form cannot be used to discover which emails have accounts.
 */
export function authErrorMessage(error: AuthErrorLike): string {
  switch (error.code) {
    case "invalid_credentials":
    case "user_not_found":
      return "Email or password is incorrect.";
    case "email_not_confirmed":
      return "Please confirm your email address first. Check your inbox for the link.";
    case "weak_password":
      return "Choose a stronger password: at least 8 characters with letters and numbers.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "Too many attempts. Please wait a minute and try again.";
    case "signup_disabled":
    case "email_provider_disabled":
      return "New sign-ups are currently disabled.";
    case "user_banned":
      return "This account can't sign in. Contact the HalaEvents team if you think this is a mistake.";
    case "email_address_invalid":
      return "Enter a valid email address.";
    case "otp_expired":
    case "flow_state_expired":
      return "This link has expired. Request a new one.";
    default:
      return error.status === 429
        ? "Too many attempts. Please wait a minute and try again."
        : "Something went wrong. Please try again.";
  }
}

/** Fixed messages for /auth/error?reason=… (the query value is never rendered). */
export const AUTH_ERROR_REASONS = {
  link_invalid: {
    title: "This link is invalid or has expired",
    body: "Confirmation links work once and expire after an hour. Sign in to request a new one.",
  },
  missing_token: {
    title: "This link is incomplete",
    body: "The confirmation link is missing information. Open it directly from the email, or request a new one.",
  },
  not_configured: {
    title: "Authentication isn't configured",
    body: "This HalaEvents deployment has no Supabase project connected yet.",
  },
} as const;
export type AuthErrorReason = keyof typeof AUTH_ERROR_REASONS;
