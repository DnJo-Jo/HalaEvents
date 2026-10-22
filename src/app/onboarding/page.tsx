import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthShell, FormSkeleton } from "@/components/auth/auth-shell";
import { OnboardingForm } from "@/components/profile/onboarding-form";
import { getMemberContext } from "@/modules/profiles/service";

export const metadata: Metadata = { title: "Set up your profile" };

export default function OnboardingPage() {
  return (
    <AuthShell title="Set up your profile" description="A couple of details before you start.">
      <Suspense fallback={<FormSkeleton />}>
        <OnboardingContent />
      </Suspense>
    </AuthShell>
  );
}

async function OnboardingContent() {
  const ctx = await getMemberContext(); // redirects to sign-in without a verified session
  if (!ctx || ctx.profile.account_status !== "active") redirect("/account-status");
  if (ctx.profile.onboarded_at) redirect("/app");
  const defaultName = ctx.user.email?.split("@")[0] ?? "";
  return <OnboardingForm defaultName={defaultName} />;
}
