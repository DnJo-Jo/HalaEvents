# HalaEvents — Progress

## Status legend
✅ done & verified · 📝 documented only · 🚧 in progress · ⏳ not started

## Phase 1 — Architecture & plan (2026-10-21) 📝
- ✅ Project folder renamed `EventPilot/` → `HalaEvents/`; product name is HalaEvents everywhere in the repo.
- ✅ `git init` (branch `master`, no commits yet).
- 📝 `CLAUDE.md`, `event.md` (architecture, modules, data model, status models, security, AI adapter, mock mode, API boundaries).
- 📝 `docs/IMPLEMENTATION_PLAN.md` (phases P0–P11, ownership, acceptance criteria, test commands).
- 📝 `.env.example` (names only, no secrets), `.gitignore`.
- 📝 Review pass: shared Zod schemas + approval action types (`event.md` §10.1), per-module acceptance/test table.
- 📝 Reconciliation pass (same day): architecture checked against the partial scaffold — `event.md` §2.5 (Next 16
  constraints: `proxy.ts`, `cacheComponents` caching rule), §5.2 (admin client limited to seed/tests; public registration
  via `anon`-granted RPC), §5.4 (RPC grants, uniqueness constraints, two-phase approval execution), §9 (env validation), §12 (repo findings).
- Nothing is implemented or tested. No command was run successfully: the dependency install is incomplete.

## Phase 2 — Application foundation & design system (2026-10-21) ✅
Covers P0 steps 1–4 and 6, plus UI foundation. Business modules: none implemented.
- ✅ Clean reinstall → `package-lock.json` (445 packages); `npm ci` reproduces it. No dependency added.
- ✅ Next 16 docs read; `cacheComponents`, `partialPrefetching`, Tailwind Turbopack loader confirmed and kept (`event.md` §2.5).
- ✅ Design tokens (light + dark), motion with reduced-motion support, accessibility rules (`event.md` §13).
- ✅ Components: Button/ButtonLink, Input/Textarea/Select, FormField, Card, Badge (+Mock/Demo), Dialog, ConfirmDialog, Table,
  Spinner, Skeleton, EmptyState, Alert, PageHeader, Icon.
- ✅ Pages: landing `/`, app shell `/app` + 7 labelled placeholder sections, `/sign-in` placeholder (no form), `/status`,
  `/api/health`, `/design-system`; root + `/app` `error.tsx`/`not-found.tsx`, `global-error.tsx`, `/app/loading.tsx`.
- ✅ Server env validation (`src/lib/env.server.ts`) and public env (`src/lib/env.client.ts`).
- ⏳ Not done (moved to start of P1): Supabase/Playwright deps and scripts, `supabase init`, ESLint import restrictions, `errors.ts`/`http.ts`.

