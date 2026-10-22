import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AuthShell, FormSkeleton } from "@/components/auth/auth-shell";
import { AuthNotConfigured } from "@/components/auth/not-configured";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Alert } from "@/components/ui/alert";
import { getSessionUser } from "@/lib/auth/session";
import { getSupabaseConfig } from "@/lib/db/config";
import { safeNextPath } from "@/modules/auth/rules";

export const metadata: Metadata = { title: "Sign in" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default function SignInPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthShell
      title="Sign in"
      description="For organizers, venues and service providers."
      footer={
        <>
          New to HalaEvents?{" "}
          <Link
            href="/sign-up"
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            Create an account
          </Link>
        </>
      }
    >
      <Suspense fallback={<FormSkeleton />}>
        <SignInContent searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function SignInContent({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  await connection(); // config and session are request-time data, never prerendered
  const next = safeNextPath(first(sp.next));
  if (!getSupabaseConfig()) return <AuthNotConfigured />;
  if (await getSessionUser()) redirect(next);
  return (
    <div className="space-y-5">
      {first(sp.signed_out) && <Alert tone="success" title="You've been signed out." />}
      <SignInForm next={next} />
    </div>
  );
}
