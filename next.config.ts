import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

function origin(value: string | undefined): string | undefined {
  try {
    return value ? new URL(value).origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Content-Security-Policy (event.md §5.7). `script-src` keeps 'unsafe-inline' because Next's
 * inline bootstrap scripts need a per-request nonce, which would make every page dynamic and
 * conflicts with cacheComponents; the other directives still block framing, plugins, foreign
 * form posts and foreign network calls. React escapes all rendered text, and no page uses
 * dangerouslySetInnerHTML (pinned by tests/unit/security).
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${origin(process.env.NEXT_PUBLIC_SUPABASE_URL) ?? ""}${isDev ? " ws:" : ""}`.trim(),
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=15552000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  // Server Action bodies are small text forms: cap them well below an abuse-sized payload.
  experimental: { serverActions: { bodySizeLimit: "256kb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
