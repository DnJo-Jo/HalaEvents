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

## Phase 5 — P2 adaptive interview, deterministic first round (2026-10-22) 🚧
Implemented and tested **locally** (PGlite + unit/render tests). Still no live Supabase. No new dependencies.
- ✅ State at session start re-verified: clean tree at commit `01f6d60`; `npm run verify` passed (18 files, 287 tests) before any change.
- ✅ `PlaybookSchema` (`src/modules/ai/playbook.ts`): typed questions (single/multi choice, yes/no, number, text) with conditions on
  event facts or *earlier* answers only, so there are no cycles or dangling references; checked when the playbook is imported.
- ✅ Playbook `src/playbooks/university-hackathon.ts` (v1, 19 questions). Wording is planning prompts, not legal requirements.
- ✅ Pure rules `src/modules/events/interview-rules.ts`: condition evaluation, rounds of ≤ 5 new questions, dependent-chain hiding,
  stale-answer detection, Zod validation of every answer against its question, display formatting.
- ✅ Migration `20261022000001_interview.sql`: `interview_answers` + RPC `save_interview_answers` (owner/organizer, active account,
  event in draft/planning/ready; upsert + remove in one transaction). Members read; there is no direct write grant.
- ✅ UI `/app/events/[id]/interview` (form for managers, read-only for viewers/locked events) + "Planning interview" link on the event page.
- ✅ Bug found by a new test and fixed before commit: playbook validation accepted unknown `event.*` condition keys.
- ⏳ Not done (rest of P2): edit event details / status transitions UI (`UpdateEventInput`, `invalid_transition` → 409); API route handlers
  (`/api/events/**`). AI follow-up questions are P3.

### Migration status
| Migration | PGlite (tests) | Real Supabase |
|---|---|---|
| `…0001`–`…0004` | ✅ | ⏳ never |
| `20261022000001_interview.sql` | ✅ (new, never applied anywhere else) | ⏳ never |

### Command results (2026-10-22)
| Command | Result |
|---|---|
| `docker ps` | ❌ no access (unchanged); no `.env.local` |
| `npm run verify` (before changes) | ✅ 18 files, 287 tests, build OK |
| `vitest run tests/unit/events/interview.test.ts` | first run 1 failed (real bug above), then ✅ 27 |
| `vitest run --project db tests/db/interview.test.ts` | first run 1 failed (test mistake: empty payload never hits the CHECK), then ✅ 13 |
| Mutation check | letting any event member save → "viewers … cannot save" fails; migration restored, ✅ 13 again |
| `vitest run tests/unit/events/` | first run 1 failed (assertion wording), then ✅ 36 |
| `npm run verify` (final) | ✅ lint, typecheck, format, **21 files, 336 tests** (198 unit + 138 db), build (new route `◐ /app/events/[eventId]/interview`) |
| Smoke, `next start`, no Supabase env | ✅ `/app/events/<uuid>/interview` → 307 `/sign-in?next=…` (target kept); `/` 200 |
| Signed-in interview against a real database / browser | ⏳ **not run** |

## Phase 6 — P3 AI adapter & plan generation (2026-10-22) 🚧
Built in a session that was interrupted before its docs were written; reconciled and finished in the next session (same day).
Implemented and tested **locally** (fakes + PGlite). **No real Gemini call yet** (no key), no live Supabase. No new dependencies.
- ✅ Decision (user): **Gemini over REST, no SDK.** `src/lib/ai/gemini.ts` uses `fetch` to `generateContent` with JSON-schema output; key in a header.
- ✅ Shared client `src/lib/ai/client.ts`: timeout, one transient retry, no quota retries, Zod + business-rule validation, one repair turn, ≤ 3 calls.
- ✅ Deterministic mock provider (default `AI_PROVIDER=mock`): plan = playbook plan, results flagged `is_mock` and badged.
- ✅ Pipelines: plan (≤ 40 proposals, resolved deadlines, DAG + evidence checks), interview follow-ups (≤ 3 per run, `custom.*`), single-task revision.
- ✅ Playbook moved to JSON data `playbooks/university-hackathon.json` (v2: + 18 task templates, risks, unverified compliance topics, provider categories).
- ✅ Migration `20261022000002_ai.sql`: `ai_runs`, `ai_plans`, `ai_suggestions`, 6 RPCs, single flight, 20 runs/user/hour, audit triggers, RLS (no direct writes).
- ✅ UI: `/app/events/[id]/plan` (generate/regenerate, per-task revise/dismiss, evidence, warnings, Mock / "no AI" labels); follow-ups on the interview page.
- ✅ This session: ESLint guard (no Google SDK imports; Gemini host only in `gemini.ts`), `event.md` §17, docs reconciled.
- ⏳ Not done: real Gemini smoke test (`npm run test:ai-live`, needs `GEMINI_API_KEY` + `GEMINI_MODEL` in `.env.local`); accepting proposals into tasks (P4);
  P2 leftovers (event edit/status UI, `/api/events/**`).

