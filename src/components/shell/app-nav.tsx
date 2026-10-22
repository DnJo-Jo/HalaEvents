import { getMemberContext } from "@/modules/profiles/service";
import { MobileNav } from "./mobile-nav";
import { appNav, visibleNav } from "./nav";
import { NavLinks, NavList } from "./nav-list";

/** Items without an audience: safe to prerender before the session is known. */
export const publicNavItems = appNav.filter((i) => !i.audience);

export async function SidebarNav() {
  return <NavList items={visibleNav(await getMemberContext())} />;
}

export function SidebarNavFallback() {
  return <NavLinks items={publicNavItems} pathname={null} />;
}

export async function MobileNavServer() {
  return <MobileNav items={visibleNav(await getMemberContext())} />;
}
