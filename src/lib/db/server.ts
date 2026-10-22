import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { AppError } from "@/lib/errors";
import { getSupabaseConfig } from "./config";

/**
 * Per-request Supabase client acting as the signed-in user (publishable key + session cookie),
 * so every query is subject to RLS. Never share it across requests.
 *
 * There is deliberately no service-role client in application code (event.md §5.2).
 */
export async function createSupabaseServerClient() {
  const config = getSupabaseConfig();
  if (!config) throw new AppError("not_configured", "Supabase is not configured.");
  const cookieStore = await cookies();
  return createServerClient(config.url, config.key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet)
            cookieStore.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. src/proxy.ts refreshes
          // the session on every request, so nothing is lost.
        }
      },
    },
  });
}

export type SupabaseServerClient = Awaited<ReturnType<typeof createSupabaseServerClient>>;