### Migration status
| Migration | PGlite (tests) | Real Supabase |
|---|---|---|
| `…0001`–`…0004`, `20261022000001_interview.sql` | ✅ | ⏳ never |
| `20261022000002_ai.sql` | ✅ (new) | ⏳ never |

### Command results (2026-10-22, this session)
| Command | Result |
|---|---|
| `npm run typecheck`, `npm run lint` (state left by the interrupted session) | ✅ no errors |
| `npm run verify` | ✅ lint, typecheck, format, **26 files / 420 tests**, build (new route `◐ /app/events/[eventId]/plan`) |
| `npm run test:unit` / `npm run test:db` | ✅ 19 files / 266 tests · ✅ 7 files / 154 tests |
| `npm run test:ai-live` | ⏭ 1 test **skipped** (no Gemini key/model); no real Gemini request made |
| ESLint probe (temp file importing `@google/genai` + Gemini URL, then deleted) | ✅ 3 errors as intended; `npx eslint .` clean afterwards |
| `npm run verify` (final, after all changes) | ✅ exit 0, 420 tests, build OK |

## Phase 7 — Event workspace & compliance workflow (user's "Phase 6" brief, 2026-10-22) 🚧
Implemented and tested **locally** (PGlite + unit/render tests). No live Supabase, no browser walkthrough. No new dependencies.

**Real (works end to end in code, enforced in the DB):**
- ✅ Event edit page + lifecycle status change (only allowed transitions offered; service + trigger enforce).
- ✅ Tasks: create, status (deterministic transitions), owner (event managers only), deadline (event-timezone dates), dependencies with
  self/cross-event/cycle rejection (trigger with event lock + recursive check), blocked/overdue/due-soon derived, blocked tasks can't be done.
- ✅ Plan acceptance: `accept_ai_plan` turns proposals into tasks + dependencies in one transaction (the only AI → task path).
- ✅ Progress from persisted data; event timeline from the audit log (whitelisted fields, visible to all members).
- ✅ Compliance checks with ten states, reasons, applicability, reviewer, next action, references, evidence, audit history; human-only
  clearing (assigned reviewer or platform admin, real evidence, reason); "source-supported" only with a person-verified source.
- ✅ Deterministic concern detection from interview answers (permit, minors consent/overnight supervision, photo consent, food, prizes, campus policy).
- ✅ In-app notifications (missing info, possible concerns, deadlines, decisions, status changes) with accurate delivery status (`delivered` = in inbox, `read`).

**Curated:** 6 official sources (DET event permit, e-Permits registration, events & activations, ticketed events; DDA event permit; u.ae).
Checked 2026-10-22: DET pages return HTTP 403 to automated fetches (summaries are labelled search-result snippets); the DDA URL from the project
report is 404 (replaced by the URL web search returned, not fetched); u.ae fetched OK. **None is verified** until a platform admin does it.

**Simulated (labelled "Simulated · demo"):** official submissions (`DEMO-` references, CHECK forbids non-simulated rows) and official responses.
Nothing is transmitted; simulated evidence can't clear a check.

**Missing / not built:** live search or monitoring of sources; AI-assisted concern analysis; evidence file uploads; a scheduler for deadline
reminders (refreshed on organizer actions + a button); email/push delivery; `/api/**` route handlers for events/tasks/compliance; live Supabase verification.

- ✅ Bug found by a new test and fixed: platform admins (allowed by the DB to review) got a 404 from the check page/service.
- ✅ Test infrastructure: the full parallel run was SIGKILLed (out of memory) once two more PGlite test files existed; the db project now runs after
  the unit project with `maxWorkers: 3` (`vitest.config.mts`).

### Migration status
| Migration | PGlite (tests) | Real Supabase |
|---|---|---|
| `…0001`–`…0004`, `20261022000001`–`…0002` | ✅ | ⏳ never |
| `20261022000003_workspace.sql` | ✅ (new) | ⏳ never |
| `20261022000004_compliance.sql` (incl. source registry data) | ✅ (new) | ⏳ never |

### Command results (2026-10-22, this session)
| Command | Result |
|---|---|
| `curl`/fetch of the report's official URLs | DET ×3: HTTP 403; DDA: 404 (redirect to /en/404); u.ae: 200 |
| `vitest run --project db tests/db/workspace.test.ts` | ✅ 11 first run; mutation (cycle + blocked checks removed) → 2 fail; restored ✅ |
| `vitest run --project db tests/db/compliance.test.ts` | 1st: suite error (fixture: onboarding needs a role); 2nd: 1 fail (test called a non-existent helper); then ✅ 13; mutation (reviewer-only + real-evidence removed) → 4 fail; restored ✅ |
| + TS↔SQL parity tests | ✅ 26 (12 + 14) |
| `vitest run tests/unit/tasks tests/unit/compliance tests/unit/events/timeline.test.ts` | ✅ 20 |
| `vitest run tests/unit/workspace` | 1 fail (real bug: admin reviewer 404) → fixed → ✅ 16 |
| `npm run verify` (1st) | ❌ format (1 file) → fixed; (2nd) ❌ worker SIGKILL (out of memory) → `maxWorkers: 3` for db; (3rd) ❌ vitest requires a separate `groupOrder` → set |
| `npm run verify` (final) | ✅ lint, typecheck, format, **32 files / 483 tests** (303 unit + 180 db), build (new routes `◐ /app/events/[eventId]/{edit,tasks,compliance,compliance/[checkId]}`, `/app/compliance`, `/app/notifications`) |
| Smoke, `next start`, no Supabase env | ✅ all 8 new routes → 307 `/sign-in?next=…` |
| Signed-in pages against a real database / browser | ⏳ **not run** |

