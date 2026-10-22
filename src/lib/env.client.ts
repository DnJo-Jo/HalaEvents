/**
 * Public configuration. Only NEXT_PUBLIC_* names may appear in this file (enforced by a unit test);
 * each is referenced literally so Next.js can inline it at build time.
 */
export const clientEnv = {
  appName: process.env.NEXT_PUBLIC_APP_NAME || "HalaEvents",
  appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  supabasePublishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
} as const;
