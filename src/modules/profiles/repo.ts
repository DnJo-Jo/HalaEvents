import "server-only";
import { z } from "zod";
import type { SupabaseServerClient } from "@/lib/db/server";
import { fromDbError } from "@/lib/errors";
import { AccountRole, AccountStatus, Locale } from "./schemas";

// Rows are parsed with Zod so a schema drift fails loudly instead of leaking undefined values.
// (Generated DB types arrive with `npm run db:types` once a local Supabase can run.)
const ProfileRow = z.object({
  user_id: z.string(),
  display_name: z.string().nullable(),
  phone: z.string().nullable(),
  locale: Locale,
  account_status: AccountStatus,
  status_reason: z.string().nullable(),
  onboarded_at: z.string().nullable(),
});
export type ProfileRow = z.infer<typeof ProfileRow>;

const PROFILE_COLUMNS =
  "user_id, display_name, phone, locale, account_status, status_reason, onboarded_at";

export async function getProfile(
  db: SupabaseServerClient,
  userId: string,
): Promise<ProfileRow | null> {
  const { data, error } = await db
    .from("profiles")
    .select(PROFILE_COLUMNS)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw fromDbError(error);
  return data ? ProfileRow.parse(data) : null;
}

export async function getRoles(db: SupabaseServerClient, userId: string): Promise<AccountRole[]> {
  const { data, error } = await db.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw fromDbError(error);
  return z
    .array(z.object({ role: AccountRole }))
    .parse(data)
    .map((r) => r.role);
}

export async function isPlatformAdmin(db: SupabaseServerClient): Promise<boolean> {
  const { data, error } = await db.rpc("is_platform_admin");
  if (error) throw fromDbError(error);
  return data === true;
}

export async function completeOnboarding(
  db: SupabaseServerClient,
  input: { displayName: string; phone?: string; locale: string; roles: AccountRole[] },
): Promise<void> {
  // The RPC acts on auth.uid() — there is no user id parameter to tamper with.
  const { error } = await db.rpc("complete_onboarding", {
    p_display_name: input.displayName,
    p_phone: input.phone ?? null,
    p_locale: input.locale,
    p_roles: input.roles,
  });
  if (error) throw fromDbError(error);
}

export async function updateProfile(
  db: SupabaseServerClient,
  userId: string,
  input: { displayName: string; phone?: string; locale: string },
): Promise<void> {
  const { data, error } = await db
    .from("profiles")
    .update({ display_name: input.displayName, phone: input.phone ?? null, locale: input.locale })
    .eq("user_id", userId)
    .select("user_id");
  if (error) throw fromDbError(error);
  // RLS turns a forbidden update into "0 rows" rather than an error; surface it.
  if (!data || data.length === 0) throw fromDbError({ code: "42501" });
}

export async function addRoles(
  db: SupabaseServerClient,
  userId: string,
  roles: AccountRole[],
): Promise<void> {
  if (roles.length === 0) return;
  const { error } = await db.from("user_roles").upsert(
    roles.map((role) => ({ user_id: userId, role })),
    { onConflict: "user_id,role", ignoreDuplicates: true },
  );
  if (error) throw fromDbError(error);
}

export async function removeRoles(
  db: SupabaseServerClient,
  userId: string,
  roles: AccountRole[],
): Promise<void> {
  if (roles.length === 0) return;
  const { error } = await db.from("user_roles").delete().eq("user_id", userId).in("role", roles);
  if (error) throw fromDbError(error);
}