## Phase 8 — Bookings, attendees & communications (user's "Phase 7" brief, 2026-10-22) 🚧
Implemented and tested **locally** (PGlite + unit/render tests). No live Supabase, no real email sent, no real provider confirmation, no browser
walkthrough. No new dependencies (Resend is called over REST with `fetch`, like Gemini).

**Real (enforced in the database, tested):**
- ✅ Attendees: public registration (`/register/[slug]`, anon RPC, consent, rate limit, neutral response), capacity (accept → waitlist), duplicate
  prevention, optional application review (pending / needs information / approved / rejected), participation (accepted, waitlisted, rejected,
  confirmed, checked in, cancelled), withdrawal. Registration, review, participation and delivery are four separate states.
- ✅ Approvals: exact payload + sha256, requester/decider/executor/timestamps/result; edits or recipient changes supersede (fresh approval);
  exactly-once execution; stuck executions flagged, never auto-resent.
- ✅ Communications: persisted drafts for all ten kinds, audiences resolved in SQL, placeholders filled in code, AI drafts (validated, saved as
  drafts only), preview, approval, two-phase send, per-recipient delivery rows.
- ✅ Bookings: proposed (quote snapshot) → approval → awaiting provider → **provider-only** confirmation; cancellation of confirmed bookings via
  approval; completion after the service period; disputes resolved by platform admins; one live booking per quote/request; venue overlap refused.

**Simulated / mock:** email transport (default) records `simulated` deliveries and emails nobody; the UI says "Simulated — not sent".
The mock AI drafts a template. **Real but never exercised:** the Resend adapter (tested with a fake `fetch` only).
**Not built:** payments (out of scope), provider calendars, reviews, delivery/bounce webhooks, attendee self-service links, eligibility rules,
automatic waitlist promotion, scheduled reminders. Concurrency is only serialized on PGlite.

- ✅ Problems found and fixed while building: generic `request_approval`/`claim_approval` could bypass booking preconditions or strand a booking
  approval in "executing" (now refused); provider confirmation violated its own CHECK (order fixed); the public form's messages revealed
  whether an email was registered (now one message); the build failed because `/register/[slug]` read runtime data outside Suspense (wrapped).
- Schema test changed on purpose: anon may now execute exactly `register_attendee` and `public_event_by_slug` (allow-list pinned).

### Migration status
| Migration | PGlite (tests) | Real Supabase |
|---|---|---|
| `…0001`–`…0004`, `20261022000001`–`…0004` | ✅ | ⏳ never |
| `20261022000005_attendees.sql` | ✅ (new) | ⏳ never |
| `20261022000006_communications.sql` | ✅ (new) | ⏳ never |
| `20261022000007_bookings.sql` | ✅ (new) | ⏳ never |

### Command results (2026-10-22, this session)
| Command | Result |
|---|---|
| `vitest run --project db tests/db/schema.test.ts` | 1 fail (anon allow-list, intended change) → test narrowed to the 2 functions → ✅ |
| `vitest run --project db tests/db/{attendees,communications,bookings}.test.ts` | ✅ attendees 10 (12 after two added tests), communications 9, bookings 11 — every first run passed, hence the mutation checks |
| Mutation checks (cumulative: backups failed because the scratchpad dir was gone, so mutations stacked; restored by hand and re-verified) | hash check off → 4 fail; + capacity off → 6; + venue overlap off → 7; + provider membership off → 8; restored → ✅ 31 |
| `vitest run tests/unit/comms` | 1 fail (test mistake: identity lookup RPC counted as a write) → fixed → ✅ 23 |
| `npm run verify` (1st) | ❌ build: `/register/[slug]` uncached data outside Suspense → fixed |
| `npm run verify` (final) | ✅ lint, typecheck, format, **38 files / 540 tests** (328 unit + 212 db), build |
| Smoke, `next start`, no Supabase env | ✅ 7 new `/app/**` routes → 307 sign-in; `/register/campus-hack` → 200 with the "not configured" notice (public, not redirected) |
| Real email / real provider / browser | ⏳ **not run** |

## Phase 9 — Crisis recovery (P8) and post-event reviews (P10), 2026-10-22 🚧
Implemented and tested **locally** (PGlite + unit tests with a scripted AI provider). No live Supabase, **no real Gemini request**, nothing sent to anyone, no browser walkthrough. No new dependencies.

