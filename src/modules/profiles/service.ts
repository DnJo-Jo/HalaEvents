import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { requireUser, type SessionUser } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError } from "@/lib/errors";
import * as repo from "./repo";
import { profileGateRedirect } from "./rules";
import { AccountRole, type OnboardingInput, type ProfileUpdateInput } from "./schemas";

export interface MemberContext {
  user: SessionUser;
  profile: repo.ProfileRow;
  roles: AccountRole[];
  isAdmin: boolean;
}

/** Loads the signed-in member's profile, roles and admin flag (all via RLS). Cached per request. */
export const getMemberContext = cache(async (): Promise<MemberContext | null> => {
  const user = await requireUser();
  const db = await createSupabaseServerClient();
  const [profile, roles, isAdmin] = await Promise.all([
    repo.getProfile(db, user.id),
    repo.getRoles(db, user.id),
    repo.isPlatformAdmin(db),
  ]);
  if (!profile) return null;
  return { user, profile, roles, isAdmin };
});

/**
 * Guard for the member area: signed in, account active, onboarding complete. Pages call this
 * themselves (Data Access Layer pattern) — the proxy redirect is only a convenience.
 */
export async function requireMember(): Promise<MemberContext> {
  const ctx = await getMemberContext();
  const target = profileGateRedirect(ctx?.profile ?? null);
  if (!ctx || target) redirect(target ?? "/account-status");
  return ctx;
}

export async function completeOnboarding(input: OnboardingInput): Promise<void> {
  await requireUser("/onboarding");
  const db = await createSupabaseServerClient();
  await repo.completeOnboarding(db, input);
}

export async function updateOwnProfile(input: ProfileUpdateInput): Promise<void> {
  const user = await requireUser("/app/settings");
  const db = await createSupabaseServerClient();
  await repo.updateProfile(db, user.id, input);
}

/** Replaces the caller's self-service roles. At least one role must remain. */
export async function setOwnRoles(next: AccountRole[]): Promise<void> {
  const user = await requireUser("/app/settings");
  const wanted = [...new Set(next.map((r) => AccountRole.parse(r)))];
  if (wanted.length === 0) throw new AppError("validation_failed", "Keep at least one role.");
  const db = await createSupabaseServerClient();
  const current = await repo.getRoles(db, user.id);
  await repo.addRoles(
    db,
    user.id,
    wanted.filter((r) => !current.includes(r)),
  );
  await repo.removeRoles(
    db,
    user.id,
    current.filter((r) => !wanted.includes(r)),
  );
}
