import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/shell/logo";
import { MemberGate } from "@/components/shell/member-gate";
import { MobileNavServer, SidebarNav, SidebarNavFallback } from "@/components/shell/app-nav";
import { IntegrationBanner } from "@/components/shell/integration-banner";
import { UserMenu, UserMenuSkeleton } from "@/components/shell/user-menu";
import AppLoading from "./loading";

export const metadata: Metadata = { title: { default: "Overview", template: "%s · HalaEvents" } };

/**
 * Authenticated application shell. The static chrome prerenders; everything that depends on the
 * session streams in behind Suspense (required with Cache Components). Access control:
 * src/proxy.ts redirects visitors without a session, MemberGate re-checks on the server, and
 * RLS applies to every query.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      <aside className="hidden border-r border-line bg-surface lg:flex lg:flex-col">
        <div className="flex h-16 items-center border-b border-line px-5">
          <Logo href="/app" />
        </div>
        <nav aria-label="Main" className="flex-1 overflow-y-auto p-3">
          <Suspense fallback={<SidebarNavFallback />}>
            <SidebarNav />
          </Suspense>
        </nav>
        <p className="m-3 rounded-md border border-line bg-surface-muted p-3 text-xs text-ink-muted">
          Phase tags show when each section is built. Untagged features are live.
        </p>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="relative z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6">
          <Suspense
            fallback={<span className="inline-block size-10 lg:hidden" aria-hidden="true" />}
          >
            <MobileNavServer />
          </Suspense>
          <div className="lg:hidden">
            <Logo href="/app" />
          </div>
          <div className="ml-auto">
            <Suspense fallback={<UserMenuSkeleton />}>
              <UserMenu />
            </Suspense>
          </div>
        </header>

        <Suspense fallback={null}>
          <IntegrationBanner />
        </Suspense>

        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8">
          <Suspense fallback={<AppLoading />}>
            <MemberGate>{children}</MemberGate>
          </Suspense>
        </main>
      </div>
    </div>
  );
}
