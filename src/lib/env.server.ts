import "server-only";
import { z } from "zod";

/**
 * Server environment (event.md §9). Values are read only on the server and are never returned
 * to callers of `inspectServerEnv` — that report carries variable names and booleans only.
 *
 * Supabase variables are optional until P1 wires the database; P1 makes them required.
 */

type Source = Record<string, string | undefined>;

// `.env.example` ships `KEY=` lines, so treat empty strings as unset.
const optional = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().trim().min(1).optional(),
);
const optionalUrl = z.preprocess((v) => (v === "" ? undefined : v), z.url().optional());
// Mode names are case-insensitive ("RESEND" works like "resend").
const mode = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.preprocess(
    (v) => (v === "" ? undefined : typeof v === "string" ? v.trim().toLowerCase() : v),
    z.enum(values).default(fallback),
  );

const intIn = (min: number, max: number, fallback: number) =>
  z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.coerce.number().int().min(min).max(max).default(fallback),
  );

export const ServerEnvSchema = z
  .object({
    NODE_ENV: mode(["development", "test", "production"] as const, "development"),
    NEXT_PUBLIC_APP_NAME: optional.default("HalaEvents"),
    NEXT_PUBLIC_APP_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optional,
    SUPABASE_SECRET_KEY: optional,
    EMAIL_PROVIDER: mode(["mock", "resend"] as const, "mock"),
    RESEND_API_KEY: optional,
    EMAIL_FROM: optional,
    WEATHER_PROVIDER: mode(["mock", "open-meteo"] as const, "mock"),
    PLACES_PROVIDER: mode(["mock", "none", "google"] as const, "mock"),
    GOOGLE_PLACES_API_KEY: optional,
    // Vendor discovery (geocoding + places). Unset = the vendor search reports it isn't available.
    GEOAPIFY_API_KEY: optional,
    // Generated planning drafts (event.md §17.7). "none" = only template drafts are offered.
    // Names of removed providers (gemini, groq, xai, mock) in an old .env.local mean "none".
    AI_PROVIDER: z.preprocess(
      (v) =>
        typeof v === "string" && ["gemini", "groq", "xai", "mock"].includes(v.trim().toLowerCase())
          ? "none"
          : v,
      mode(["none", "cloudflare"] as const, "none"),
    ),
    CLOUDFLARE_ACCOUNT_ID: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z
        .string()
        .trim()
        .regex(/^[a-f0-9]{32}$/, "must be a 32-character Cloudflare account id")
        .optional(),
    ),
    CLOUDFLARE_API_TOKEN: optional,
    AI_PLAN_MODEL: z.preprocess(
      (v) => (v === "" ? undefined : v),
      z
        .string()
        .trim()
        .regex(/^@?[a-z0-9][a-z0-9@/._-]{2,120}$/i, "is not a model id")
        .optional(),
    ),
    // A cap, not a spend (billing counts generated tokens). 10-15 compact tasks ≈ 2.2k-3.8k tokens,
    // so 4096 leaves headroom; a draft cut off at the cap fails validation and is never saved.
    AI_PLAN_MAX_OUTPUT_TOKENS: intIn(256, 8192, 4096),
    AI_MAX_INPUT_CHARS: intIn(2000, 60000, 14000),
    AI_TIMEOUT_MS: intIn(5000, 120000, 45000),
    // "full": the model writes the whole custom draft; "hybrid": budget, schedule and requirements
    // come from the playbook engine (event.md §17.7–17.8).
    AI_PLAN_STRATEGY: mode(["full", "hybrid"] as const, "full"),
  })
  .superRefine((env, ctx) => {
    const need = (when: boolean, keys: (keyof typeof env)[], reason: string) => {
      if (!when) return;
      for (const key of keys) {
        if (!env[key])
          ctx.addIssue({ code: "custom", path: [key], message: `required when ${reason}` });
      }
    };
    need(
      env.EMAIL_PROVIDER === "resend",
      ["RESEND_API_KEY", "EMAIL_FROM"],
      "EMAIL_PROVIDER=resend",
    );
    need(env.PLACES_PROVIDER === "google", ["GOOGLE_PLACES_API_KEY"], "PLACES_PROVIDER=google");
    need(
      env.AI_PROVIDER === "cloudflare",
      ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "AI_PLAN_MODEL"],
      "AI_PROVIDER=cloudflare",
    );
  });

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

export interface EnvIssue {
  variable: string;
  message: string;
}

export class EnvError extends Error {
  constructor(readonly issues: EnvIssue[]) {
    super(
      `Invalid server environment:\n${issues.map((i) => `  - ${i.variable}: ${i.message}`).join("\n")}\n` +
        "See .env.example for the expected variables.",
    );
    this.name = "EnvError";
  }
}

function toIssues(error: z.ZodError): EnvIssue[] {
  // Messages come from our schema, not from the values, so they are safe to show.
  return error.issues.map((i) => ({ variable: String(i.path[0] ?? "(env)"), message: i.message }));
}

/** Parses and validates; throws `EnvError` listing variable names (never values). */
export function parseServerEnv(source: Source = process.env): ServerEnv {
  const result = ServerEnvSchema.safeParse(source);
  if (!result.success) throw new EnvError(toIssues(result.error));
  return result.data;
}

export type IntegrationName = "email" | "weather" | "places";

export interface IntegrationStatus {
  name: IntegrationName;
  mode: string;
  mock: boolean;
}

export interface EnvReport {
  valid: boolean;
  issues: EnvIssue[];
  supabase: { urlSet: boolean; publishableKeySet: boolean; secretKeySet: boolean };
  integrations: IntegrationStatus[];
}

const set = (v: string | undefined) => typeof v === "string" && v.trim() !== "";

/** Non-secret summary for the development status page. Contains no variable values. */
export function inspectServerEnv(source: Source = process.env): EnvReport {
  const result = ServerEnvSchema.safeParse(source);
  const read = (key: string, fallback: string) => (set(source[key]) ? source[key]! : fallback);
  const modes: Record<IntegrationName, string> = {
    email: read("EMAIL_PROVIDER", "mock"),
    weather: read("WEATHER_PROVIDER", "mock"),
    places: read("PLACES_PROVIDER", "mock"),
  };
  return {
    valid: result.success,
    issues: result.success ? [] : toIssues(result.error),
    supabase: {
      urlSet: set(source.NEXT_PUBLIC_SUPABASE_URL),
      publishableKeySet: set(source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
      secretKeySet: set(source.SUPABASE_SECRET_KEY),
    },
    integrations: (Object.keys(modes) as IntegrationName[]).map((name) => ({
      name,
      // Only known mode names are echoed back; anything else is reported as "invalid".
      mode: KNOWN_MODES[name].includes(modes[name]) ? modes[name] : "invalid",
      mock: modes[name] === "mock",
    })),
  };
}

const KNOWN_MODES: Record<IntegrationName, string[]> = {
  email: ["mock", "resend"],
  weather: ["mock", "open-meteo"],
  places: ["mock", "none", "google"],
};
