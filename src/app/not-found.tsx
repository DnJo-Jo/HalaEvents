import type { Metadata } from "next";
import { ButtonLink } from "@/components/ui/button";
import { LogoMark } from "@/components/shell/logo";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-dvh items-center justify-center px-4 py-16">
      <div className="max-w-md text-center motion-safe:animate-rise">
        <LogoMark className="mx-auto size-10" />
        <p className="mt-6 text-sm font-semibold text-primary">404</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">This page doesn’t exist</h1>
        <p className="mt-3 text-ink-muted">
          The link may be mistyped, or the page may have moved. Nothing was changed.
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <ButtonLink href="/">Back to home</ButtonLink>
          <ButtonLink href="/app" variant="secondary">
            Go to the app
          </ButtonLink>
        </div>
      </div>
    </main>
  );
}
