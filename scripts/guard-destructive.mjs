#!/usr/bin/env node
// Guard for destructive local-database scripts (`npm run db:reset`).
// `supabase db reset` DROPS the local database and re-applies migrations + seed. It must be run
// deliberately: pass --yes, and it is refused when the configured Supabase URL is not local.
import { spawnSync } from "node:child_process";

const [, , label, ...rest] = process.argv;
const confirmed = rest.includes("--yes") || process.env.HALAEVENTS_CONFIRM_DB_RESET === "yes";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const isLocal = url === "" || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test(url);

if (!isLocal) {
  console.error(`Refusing to run "${label}": NEXT_PUBLIC_SUPABASE_URL is not a local address.`);
  process.exit(1);
}
if (!confirmed) {
  console.error(
    `"${label}" deletes the local database and re-seeds it.\n` +
      `Run it deliberately:  npm run db:reset -- --yes`,
  );
  process.exit(1);
}
const args = rest.filter((a) => a !== "--yes");
const r = spawnSync("npx", ["supabase", "db", "reset", ...args], { stdio: "inherit" });
process.exit(r.status ?? 1);
