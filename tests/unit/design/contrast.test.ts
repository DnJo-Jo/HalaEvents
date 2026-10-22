import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Parses the raw tokens in globals.css and checks WCAG 2.x contrast for the pairs the UI uses.
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

function tokens(block: string): Record<string, string> {
  return Object.fromEntries(
    [...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/g)].map((m) => [m[1], m[2]]),
  );
}
const light = tokens(
  css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme")),
);
const darkStart = css.indexOf("@media (prefers-color-scheme: dark)");
const dark = { ...light, ...tokens(css.slice(darkStart, css.indexOf("@theme inline"))) };

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

// [foreground, background, minimum]
const pairs: [string, string, number][] = [
  ["ink", "canvas", 7],
  ["ink", "surface", 7],
  ["ink-muted", "canvas", 4.5],
  ["ink-muted", "surface", 4.5],
  ["ink-muted", "surface-muted", 4.5],
  ["primary-ink", "primary", 4.5],
  ["primary", "surface", 4.5],
  ["primary", "primary-soft", 4.5],
  ["danger-ink", "danger", 4.5],
  ["accent", "accent-soft", 4.5],
  ["accent", "surface", 4.5],
  ["success", "success-soft", 4.5],
  ["warning", "warning-soft", 4.5],
  ["danger", "danger-soft", 4.5],
  ["info", "info-soft", 4.5],
  ["ink", "warning-soft", 4.5],
  // Non-text UI: input borders and focus ring need 3:1 (WCAG 1.4.11).
  ["line-strong", "surface", 3],
  ["ring", "canvas", 3],
  ["ring", "surface", 3],
];

describe.each([
  ["light", light],
  ["dark", dark],
])("%s theme contrast", (_name, t) => {
  it("defines every token used in the checks", () => {
    for (const [fg, bg] of pairs) {
      expect(t[fg], fg).toMatch(/^#/);
      expect(t[bg], bg).toMatch(/^#/);
    }
  });

  it.each(pairs)("%s on %s ≥ %d:1", (fg, bg, min) => {
    expect(ratio(t[fg], t[bg])).toBeGreaterThanOrEqual(min);
  });
});
