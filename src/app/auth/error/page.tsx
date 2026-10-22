import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell, FormSkeleton } from "@/components/auth/auth-shell";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { AUTH_ERROR_REASONS, type AuthErrorReason } from "@/modules/auth/rules";

export const metadata: Metadata = { title: "Sign-in problem" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default function AuthErrorPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <AuthShell title="We couldn't complete that">
      <Suspense fallback={<FormSkeleton />}>
        <Reason searchParams={searchParams} />
      </Suspense>
    </AuthShell>
  );
}

async function Reason({ searchParams }: { searchParams: SearchParams }) {
  const raw = (await searchParams).reason;
  // Only known reasons map to text; anything else gets the generic message (never echoed).
  const reason = (
    typeof raw === "string" && raw in AUTH_ERROR_REASONS ? raw : "link_invalid"
  ) as AuthErrorReason;
  const { title, body } = AUTH_ERROR_REASONS[reason];
  return (
    <div className="space-y-5">
      <Alert tone="warning" title={title}>
        {body}
      </Alert>
      <div className="flex flex-col gap-2">
        <ButtonLink href="/sign-in">Go to sign in</ButtonLink>
        <ButtonLink href="/" variant="ghost">
          Back to home
        </ButtonLink>
      </div>
    </div>
  );
}