### Command results (2026-10-21, Node 24.21.0, npm 11.19.0)
| Command | Result |
|---|---|
| `rm -rf node_modules && npm install` | ✅ added 445 packages; 5 high audit findings (dev-only `braces` via `eslint-config-next`, fix would downgrade to v14; not applied); npm warned that `unrs-resolver` postinstall is not in allowScripts |
| `npm ci` | ✅ added 445 packages in 13s |
| `npm run lint` | ✅ no problems |
| `npm run typecheck` | ✅ no errors |
| `npm run format:check` | ✅ all files formatted (after one `prettier --write` on the new files) |
| `npm test` | ✅ 5 files, 73 tests passed |
| `npm run build` | ✅ compiled; 16 routes (static `/`, `/sign-in`, `/design-system`; partial prerender `/app/**`, `/status`; dynamic `/api/health`) |
| `npm run verify` (all of the above) | ✅ passed, twice (after install and after `npm ci`) |
| Smoke: `next start` + curl | ✅ all 12 pages 200; `/does-not-exist` and `/app/nope` 404; `/api/health` 200 `no-store`, details hidden in production |
| Smoke: `next dev` + curl | ✅ pages 200, no warnings in log; `/status` shows the 4 integrations as mock |
| Not run | `test:db`, `test:e2e` (scripts don't exist yet); no browser/screen-reader manual check, no Lighthouse/axe run |

## Phase 3 — Authentication, authorization & database (2026-10-21) 🚧
Implemented and tested **locally**. Not verified against a live Supabase project: no credentials, and Docker isn't accessible.
- ✅ Dependencies added: `@supabase/ssr@0.12.7`, `@supabase/supabase-js@2.118.0` (runtime); `supabase@2.121.0` (CLI),
  `@electric-sql/pglite@0.5.11` (dev; justification: runs migrations + RLS tests without Docker). Audit unchanged (5 dev-only).
- ✅ `npx supabase init` → `supabase/config.toml` hardened; `supabase/templates/confirmation.html`; `supabase/seed.sql` (no data).
- ✅ Auth: sign-up, email confirmation route, sign-in, resend link, sign-out, proxy session refresh + protected-route redirects,
  `getClaims()`-verified identity, safe `next` redirects, onboarding (profile completion), account-status page, settings (profile + roles).
- ✅ Roles: organizer / venue provider / service provider (multi, self-service) + platform admin (separate table, no API write path).
  Moderation (`account_status`) and provider verification are separate states.
- ✅ Two security bugs found by tests and fixed: (1) all RPCs were executable by `anon` (schema-scoped default-privilege revoke doesn't
  remove PUBLIC EXECUTE); (2) a build without Supabase env prerendered "not configured" into static `/sign-up` HTML.

### Migration status
| Migration | Applied on PGlite (tests) | Applied on real Supabase |
|---|---|---|
| `20261021000001_accounts.sql` | ✅ every test run | ⏳ never (no project / Docker) |
| `20261021000002_providers.sql` | ✅ every test run | ⏳ never |
| `20261021000003_events.sql` | ✅ every test run | ⏳ never |

### Command results (2026-10-21)
| Command | Result |
|---|---|
| `npm install` (new deps) | ✅ |
| `npx supabase --version` / `init` | ✅ 2.121.0 / config created |
| `docker ps` | ❌ permission denied on `/var/run/docker.sock` → `supabase start`/`db reset`/`gen types` **not run** |
| `npm run test:db` (PGlite) | ✅ 4 files, 81 tests (after fixing the anon-EXECUTE finding: first run 3 failed) |
| `npm test` (unit + db) | ✅ 14 files, 209 tests |
| `npm run verify` | ✅ lint, typecheck, format, 209 tests, build (22 routes + proxy; session routes partial-prerendered) |
| Smoke, no Supabase env | ✅ `/app`, `/app/settings`, `/onboarding`, `/account-status` → 307 to `/sign-in?next=…`; sign-in shows "not configured"; `/api/health` 503 degraded; `/auth/error?reason=<script>` not echoed |
| Smoke, unreachable Supabase URL | ✅ sign-in form renders; forged `sb-…-auth-token` cookie → still redirected to sign-in |
| Live sign-up / email / sign-in | ⏳ **not run** — no Supabase project |

## Phase 4 — Provider marketplace (2026-10-21) 🚧
Implemented and tested **locally** (PGlite + unit/render tests). Still no live Supabase. No new dependencies.
- ✅ Migration `20261021000004_marketplace.sql`: richer provider profiles, venue details, services, credentials, **moderation split out of
  verification** (data migrated), shortlists, service requests, invites, question threads, quotes, `search_providers()`, transition functions.
- ✅ Seed: 8 clearly labelled demo providers (`is_demo`, "Demo …", no members, can't receive requests).
- ✅ UI: marketplace directory + detail, minimal events, request creation + organizer comparison, provider onboarding/management,
  provider inbox + quote/response, admin review queue + decisions. Role-aware navigation.
- ⏳ Not done: bookings and reviews (P10, need approvals P7), credential file uploads (Storage), weighted match ranking, invite-more-providers UI
  (RPC `invite_providers` exists, no button), provider staff invitations, adaptive interview (P2).

### Migration status
| Migration | PGlite (tests) | Real Supabase |
|---|---|---|
| `…0001_accounts.sql` | ✅ | ⏳ never |
| `…0002_providers.sql` | ✅ | ⏳ never |
| `…0003_events.sql` | ✅ | ⏳ never |
| `…0004_marketplace.sql` | ✅ (edited in place this session; it had never been applied outside tests) | ⏳ never |

### Command results (2026-10-21)
| Command | Result |
|---|---|
| `docker ps` | ❌ permission denied (unchanged) |
| `npm run test:db` | ✅ 5 files, 125 tests (marketplace: 26; first run all passed, so a mutation check was run: weakening `quotes_select` fails 3) |
| `npm run test:unit` | ✅ 13 files, 162 tests (2 fixture mistakes fixed during development, no app bugs) |
| `npm run verify` | ✅ lint (0 problems after fixing 2 `Date.now()` purity errors), typecheck, format, 287 tests, build (33 routes + proxy) |
| Smoke, production, no Supabase | ✅ all new `/app/**` routes → 307 to `/sign-in?next=…` (target preserved) |
| Signed-in pages against a real database | ⏳ **not run** |

## Implementation phases
| Phase | Status |
|---|---|
| P0 Scaffold & tooling | 🚧 mostly done (see Phase 2 above); remaining items move to the start of P1 |
| P1 DB, auth, RLS, audit | 🚧 built + locally tested; live Supabase verification pending |
| P2 Events & interview | 🚧 minimal events only (create/list/detail); interview ⏳ |
| P3 AI adapter & plan | ⏳ |
| P4 Tasks & dependencies | ⏳ |
| P5 Compliance | ⏳ |
| P6 Attendees & applications | ⏳ |
| P7 Communications & approvals | ⏳ |
| P8 Incidents & re-plan | ⏳ |
| P9 Providers & marketplace | 🚧 built + locally tested |
| P10 Quotes, bookings, reviews | 🚧 requests + quotes built + locally tested; bookings/reviews ⏳ |
| P11 Seed, e2e, demo | ⏳ |

## Known conflicts / deviations from the source report
See `docs/SESSION_HANDOFF.md` §Conflicts.
