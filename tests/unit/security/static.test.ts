// @vitest-environment node
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { allowRequest } from "@/lib/rate-limit";

const root = process.cwd();
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const files = walk(join(root, "src")).map((p) => ({
  p: p.slice(root.length + 1),
  s: readFileSync(p, "utf8"),
}));

describe("static security checks (regression guards, not a security guarantee)", () => {
  it("no code renders raw HTML", () => {
    expect(files.filter((f) => f.s.includes("dangerouslySetInnerHTML")).map((f) => f.p)).toEqual(
      [],
    );
  });
  it("repo/service/action modules are server-only or 'use server'", () => {
    const bad = files
      .filter((f) =>
        /(^|\/)(repo|service|actions|booking-repo|booking-service|booking-actions)\.ts$/.test(f.p),
      )
      .filter((f) => !f.s.includes('import "server-only"') && !f.s.includes('"use server"'))
      .map((f) => f.p);
    expect(bad).toEqual([]);
  });
  it("the AI gateway is server-only (provider code and credentials never reach client bundles)", () => {
    const gateway = files.filter(
      (f) => f.p.startsWith("src/lib/ai/") && !f.p.endsWith("/types.ts"),
    );
    expect(gateway.length).toBeGreaterThan(0);
    expect(gateway.filter((f) => !f.s.includes('import "server-only"')).map((f) => f.p)).toEqual(
      [],
    );
    const clients = files.filter((f) => /^\s*["']use client["']/.test(f.s));
    expect(
      clients.filter((f) => /@\/lib\/ai\/|CLOUDFLARE_|AI_PLAN_/.test(f.s)).map((f) => f.p),
    ).toEqual([]);
  });
  it("secrets are read only in server-only modules, never via NEXT_PUBLIC_", () => {
    const secretNames = [
      "SUPABASE_SECRET_KEY",
      "RESEND_API_KEY",
      "GOOGLE_PLACES_API_KEY",
      "CLOUDFLARE_API_TOKEN",
    ];
    const leaks = files.filter(
      (f) =>
        secretNames.some((n) => f.s.includes(n)) &&
        !f.s.includes('import "server-only"') &&
        !f.p.endsWith("app/status/page.tsx"), // names a variable as a set/unset flag, never a value
    );
    expect(leaks.map((f) => f.p)).toEqual([]);
    expect(
      files
        .filter((f) => /NEXT_PUBLIC_\w*(SECRET|KEY_SECRET|API_KEY|SERVICE_ROLE)/.test(f.s))
        .map((f) => f.p),
    ).toEqual([]);
    const example = readFileSync(join(root, ".env.example"), "utf8");
    expect(example).not.toMatch(/NEXT_PUBLIC_\w*(SECRET|SERVICE_ROLE|API_KEY)/);
  });
  it("client components never import server-only modules", () => {
    const bad = files
      .filter((f) => /^\s*["']use client["']/.test(f.s))
      .filter((f) =>
        /from "@\/(modules\/[^"]*\/(repo|service)|lib\/db\/server|lib\/env\.server)"/.test(f.s),
      )
      .map((f) => f.p);
    expect(bad).toEqual([]);
  });
  it("only the integrations call external hosts", () => {
    const hosts = files
      .filter((f) =>
        /https:\/\/(?!example\.|www\.w3\.org|open-meteo\.com\/|claude\.com|www\.geoapify\.com\/|www\.google\.com\/maps)[a-z.-]+\.(com|ai|dev|io)\//.test(
          f.s,
        ),
      )
      .map((f) => f.p)
      .filter((p) => !p.startsWith("src/lib/integrations/") && !p.startsWith("src/lib/ai/"));
    expect(hosts).toEqual([]);
  });
  it("security headers are configured", () => {
    const cfg = readFileSync(join(root, "next.config.ts"), "utf8");
    for (const h of [
      "frame-ancestors 'none'",
      "X-Content-Type-Options",
      "bodySizeLimit",
      "poweredByHeader: false",
    ])
      expect(cfg).toContain(h);
  });
  it("server logs carry no request payloads", () => {
    const logs = files
      .filter((f) => /console\.(log|info|warn|error)\(/.test(f.s))
      .map((f) => f.p)
      .sort();
    expect(logs).toEqual([
      "src/components/error-panel.tsx",
      "src/instrumentation.ts",
      "src/modules/planning/service.ts",
      "src/modules/recovery/service.ts",
    ]);
  });
});

describe("rate limiter", () => {
  it("blocks after the limit and recovers after the window", () => {
    const k = "test:rl";
    expect([1, 2, 3].map((i) => allowRequest(k, 2, 1000, 1000 + i))).toEqual([true, true, false]);
    expect(allowRequest(k, 2, 1000, 5000)).toBe(true);
  });
});
