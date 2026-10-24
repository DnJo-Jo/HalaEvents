# CLAUDE.md — HalaEvents project rules

HalaEvents is an AI-assisted, approval-driven event planning and operations platform
(formerly drafted as "EventPilot AI"). Always use the name **HalaEvents** in code, UI, and docs.

## Read before working
1. `CLAUDE.md` (this file)
2. `event.md` — product spec, architecture, module boundaries, status models, security decisions
3. `docs/IMPLEMENTATION_PLAN.md` — ordered phases, ownership, acceptance criteria
4. `PROGRESS.md` — what is done / in progress
5. `docs/SESSION_HANDOFF.md` — where the last session stopped

## Non-negotiable rules
- One Next.js (App Router, TypeScript strict) app, one Supabase PostgreSQL database.
- Every protected operation is authorized **on the server** (service layer) *and* protected by
  row-level security. Never rely on UI hiding or client checks.
- No secrets in client bundles. Server-only modules start with `import "server-only"`.
  Only `NEXT_PUBLIC_*` variables may be read in client code, and none of them may be secret.
- Never commit `.env`, `.env.local`, keys, tokens, or real attendee data. `.env.example` holds names only.
- Validate every untrusted input (request bodies, query params, webhooks, retrieved web content,
  **and every generated plan**) with Zod and the deterministic rules before use.
- **AI only through the gateway** (`src/lib/ai/`, event.md §17.7). Provider code, hosts and AI env variables live only in
  `src/lib/ai/**` and `src/lib/env.server.ts`; no AI SDKs (fetch adapters only). One request per user action: no automatic
  retries, repair turns or silent fallback to the playbook engine. Model output is validated with Zod + the deterministic
  rules before anything is stored; budget arithmetic, dates and dependencies stay in code. Automated tests, builds and page
  loads never call a provider (fake `fetch` only). The playbook engine (`src/modules/planning/engine.ts`, `/playbooks`) stays
  as the explicitly labelled "template" mode. ESLint and `tests/unit/planning/engine.test.ts` enforce the boundaries.
  The `ai_*` table names are historical.
- Generated plans are a **suggestion**. They are stored as `proposed`/draft and only become authoritative
  after a deterministic rule check and, where required, organizer acceptance.
- Generated content must never mark a requirement as `verified_source`, change attendee status, send messages,
  accept quotes, or confirm bookings.
- Consequential actions (sending external messages, accepting quotes, cancelling bookings,
  applying a re-plan) go through the `approvals` gate and are written to `audit_log`.
- Capacity, booking and approval-execution consistency is enforced in PostgreSQL functions/constraints,
  not in application-level read-then-write code.
- Never claim a permit was filed/approved, a venue is available, or a booking is confirmed unless a
  real party (provider user or integration) returned that result.
- Unavailable integrations run in clearly labelled **mock mode**; mock results carry `is_mock = true`.
- User-facing text is organizer-friendly: no provider names, diagnostics, env-var names or implementation notes in the UI.
- Prefer no new dependency. Adding one requires a one-line justification in the PR / PROGRESS.md.

## Code conventions
- Domain code lives in `src/modules/<module>/` (see `event.md` §Module structure).
  Per module: `schemas.ts` (Zod, shared client/server), `rules.ts` (pure deterministic logic),
  `repo.ts` (DB access, server-only), `service.ts` (authorization + orchestration, server-only).
- Route handlers in `src/app/api/**/route.ts` stay thin: parse → authorize → call service → map result.
- Errors returned as `{ error: { code, message, details? } }`.
- Timestamps stored as `timestamptz` (UTC); events carry an IANA `timezone`.
- UUID primary keys; status columns constrained by CHECK or enum.

## Working process
- Do not report anything as tested unless the test command was actually run and passed; paste the result.
- At the end of every session update `PROGRESS.md` and `docs/SESSION_HANDOFF.md`.
- Commit only when asked. Do not push without permission.

## Commands
```
npm run dev         # local dev server (needs .env.local with Supabase URL + publishable key for sign-in)
npm run lint
npm run typecheck
npm run verify      # pre-merge gate: lint, typecheck, format:check, test, build
npm test            # all Vitest projects (unit + db)
npm run test:unit   # unit/component tests (jsdom)
npm run test:db     # migrations + RLS on PGlite (local, no Docker) — NOT a live Supabase
npm run db:start    # supabase start   (needs Docker)
npm run db:reset -- --yes   # supabase db reset (needs Docker; refuses without --yes or a non-local URL)
npm run db:types    # generate src/lib/db/types.gen.ts (needs Docker)
# test:e2e (Playwright) arrives in P11
```

## Database rules
- New migration = new file `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`; never edit an applied one.
- Every new table: RLS enabled, explicit (column-level where relevant) grants, no `anon` access unless documented.
- End every migration with `revoke execute on all functions in schema public from public, anon;` (event.md §14.4).
- SECURITY DEFINER functions must `set search_path = ''` and check `auth.uid()` / admin rights themselves.
