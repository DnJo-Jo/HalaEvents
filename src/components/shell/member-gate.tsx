import type { ReactNode } from "react";
import { requireMember } from "@/modules/profiles/service";

/**
 * Server-side gate for the member area: verified session, active account, finished onboarding.
 * Pages that read or change data must still authorize their own operations (services + RLS).
 */
export async function MemberGate({ children }: { children: ReactNode }) {
  await requireMember();
  return <>{children}</>;
}
