import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getSupabaseConfig } from "@/lib/db/config";
import { createSupabaseServerClient } from "@/lib/db/server";
import { safeNextPath } from "@/modules/auth/rules";

export interface SessionUser {
  id: string;
  email: string | null;
}

/**
 * The verified identity for this request, or null. `getClaims()` validates the access token's
 * signature (locally via JWKS for asymmetric keys, or against the Auth server otherwise) — unlike
 * `getSession()`, whose cookie contents must not be trusted. Cached per request.
 *
 * With email confirmations enabled (supabase/config.toml), Supabase issues no session before the
 * address is confirmed, so a non-null user here has a verified email.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  // Request-time only: without this, a build without Supabase env would prerender the
  // "no session" outcome into static HTML (Cache Components).
  await connection();
  if (!getSupabaseConfig()) return null;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (error || typeof sub !== "string" || sub.length === 0) return null;
  return { id: sub, email: typeof data?.claims.email === "string" ? data.claims.email : null };
});

/** Redirects to sign-in (returning to `next` afterwards) when there is no verified session. */
export async function requireUser(next = "/app"): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(safeNextPath(next))}`);
  return user;
}
