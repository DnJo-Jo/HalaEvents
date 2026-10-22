import type {
  AccountRole,
  AccountStatus,
  ProviderModerationStatus,
  ProviderVerificationStatus,
} from "./schemas";

/**
 * Admin verification decisions (mirrored by provider_verification_admin_transition_allowed(),
 * migration 0004; tests/db/providers.test.ts checks every pair against the database).
 */
export const ADMIN_VERIFICATION_TRANSITIONS: Record<
  ProviderVerificationStatus,
  readonly ProviderVerificationStatus[]
> = {
  draft: [],
  submitted: ["verified", "rejected"],
  verified: [],
  rejected: [],
};

/** Admin moderation of a listing (mirrored by provider_moderation_transition_allowed()). */
export const MODERATION_TRANSITIONS: Record<
  ProviderModerationStatus,
  readonly ProviderModerationStatus[]
> = {
  active: ["hidden", "suspended"],
  hidden: ["active", "suspended"],
  suspended: ["active"],
};

export function canModerate(from: ProviderModerationStatus, to: ProviderModerationStatus): boolean {
  return MODERATION_TRANSITIONS[from].includes(to);
}

/** Shown in the marketplace only when verified, not moderated, and not paused by the owner. */
export function isPubliclyListed(p: {
  verification_status: ProviderVerificationStatus;
  moderation_status: ProviderModerationStatus;
  is_listed: boolean;
}): boolean {
  return p.verification_status === "verified" && p.moderation_status === "active" && p.is_listed;
}

/** Statuses from which a provider owner may submit for (re-)verification. */
export const OWNER_SUBMITTABLE: readonly ProviderVerificationStatus[] = ["draft", "rejected"];

export function canAdminTransition(
  from: ProviderVerificationStatus,
  to: ProviderVerificationStatus,
): boolean {
  return ADMIN_VERIFICATION_TRANSITIONS[from].includes(to);
}

export function requiredRoleForProviderKind(kind: "venue" | "service"): AccountRole {
  return kind === "venue" ? "venue_provider" : "service_provider";
}

export interface ProfileGate {
  account_status: AccountStatus;
  onboarded_at: string | null;
}

/** Where a signed-in member must go before using the app, or null if they may proceed. */
export function profileGateRedirect(
  profile: ProfileGate | null,
): "/onboarding" | "/account-status" | null {
  if (!profile || profile.account_status !== "active") return "/account-status";
  if (!profile.onboarded_at) return "/onboarding";
  return null;
}
