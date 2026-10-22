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
const mode = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.preprocess((v) => (v === "" ? undefined : v), z.enum(values).default(fallback));

export const ServerEnvSchema = z
  .object({
    NODE_ENV: mode(["development", "test", "production"] as const, "development"),
    NEXT_PUBLIC_APP_NAME: optional.default("HalaEvents"),
    NEXT_PUBLIC_APP_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_URL: optionalUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: optional,
    SUPABASE_SECRET_KEY: optional,
    AI_PROVIDER: mode(["mock", "gemini"] as const, "mock"),
    GEMINI_API_KEY: optional,
    GEMINI_MODEL: optional,
    EMAIL_PROVIDER: mode(["mock", "resend"] as const, "mock"),
    RESEND_API_KEY: optional,
    EMAIL_FROM: optional,
    WEATHER_PROVIDER: mode(["mock", "open-meteo"] as const, "mock"),
    PLACES_PROVIDER: mode(["mock", "none", "google"] as const, "mock"),
    GOOGLE_PLACES_API_KEY: optional,
  })
  .superRefine((env, ctx) => {
    const need = (when: boolean, keys: (keyof typeof env)[], reason: string) => {
      if (!when) return;
      for (const key of keys) {
        if (!env[key])
          ctx.addIssue({ code: "custom", path: [key], message: `required when ${reason}` });
      }
    };
    need(env.AI_PROVIDER === "gemini", ["GEMINI_API_KEY", "GEMINI_MODEL"], "AI_PROVIDER=gemini");
    // Same rule as GeminiModelName in src/lib/ai/gemini.ts: the id becomes part of the request path.
    if (env.GEMINI_MODEL && !/^[a-z0-9][a-z0-9.-]{0,79}$/.test(env.GEMINI_MODEL)) {
      ctx.addIssue({
        code: "custom",
        path: ["GEMINI_MODEL"],
        message: "must be a model id such as gemini-2.5-flash",
      });
    }
    need(
      env.EMAIL_PROVIDER === "resend",
      ["RESEND_API_KEY", "EMAIL_FROM"],
      "EMAIL_PROVIDER=resend",
    );
    need(env.PLACES_PROVIDER === "google", ["GOOGLE_PLACES_API_KEY"], "PLACES_PROVIDER=google");
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

export type IntegrationName = "ai" | "email" | "weather" | "places";

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
    ai: read("AI_PROVIDER", "mock"),
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
  ai: ["mock", "gemini"],
  email: ["mock", "resend"],
  weather: ["mock", "open-meteo"],
  places: ["mock", "none", "google"],
};
