import "server-only";
import pkg from "../../package.json";
import { inspectServerEnv, type EnvReport } from "./env.server";

export interface HealthReport {
  status: "ok" | "degraded";
  app: string;
  version: string;
  time: string;
  /** Present outside production only. Contains names/booleans, never secret values. */
  details?: {
    environment: string;
    node: string;
    env: EnvReport;
    database: "not_configured" | "configured_unchecked";
    anyMock: boolean;
  };
}

/**
 * Builds the health report. "degraded" means the environment is invalid or Supabase (required for
 * sign-in) is not configured. The database is not probed — presence of settings only — so it is
 * reported as configured-but-unchecked at best.
 */
export function buildHealthReport(
  source: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): HealthReport {
  const env = inspectServerEnv(source);
  const report: HealthReport = {
    status: env.valid && env.supabase.urlSet && env.supabase.publishableKeySet ? "ok" : "degraded",
    app: "HalaEvents",
    version: pkg.version,
    time: now.toISOString(),
  };
  if (source.NODE_ENV === "production") return report;
  return {
    ...report,
    details: {
      environment: source.NODE_ENV ?? "development",
      node: process.version,
      env,
      database:
        env.supabase.urlSet && env.supabase.publishableKeySet
          ? "configured_unchecked"
          : "not_configured",
      anyMock: env.integrations.some((i) => i.mock),
    },
  };
}