**Starting state found (not what the handoff said):** an interrupted session had left `20261022000008_recovery.sql` (~980 lines, applied by the DB harness on every run but untested) and `src/modules/recovery/schemas.ts`
(plus an unformatted playbook JSON); the handoff still said P8 was not started. Reviewed the migration, wrote its tests first: it needed **no logic fix** (all failures in the first runs were test-fixture mistakes);
only its header comment ("0012") was corrected.

**Crisis recovery (all simulated; `event.md` §23):**
- ✅ Simulation action (organizer/owner only), idempotent (event lock, key per booking+attempt, one active incident per booking), `is_simulated` CHECK-true, booking untouched, audit.
- ✅ Deterministic impact snapshot in SQL: venue tasks + transitive dependents, service bookings (flagged for reconfirmation, **never cancelled**), venue-related compliance checks, candidate venues (availability only "unknown"/"conflict recorded"), prices only from submitted quotes.
- ✅ AI pipeline `recovery` (Gemini REST adapter or deterministic mock): Zod + `validateProposal` + one repair turn + SQL re-check; no cancel/rebook/confirm capability exists in the schema or in `recovery_changes.kind`; failure stores nothing.
- ✅ Changes selectable; approval payload = selected changes + current state; execution in one transaction; changed state → superseded; inquiries recorded as `sent_simulated` only; attendee update forced to the mock transport (service + DB trigger).
- ✅ UI: list + simulate form, incident page (original plan/affected items, options, timeline, unresolved questions/risks, budget from quotes, change checklist, approval checklist, drafts, flags, close), event-page button, messages badge.
- ⏳ Not built: real incidents, dependency-order enforcement, team notifications. Not verified: real Gemini output for the nested schema.

**Reviews (`event.md` §24):**
- ✅ `create_review` only for completed bookings, one per booking+direction, conflict-of-interest and role checks, provider→organizer behind a platform setting (default off, admin-only, audited); verified status derived, not claimable.
- ✅ Public summaries/lists from SQL (published + booking still completed; empty history → "No reviews yet"; invisible provider → no rows); responses; reports/disputes; admin hide/restore and report resolution.
- ✅ UI: `/app/reviews`, `/app/admin/reviews`, Reviews card on provider pages. ⏳ Not built: edit/delete, review window, notifications, ratings in search ranking.

### Migration status
| Migration | PGlite (tests) | Real Supabase |
|---|---|---|
| `…0001`–`…0004`, `20261022000001`–`…0007` | ✅ | ⏳ never |
| `20261022000008_recovery.sql` | ✅ (tested this session; created by the interrupted one) | ⏳ never |
| `20261022000009_reviews.sql` | ✅ (new) | ⏳ never |

### Command results (2026-10-22, this session)
| Command | Result |
|---|---|
| `npm run verify` (start) | ❌ `format:check` (2 files); lint, typecheck ✅; `npm test` ✅ 38 files / 540 tests (before any change) |
| `prettier --write` on the playbook JSON and `recovery/schemas.ts` | ✅ whitespace only |
| `vitest run --project db tests/db/recovery.test.ts` | 1st: 5 failed + 3 suites (fixture mistakes: `input_hash` must be hex; invalid provider category; blocked-task status change) → fixed → ✅ 32 |
| Mutation check on 0008 (impact membership, payload re-check, skip→apply) | 7 DB tests failed; restored (byte-identical backup) → ✅ 32 |
| `vitest run tests/unit/recovery` | ✅ 46 (30 rules + 16 service); mutation: validation disabled in the service → 2 failed; restored ✅ |
| `vitest run --project db tests/db/reviews.test.ts` | 1st: 10 failed (real SQL bug: an aggregate without GROUP BY returns one row even when "not visible"; the rest cascaded from it) → functions rewritten → ✅ 35, then ✅ 36 with `my_reviews` |
| Mutation checks on 0009 (completion, provider-side conflict, platform policy, `published` filter), each alone | each failed ≥ 4 tests; restored → ✅ 36 |
| `vitest run tests/unit/reviews tests/unit/shell` | ✅ 49 (16 + 13 reviews, shell/nav updated for 2 new items) |
| `npm run verify` (1st) | ❌ 5 unit failures: comms fixtures lacked the new `recovery_plan_id` column → fixtures updated |
| `npm run verify` (final) | ✅ exit 0: lint, typecheck, format, **44 files / 685 tests (405 unit + 280 db)**, build (new routes `◐ /app/events/[eventId]/incidents[/[incidentId]]`, `/app/reviews`, `/app/admin/reviews`) |
| Smoke, `next start` on port 3917, no Supabase env | ✅ the 5 new/changed `/app/**` routes → 307 `/sign-in?next=…` (target kept); `/` 200; server stopped afterwards |
| Real Gemini / live Supabase / browser | ⏳ **not run** |

