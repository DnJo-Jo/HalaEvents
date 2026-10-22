import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseConfig } from "@/lib/db/config";
import { createSupabaseServerClient } from "@/lib/db/server";
import { safeNextPath } from "@/modules/auth/rules";
import { EmailOtpType } from "@/modules/auth/schemas";

/**
 * Email confirmation landing. Supports the token_hash link from supabase/templates/confirmation.html
 * (verified server-side with verifyOtp) and the PKCE `code` link from the default Supabase template.
 * Redirects only to same-origin paths (safeNextPath).
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"), "/onboarding");
  const go = (path: string) => NextResponse.redirect(new URL(path, request.url));

  if (!getSupabaseConfig()) return go("/auth/error?reason=not_configured");

  const tokenHash = params.get("token_hash");
  const type = EmailOtpType.safeParse(params.get("type"));
  const code = params.get("code");
  const supabase = await createSupabaseServerClient();

  if (tokenHash && type.success) {
    const { error } = await supabase.auth.verifyOtp({ type: type.data, token_hash: tokenHash });
    return go(error ? "/auth/error?reason=link_invalid" : next);
  }
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    return go(error ? "/auth/error?reason=link_invalid" : next);
  }
  return go("/auth/error?reason=missing_token");
}
