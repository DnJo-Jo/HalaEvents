import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appNav, isActive } from "@/components/shell/nav";

const appDir = join(process.cwd(), "src/app");

function pageExists(href: string): boolean {
  const path = href.split("#")[0].split("?")[0];
  if (path.startsWith("/api/")) return existsSync(join(appDir, path, "route.ts"));
  return existsSync(join(appDir, path, "page.tsx"));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

describe("navigation", () => {
  it("covers every section required by the brief", () => {
    expect(appNav.map((i) => i.label)).toEqual([
      "Overview",
      "Events",
      "Marketplace",
      "My business",
      "Quote requests",
      "Tasks",
      "Attendees",
      "Messages",
      "Compliance",
      "Provider review",
      "Settings",
    ]);
  });

  it.each(appNav.map((i) => i.href))("%s resolves to a page file", (href) => {
    expect(pageExists(href)).toBe(true);
  });

  it("every internal href literal in src/ resolves to a page or route", () => {
    const hrefs = new Set<string>();
    for (const file of sourceFiles(join(process.cwd(), "src"))) {
      for (const m of readFileSync(file, "utf8").matchAll(/href[=:]\s*"(\/[^"]*)"/g))
        hrefs.add(m[1]);
    }
    expect(hrefs.size).toBeGreaterThan(5);
    const broken = [...hrefs].filter((h) => !pageExists(h));
    expect(broken).toEqual([]);
  });

  it("marks Overview active only on /app, other items on their subtree", () => {
    expect(isActive("/app", "/app")).toBe(true);
    expect(isActive("/app", "/app/events")).toBe(false);
    expect(isActive("/app/events", "/app/events/123")).toBe(true);
    expect(isActive("/app/events", "/app/eventsx")).toBe(false);
  });
});

describe("role-aware navigation", () => {
  it("shows provider items only to providers and admin items only to admins", async () => {
    const { visibleNav } = await import("@/components/shell/nav");
    const labels = (ctx: { roles: string[]; isAdmin: boolean } | null) =>
      visibleNav(ctx).map((i) => i.label);
    expect(labels({ roles: ["organizer"], isAdmin: false })).not.toContain("My business");
    expect(labels({ roles: ["organizer"], isAdmin: false })).not.toContain("Provider review");
    expect(labels({ roles: ["service_provider"], isAdmin: false })).toContain("Quote requests");
    expect(labels({ roles: [], isAdmin: true })).toContain("Provider review");
    expect(labels(null)).not.toContain("Provider review");
  });
});