## Implementation phases
| Phase | Status |
|---|---|
| P0 Scaffold & tooling | 🚧 mostly done (see Phase 2 above); remaining items move to the start of P1 |
| P1 DB, auth, RLS, audit | 🚧 built + locally tested; live Supabase verification pending |
| P2 Events & interview | 🚧 built + locally tested (incl. edit/status); `/api/events/**` ⏳ |
| P3 AI adapter & plan | 🚧 built + locally tested (mock + fakes); real Gemini smoke test pending a key |
| P4 Tasks & dependencies | 🚧 built + locally tested; live Supabase pending |
| P5 Compliance | 🚧 built + locally tested (compliance checks, curated unverified sources, simulated submissions) |
| P6 Attendees & applications | 🚧 built + locally tested (concurrency only serialized) |
| P7 Communications & approvals | 🚧 built + locally tested (mock email; Resend untested live) |
| P8 Incidents & re-plan | 🚧 built + locally tested (simulated venue cancellation only; real Gemini output untested) |
| P9 Providers & marketplace | 🚧 built + locally tested |
| P10 Quotes, bookings, reviews | 🚧 requests, quotes, bookings and reviews built + locally tested |
| P11 Seed, e2e, demo | ⏳ |

## Known conflicts / deviations from the source report
See `docs/SESSION_HANDOFF.md` §Conflicts.

## Phase 10 — Integrations, security & reliability (brief "Phase 9"), 2026-10-22 🚧
Tested locally only. No live Supabase, **no real Gemini/Resend/Open-Meteo request**. No new dependencies. Already existing and not redone: Gemini adapter + mock, Resend + mock email, AI quota fallback, SQL hourly cap, RLS/anon tests, seed (fixed UUIDs, `is_demo`).
- ✅ `src/lib/integrations/{provenance,weather,places,sources,calendar}`: provider interfaces, deterministic mocks, Open-Meteo live adapter (only optional live integration), `boundedJson`.
- ✅ Security headers/CSP, 256 kb action body limit, per-user AI burst limiter, `instrumentation.ts` env check (fails in production, warns in dev), guarded `db:reset`.
- ✅ Tests: `tests/unit/integrations/providers.test.ts`, `tests/unit/security/static.test.ts`; `resetRateLimits()` added after the new limiter broke 9 existing AI/recovery tests (shared in-memory state).
- Documented in `event.md` §25 (mocked integrations, credentials, remaining limitations).
- Result: `npm run verify` ✅ lint, typecheck, format, 46 files / 703 tests, build. `next start` smoke: CSP, X-Frame-Options, nosniff, HSTS present; `x-powered-by` absent.
- ⏳ Not done: UI for weather/places, real source retrieval, Google Places adapter, durable (DB) rate limiting, a browser/live walkthrough.

## Phase 11 start — Docker Supabase connected (2026-10-22) 🚧
- ✅ Local Supabase (Docker) running; 13 migrations applied; `.env.local` created (public values only).
- ✅ Live checks: anon denied on `events` (401), sign-up + confirmation mail in Mailpit, `db lint` (1 benign warning), `db:types` -> `src/lib/db/types.gen.ts`, `typecheck` passes.
- ⏳ Browser click-through, switching repos to generated types.
- ✅ Password reset flow + httpOnly auth cookies + recovery email template; 5 new unit tests; live-tested on Docker Supabase; `npm run verify` ✅ (708 tests, build).
- ✅ Dev-origin fix: opening the app at `127.0.0.1` (or another host) made Next dev block HMR/actions, so forms posted without JS and `cookies()` threw an InvariantError. `allowedDevOrigins: ["127.0.0.1"]` added in `next.config.ts`. Use `http://localhost:3000` (matches `NEXT_PUBLIC_APP_URL`; email links redirect there). Don't run `npm run build`/`verify` while `next dev` is running (shared `.next`).
- ✅ Local Supabase `enable_confirmations = false` (sign-up signs in and goes straight to onboarding; no inbox step). Hosted projects must turn confirmations back ON (event.md §14.1). Sign-up form no longer promises a confirmation email.
- ✅ Live marketplace chain verified (provider -> admin verify -> shortlist -> request -> quote). Fixed shortlist permission bug (upsert vs column grants) + regression test. `npm run verify` ✅ (711 tests).
- ✅ Gemini plan overview (summary/requirements/missing info/budget estimates/risks) + case-insensitive AI_PROVIDER + migration 0010; mock-tested only, no live Gemini call. `npm run verify` ✅ (715 tests).

