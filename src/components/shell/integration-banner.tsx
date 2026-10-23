import { connection } from "next/server";
import { inspectServerEnv, type IntegrationName } from "@/lib/env.server";

const SIMULATED: Record<IntegrationName, string> = {
  email: "emails are not delivered",
  weather: "weather shows sample data",
  places: "venue search shows sample data",
};

/** Global banner while an integration runs in test mode (event.md §8). Evaluated per request. */
export async function IntegrationBanner() {
  await connection();
  const mocked = inspectServerEnv().integrations.filter((i) => i.mock);
  if (mocked.length === 0) return null;
  return (
    <div className="border-b border-line bg-warning-soft/60 px-4 py-2 sm:px-6">
      <p className="text-xs text-ink">
        <span className="font-semibold">Test mode:</span>{" "}
        {mocked.map((i) => SIMULATED[i.name]).join(", ")}.
      </p>
    </div>
  );
}
