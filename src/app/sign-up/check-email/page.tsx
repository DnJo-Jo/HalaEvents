import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/auth-shell";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Check your email" };

export default function CheckEmailPage() {
  return (
    <AuthShell
      title="Check your email"
      description="If this address can be registered, we've sent a confirmation link to it."
    >
      <div className="space-y-4 text-sm text-ink-muted">
        <p>
          Open the link to confirm your address, then finish setting up your profile. The link works
          once and expires after an hour.
        </p>
        <p>Nothing arrived? Check spam, or try signing in to request a new link.</p>
        <ButtonLink href="/sign-in" variant="secondary" className="w-full">
          Go to sign in
        </ButtonLink>
      </div>
    </AuthShell>
  );
}
