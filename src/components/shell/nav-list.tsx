"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icon";
import { isActive, type NavItem } from "./nav";

export function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  const pathname = usePathname();
  return <NavLinks items={items} pathname={pathname} onNavigate={onNavigate} />;
}

/** Static variant (no active state) used as the Suspense fallback while the pathname resolves. */
export function NavLinks({
  items,
  pathname,
  onNavigate,
}: {
  items: NavItem[];
  pathname: string | null;
  onNavigate?: () => void;
}) {
  // The most specific matching item is active (e.g. /app/provider/requests over /app/provider).
  const active = pathname
    ? items
        .filter((i) => isActive(i.href, pathname))
        .sort((a, b) => b.href.length - a.href.length)[0]?.href
    : undefined;
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const current = item.href === active;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={current ? "page" : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                current
                  ? "bg-primary-soft text-primary"
                  : "text-ink-muted hover:bg-surface-muted hover:text-ink",
              )}
            >
              <Icon path={item.icon} />
              <span className="flex-1">{item.label}</span>
              {item.phase !== "live" && (
                <span className="text-[0.68rem] font-semibold text-ink-muted/80 tabular-nums">
                  {item.phase}
                </span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
