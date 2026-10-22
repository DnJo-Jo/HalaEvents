import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthShell, FormSkeleton } from "@/components/auth/auth-shell";
import { Alert } from "@/components/ui/alert";
import { SubmitButton } from "@/components/ui/submit-button";
import { signOutAction } from "@/modules/auth/actions";
import { getMemberContext } from "@/modules/profiles/service";

export const metadata: Metadata = { title: "Account status" };

export default function AccountStatusPage() {
  return (
    <AuthShell title="Account status">
      <Suspense fallback={<FormSkeleton />}>
        <StatusContent />
      </Suspense>
    </AuthShell>
  );
}

async function StatusContent() {
  const ctx = await getMemberContext();
  if (ctx && ctx.profile.account_status === "active")
    redirect(ctx.profile.onboarded_at ? "/app" : "/onboarding");
  const status = ctx?.profile.account_status;
  return (
    <div className="space-y-5">
      <Alert
        tone="warning"
        title={
          status === "suspended"
            ? "Your account is suspended"
            : status === "deactivated"
              ? "Your account is deactivated"
              : "Your profile could not be loaded"
        }
      >
        {status
          ? "You can't make changes while your account is not active. Contact the HalaEvents team if you think this is a mistake."
          : "Please sign out and sign in again. If this keeps happening, contact the HalaEvents team."}
        {ctx?.profile.status_reason && (
          <span className="mt-2 block">Reason: {ctx.profile.status_reason}</span>
        )}
      </Alert>
      <form action={signOutAction}>
        <SubmitButton variant="secondary" className="w-full">
          Sign out
        </SubmitButton>
      </form>
    </div>
  );
}