- ✅ 2026-10-23: Gemini audit; static log test allow-lists `gemini.ts` warn. lint/typecheck/test:unit/format ✅; live Gemini still ⏳.
- ✅ 2026-10-23: Groq provider (mock-tested only), migration 20261023000001, `instant=false` on data pages. Live Groq ⏳.
- ✅ 2026-10-23: plan generation no longer blocked by missing answers (test updated); local migrations verified applied. Groq key/model ⏳ (key missing).
- ✅ 2026-10-23: Groq root cause found. `.env.local` had an xAI key (`xai-…`) in `GROQ_API_KEY` and `GROQ_MODEL=grok-4.7` (an xAI model), so every plan call would be rejected (401). Env validation now rejects non-`gsk_` keys with a readable message (test added). `GROQ_MODEL` set to `llama-3.3-70b-versatile` (not yet confirmed active). Local migrations through `20261023000001` verified applied. lint, typecheck, `test:unit` (439) ✅. **Live Groq ⏳: needs a real `gsk_` key from console.groq.com.** No request was sent to Groq.
- ✅ 2026-10-23: xAI (Grok) provider. `AI_PROVIDER=xai` + `XAI_API_KEY` + `XAI_MODEL` (reuses the chat-completions adapter in `src/lib/ai/groq.ts` with base URL `https://api.x.ai/v1`; no new dependency), migration `20261023000002_ai_provider_xai.sql` (applied locally via `supabase migration up`), env validation + tests, plan-page badge. lint, typecheck, format, unit 441 ✅, db 282 ✅. **Live xAI ⏳ — no request sent.** `.env.local` still needs: `AI_PROVIDER=xai`, `XAI_API_KEY` uncommented (it is `#XAI_API_KEY=` at line 23), `XAI_MODEL=grok-4.7`, and `GROQ_API_KEY` emptied (it holds the xAI key and fails validation).

## Planning engine: external AI removed (2026-10-23) ✅
Decision (user): the hackathon prototype uses a deterministic, playbook-driven planning engine and **no external AI API**.
- **Root cause of the earlier planning problem:** plan generation depended on a provider that could not be reached with the configuration present. `.env.local` held an xAI key (`xai-…`) in `GROQ_API_KEY` with the xAI model `grok-4.7` as `GROQ_MODEL`, so Groq would reject it (401); separately a Gemini call returned 503 "high demand". The code did build a fallback plan, but it was a thin checklist with no budget, schedule or risks, and the UI explained provider errors to organizers. Gemini/Groq/xAI live connectivity was never verified.
- ✅ Removed: `src/lib/ai/*` (Gemini/Groq/xAI adapters, mock provider, client, log), `modules/planning/{provider,prompts}.ts`, `modules/recovery/prompts.ts`, `tests/live/`, `test:ai-live`, the `live` Vitest project, follow-up suggestion and AI task-revision features, `AI_PROVIDER`, `GEMINI_*`, `GROQ_*`, `XAI_*` from the env schema, `.env.example` and `.env.local` (other variables untouched; no values printed). No dependency was removed (none existed).
- ✅ Added: `modules/planning/engine.ts` (pure engine) + decision tables in the playbook schema; playbooks `university-hackathon` v3, `conference` v1, `workshop` v1; event-type choice on the new-event form; `comms/templates.ts` (message drafts); migration `20261023000003_planning_engine.sql` (event types, `playbook` run provider; additive; applied to the local DB with `supabase migration up`, no reset).
- ✅ `src/modules/ai` → `src/modules/planning` (table names `ai_*` unchanged). Recovery proposals are rule-built and recorded as a `playbook` run.
- ✅ UI copy: provider/mock/diagnostic wording removed from plan, interview, messages, incidents, tasks, compliance, landing, banner ("Test mode"), timeline and error messages; a test scans `src/app` and `src/components`.
- Results: `npm run lint`, `typecheck`, `format:check` ✅; `npm test` ✅ 47 files (unit 33 + db 14, 703+ tests); `npm run build` ✅ (route table printed, exit 0 in `verify`). Engine output accepted by the real SQL RPCs for all three playbooks (PGlite).
- ⏳ Not done: browser click-through of the new plan page, live Supabase run of the new migration on a hosted project, mid-event schedule blocks, in-place editing of assumptions (change the answer and regenerate instead), more event types.

