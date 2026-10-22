import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AuthShell, FormSkeleton } from "@/components/auth/auth-shell";
import { AuthNotConfigured } from "@/components/auth/not-configured";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { getSessionUser } from "@/lib/auth/session";
import { getSupabaseConfig } from "@/lib/db/config";

export const metadata: Metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <AuthShell title="Choose a new password" description="You'll stay signed in on this device.">
      <Suspense fallback={<FormSkeleton />}>
        <ResetPasswordContent />
      </Suspense>
    </AuthShell>
  );
}

async function ResetPasswordContent() {
  await connection();
  if (!getSupabaseConfig()) return <AuthNotConfigured />;
  // The emailed link signs the user in (recovery session) before landing here; without one
  // there is nothing to authorize the change, so start over.
  if (!(await getSessionUser())) redirect("/auth/error?reason=link_invalid");
  return <ResetPasswordForm />;
}
