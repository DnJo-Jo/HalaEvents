import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { AuthShell, FormSkeleton } from "@/components/auth/auth-shell";
import { AuthNotConfigured } from "@/components/auth/not-configured";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { getSupabaseConfig } from "@/lib/db/config";

export const metadata: Metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      title="Reset your password"
      description="Enter your account email and we'll send you a link."
      footer={
        <Link
          href="/sign-in"
          className="font-medium text-primary underline-offset-2 hover:underline"
        >
          Back to sign in
        </Link>
      }
    >
      <Suspense fallback={<FormSkeleton />}>
        <ForgotPasswordContent />
      </Suspense>
    </AuthShell>
  );
}

async function ForgotPasswordContent() {
  await connection(); // config is request-time data, never prerendered
  if (!getSupabaseConfig()) return <AuthNotConfigured />;
  return <ForgotPasswordForm />;
}