## Hosted Supabase Cloud (2026-10-24) 🚧
Decision (user): hosted Supabase Cloud replaces local Docker Supabase. CLI logged in and linked by the user.
- ✅ Read-only audit: `.env.local` points at `<ref>.supabase.co` with a publishable key (`SUPABASE_SECRET_KEY` empty; the app doesn't need it). Auth reachable (GoTrue 200); hosted email confirmation is OFF (`mailer_autoconfirm: true`).
- ✅ Hosted DB (read-only `supabase db query --linked`): Postgres 17.11, `public` empty (0 tables/functions), no migration history table, no triggers on `auth.users`, **2 existing confirmed auth users without profiles**.
- ✅ `supabase migration list --linked`: 0 of 17 applied. SQL review: no destructive statement touches existing data; only built-in functions needed.
- ✅ New migration `20261024000001_backfill_profiles.sql` (idempotent `insert … on conflict do nothing`; existing profiles/accounts untouched) + 2 tests in `tests/db/accounts.test.ts` (backfill, unchanged existing rows, rerun = no duplicates, backfilled user can onboard). Mutation check (no-op insert) failed both tests; file restored byte-identical.
- Results: `npm run test:db` ✅ 14 files / 288 tests; lint ✅; typecheck ✅; format:check ✅. `supabase db push --dry-run` lists 18 migrations in order.
- ✅ 2026-10-24 (user-approved): `npx supabase db push` (no seed) applied all 18 migrations to the linked hosted project (the ref matches `.env.local`), exit 0.
- ✅ Read-only verification: `migration list --linked` 18/18 applied; 43/43 tables and 141/141 functions match the migrations exactly; RLS on all 43 tables, 69 policies; trigger `on_auth_user_created → handle_new_user`; 2 auth users / 2 profiles (active, not onboarded); anon: no table privileges (REST → 42501 on all 43), executes only `register_attendee` + `public_event_by_slug`; no function executable by PUBLIC; every SECURITY DEFINER function pins search_path; 0 providers (no seed), 6 knowledge_sources (from the compliance migration), 0 platform admins.
- Advisors (`db advisors --linked`): security WARN ×97 = 94 authenticated-callable SECURITY DEFINER RPCs/RLS helpers (by design; each checks auth.uid()), 2 anon RPCs (intended public registration), leaked-password protection off (dashboard). Performance WARN: 10 `auth_rls_initplan`, 2 `multiple_permissive_policies`. Follow-up: revoke the unused AI-era RPCs `start_ai_run`, `finish_ai_run`, `revise_ai_task`, `save_ai_followups` in a new migration. Uncommitted plan-staleness warning (`planning/service.ts`, plan page) kept; its tests still to be written.
- ✅ 2026-10-24 headless browser walkthrough against hosted Supabase (`npm run dev`, Chromium via playwright-core in the scratchpad, not a project dependency; user-approved dedicated test account `halaevents.walkthrough.*@example.test`): sign-up → onboarding → create event → 4 interview rounds (15 answers, "every question answered") → generate plan (16 tasks, overview) → reload (kept, not stale) → dismiss one → accept → tasks page "0 of 15 done · 11 blocked" → change an answer → plan shows the new "out of date" banner → unknown and malformed event ids show the not-found page. Hosted DB (read-only query) confirms: 1 event (owner member), 15 answers, 1 current playbook plan with overview, suggestions 15 accepted / 1 rejected, 15 tasks, 12 dependencies, 46 audit rows, 4 notifications. No defects found, no code changed. Only log noise: the known dev-only "uncached data during prerendering" notice. lint ✅, typecheck ✅, build ✅, unit 420 ✅, db (accounts, ai, workspace) 62 ✅. Not walked: messages/approvals, attendees, marketplace, bookings, recovery, reviews.

## Phase 2 — Token-efficient AI foundation (2026-10-24) 🚧
Decision (user): provider-independent AI behind one gateway; Cloudflare Workers AI first; playbook engine kept as explicit template mode (event.md §17.7). **No live call made; no credentials configured; no hosted migration pushed.**
- ✅ Step 0: migration `20261024000002_plan_assumptions_limit.sql` (assumptions ≤ 20, fixes a real bug: a hackathon plan with no answers has 9 assumptions and was rejected by the old cap of 8); regression test in `tests/db/ai.test.ts` saves the engine's real assumptions (fails without the migration, checked); plan-staleness tests in `tests/unit/planning/service.test.tsx` (mutation-checked).
- ✅ Step 1: `src/lib/ai/{types,cloudflare,gateway}.ts` — one request per call, timeout, error codes, JSON + Zod + business checks, no retries/repair/fallback; env `AI_PROVIDER` (none default), `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `AI_PLAN_MODEL`, limits.
- ✅ Step 2: `src/modules/planning/plan-prompt.ts` (`planning.plan@1`), `AiPlanDraft` schema; measured prompt 2.2k–4.5k chars + 2.3k-char JSON schema.
- ✅ Step 3: migration `20261024000003_ai_runs_cloudflare.sql` (provider 'cloudflare', `ai_runs.prompt_version`, `start_ai_run(..., p_prompt_version)`); usage in ai_runs (requests, latency, tokens); reuse of identical drafts; SQL single-flight + 20/h; 3/min burst; friendly errors for `ai_run_in_progress`/`ai_rate_limited`.
- ✅ Step 4: `agent.ts` `draftToPlan` (budget/schedule/requirements from the engine), `service.ts` custom mode, plan page "Generate custom draft" (only when configured) + "Generate template plan", source badge.
- Results: lint ✅, typecheck ✅, format ✅, `npm test` ✅ 49 files / 752 tests (first full run had one PGlite worker SIGKILLed for memory on this 3.7 GB machine; `test:db` alone 291 ✅ and the rerun of the full suite passed), `npm run build` ✅.
- ✅ 2026-10-24 pre-deployment pass: prompt v2 (answers as `key = answer`, 10–15 tasks asked): fully answered prompts −12–13% (hackathon 4306→3742 chars); draft schema tightened (≤20 tasks, description ≤200, nextAction ≤120, summary ≤400); `AI_PLAN_MAX_OUTPUT_TOKENS` default 3000→4096 (15-task drafts estimated up to ~3.8k tokens; truncation is rejected, never saved). New tests: answer/model/prompt-version invalidation, truncated output, logs without token/prompt/output, gateway server-only. Focused: unit 126 ✅, db 114 ✅; lint/typecheck/format ✅. Cloudflare docs checked (endpoint, bearer auth, JSON mode `response_format`, model in the JSON-mode list; usage fields and the quota error code not documented there). `db push --dry-run`: 20261024000002, 20261024000003 pending; hosted rows fit the new constraints.
- ✅ 2026-10-24 (user-approved): pushed `20261024000002` + `20261024000003` to hosted. Verified: 20/20 migrations applied; `start_ai_run` has 7 args (prompt version), authenticated yes / anon no; provider check includes cloudflare; assumptions ≤ 20; 141 functions; RLS on all tables; anon executes only the 2 public RPCs; data intact (3 profiles, 1 event, 1 plan, 15 tasks). Next: user adds Cloudflare credentials, then one controlled live draft.
- ✅ 2026-10-24 first live custom draft (hybrid): 61.7 s, 904 in / 2,029 out tokens, valid, accepted (after `AI_TIMEOUT_MS=120000`; first try timed out at 45 s, nothing saved).
- ✅ 2026-10-24 full-AI mode (user decision, trial): `AI_PLAN_STRATEGY=full|hybrid` (default full), prompt `planning.full@1` (event facts + answers only), `AiFullPlanDraft`, `fullDraftToPlan`, `fullPlanErrors`; playbook rules untouched; hybrid one setting away. Unit 469 ✅, lint/typecheck/format ✅. No live call made for full mode yet.
- ✅ 2026-10-24 Additional event details: migration `20261024000004_event_additional_details.sql` (column + `save_event_details`; **PGlite only, not pushed**), interview-page section with examples, prompts `planning.full@2` / `planning.plan@3` with a fenced details block and `conflicts` output (shown on the plan page), custom-draft fingerprint includes the details. Tests: DB interview/events/schema 64 ✅ (DB workers lowered 3→2 after another SIGKILL with the dev server running), unit 476 ✅, lint/typecheck/format ✅.
- ✅ 2026-10-24 (user-approved): pushed `20261024000004`; 21/21 applied; column + `save_event_details` (authenticated only, no direct column update), RLS intact, data intact. Headless check on hosted via the running dev server: event pages load, details section saves, survives reload, clears; no 5xx.
- ✅ 2026-10-24 Service selection + Geoapify vendor discovery (event.md §16.5): migration `20261024000005_event_vendors.sql` (events.services, event_vendor_shortlist + 4 functions; **PGlite only, not pushed**), `/services` and `/vendors` pages, `src/lib/integrations/geoapify.ts`, `src/modules/vendors/`, services in custom-draft prompt + fingerprint. Verified Geoapify categories/response live (4 requests, limit 1). Tests: unit 495 ✅, db 302 ✅; lint, typecheck, format ✅; `next build` not run.

## Step 2: vendor email drafts with Gmail redirect (2026-10-24)
- Done: "Draft email" on the event dashboard → `/app/events/[id]/email`. Pick a shortlisted vendor or a service; the app writes a quotation request from persisted event facts (`src/modules/email/`). Editable To/Subject/Message preview, "Open in Gmail" (compose URL, `src/lib/integrations/gmail-compose.ts`) and "Copy email".
- AI: one gateway request per explicit click (`email.quote@1`), body only; greeting, subject and sign-off come from code. Output rejected if it has URLs, emails, phones, placeholders or confirmations → labelled template fallback. Identical requests are served from an in-memory cache; 3 requests/user/minute. No `ai_runs` row (its `pipeline` is CHECK-constrained to plan; no migration added).
- Subject carries a stable reference `HE-XXXXXXXX` (hash of event + category + place id) so Step 3 can match replies by recomputing it.
- Not done by design: Gmail OAuth, inbox reading, sending, marking emails as sent.
- Tests: `tests/unit/email/` (23). `npm run verify` pieces run: lint, typecheck, format:check, test:unit (525), build.

## Step 3: manual Gmail inbox agent (prototype, 2026-10-24)
- Done: Connect Gmail (read-only OAuth, `/api/integrations/gmail/connect` + `/callback`), Check for replies, Analyze reply, "Vendor replies" card on the event dashboard (`src/modules/inbox/`, `src/lib/integrations/gmail.ts`, `src/components/inbox/inbox-card.tsx`).
- DB: migration `20261024000006_gmail_inbox.sql` (`gmail_connections`, `vendor_replies`) — NOT applied to hosted Supabase; local PGlite tests only (`tests/db/gmail-inbox.test.ts`).
- Env: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GMAIL_TOKEN_ENCRYPTION_KEY`, `GMAIL_DEMO_VENDOR_EMAIL` (server-only).
- Replies come only from the one demo vendor address and only when they carry this event's `HE-` code. Everything is a manual click; nothing is sent. Analysis is one gateway request per reply, saved, price must appear in the email text.
- Prototype limits: refresh token encrypted with an app key (no rotation); Google "Testing" mode needs test users.
