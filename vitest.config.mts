import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    // `server-only` throws outside a React Server environment; tests import server modules directly.
    alias: {
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "jsdom",
          include: ["tests/unit/**/*.test.{ts,tsx}", "src/**/*.test.{ts,tsx}"],
          setupFiles: ["./vitest.setup.ts"],
        },
      },
      {
        // Migrations + RLS on PGlite (local, in-process Postgres). Not a live Supabase.
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["tests/db/**/*.test.ts"],
          // Each file runs its own in-process Postgres (PGlite, a few hundred MB). Unbounded
          // parallelism ran a 7.5 GB dev machine out of memory (worker SIGKILL) on 2026-10-22.
          maxWorkers: 3,
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
