import "server-only";
import { getAppUrl, getSupabaseConfig } from "@/lib/db/config";
import { createSupabaseServerClient } from "@/lib/db/server";
import { authErrorMessage } from "./rules";

export type AuthResult = { ok: true } | { ok: false; code?: string; message: string };

const NOT_CONFIGURED: AuthResult = {
  ok: false,
  code: "not_configured",
  message: "Sign-in isn't available: this deployment has no Supabase project configured.",
};

function confirmUrl(next: string): string {
  return `${getAppUrl()}/auth/confirm?next=${encodeURIComponent(next)}`;
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (!getSupabaseConfig()) return NOT_CONFIGURED;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? { ok: false, code: error.code, message: authErrorMessage(error) } : { ok: true };
}

/**
 * Creates the account and sends the confirmation email. When the email is already registered,
 * Supabase returns a success-shaped response without sending anything new, so the caller shows
 * the same "check your inbox" page either way (no account enumeration).
 */
export async function signUp(
  email: string,
  password: string,
): Promise<AuthResult & { sessionCreated?: boolean }> {
  if (!getSupabaseConfig()) return NOT_CONFIGURED;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: confirmUrl("/onboarding") },
  });
  if (error) return { ok: false, code: error.code, message: authErrorMessage(error) };
  // A session is only returned if the project has email confirmations disabled.
  return { ok: true, sessionCreated: Boolean(data.session) };
}

export async function resendConfirmation(email: string): Promise<AuthResult> {
  if (!getSupabaseConfig()) return NOT_CONFIGURED;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: confirmUrl("/onboarding") },
  });
  return error ? { ok: false, code: error.code, message: authErrorMessage(error) } : { ok: true };
}

/**
 * Sends the password-reset email. Callers show the same message whether or not the address has an
 * account, so only rate-limit style failures are surfaced.
 */
export async function requestPasswordReset(email: string): Promise<AuthResult> {
  if (!getSupabaseConfig()) return NOT_CONFIGURED;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: confirmUrl("/reset-password"),
  });
  return error ? { ok: false, code: error.code, message: authErrorMessage(error) } : { ok: true };
}

/** Sets a new password for the signed-in (recovery) session and ends the user's other sessions. */
export async function updatePassword(password: string): Promise<AuthResult> {
  if (!getSupabaseConfig()) return NOT_CONFIGURED;
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { ok: false, code: error.code, message: authErrorMessage(error) };
  await supabase.auth.signOut({ scope: "others" });
  return { ok: true };
}

export async function signOut(): Promise<void> {
  if (!getSupabaseConfig()) return;
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: "local" });
}
