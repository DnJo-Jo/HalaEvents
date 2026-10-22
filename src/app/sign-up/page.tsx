import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AuthShell, FormSkeleton } from "@/components/auth/auth-shell";
import { AuthNotConfigured } from "@/components/auth/not-configured";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { getSessionUser } from "@/lib/auth/session";
import { getSupabaseConfig } from "@/lib/db/config";

export const metadata: Metadata = { title: "Create an account" };

export default function SignUpPage() {
  return (
    <AuthShell
      title="Create your account"
      description="One account for organizing events and offering venues or services."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <Suspense fallback={<FormSkeleton />}>
        <SignUpContent />
      </Suspense>
    </AuthShell>
  );
}

async function SignUpContent() {
  await connection(); // config and session are request-time data, never prerendered
  if (!getSupabaseConfig()) return <AuthNotConfigured />;
  if (await getSessionUser()) redirect("/app");
  return <SignUpForm />;
}
