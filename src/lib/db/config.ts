/**
 * Public Supabase connection settings. Both values are public by design (RLS protects data).
 * Returns null when not configured, so the app can show a clear "not configured" state instead
 * of failing or faking authentication.
 */
export function getSupabaseConfig(): { url: string; key: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

/** Base URL used in auth emails. Never derived from the request's Host header. */
export function getAppUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}
