/**
 * Runs once when the server starts. Validates the environment and fails fast in production on a
 * misconfiguration (e.g. EMAIL_PROVIDER=resend without a key). The error lists variable names and
 * reasons only, never values (event.md §9). In development it warns instead, so the app can still
 * open the /status page that explains the problem.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { inspectServerEnv } = await import("./lib/env.server");
  const report = inspectServerEnv();
  if (report.valid) {
    const mocked = report.integrations.filter((i) => i.mock).map((i) => i.name);
    if (mocked.length > 0)
      console.warn(
        `[halaevents] test mode active for: ${mocked.join(", ")} (results are labelled as test data)`,
      );
    return;
  }
  const lines = report.issues.map((i) => `  - ${i.variable}: ${i.message}`).join("\n");
  if (process.env.NODE_ENV === "production")
    throw new Error(`Invalid server environment:\n${lines}`);
  console.error(`[halaevents] Invalid server environment:\n${lines}`);
}
