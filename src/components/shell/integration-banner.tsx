import { connection } from "next/server";
import Link from "next/link";
import { inspectServerEnv } from "@/lib/env.server";

/** Global banner when any integration runs in mock mode (event.md §8). Evaluated per request. */
export async function IntegrationBanner() {
  await connection();
  const mocked = inspectServerEnv().integrations.filter((i) => i.mock);
  if (mocked.length === 0) return null;
  return (
    <div className="border-b border-line bg-warning-soft/60 px-4 py-2 sm:px-6">
      <p className="text-xs text-ink">
        <span className="font-semibold">Mock mode:</span> {mocked.map((i) => i.name).join(", ")}{" "}
        results are simulated.{" "}
        <Link href="/status" className="font-medium underline underline-offset-2">
          Details
        </Link>
      </p>
    </div>
  );
}
