# HalaEvents — Implementation Plan

> Status: P0 is mostly done (app foundation + design system, verified 2026-10-21); the remaining P0 items are listed below.
> P1–P11 are not started. The user's brief numbering differs: brief "Phase 1" = architecture docs, brief "Phase 2" = P0 + design system.
> Architecture reference: `event.md`. Rules: `CLAUDE.md`.

## Roles (from project report)
- **A** — AI & agent logic  **F** — Frontend & UX  **B** — Backend & data  **Q** — Integration, QA & demo
(3-person team: Q duties split between B and A.)

## Critical path
`P0 → P1 → P2 → P3 → P4 → P6 → P7 → P8 → P11` is the demo-critical path (create → interview → plan → tasks →
register → approve & send → replan → demo). P5 (compliance) is needed for source labels in the demo but can run
in parallel with P4. P9–P10 (marketplace/bookings/reviews) start only when P7 is green.

| Phase | Name | Owner | Depends on | Est. hours |
|---|---|---|---|---|
| P0 | Scaffold & tooling | B, Q | — | 1–2 |
| P1 | DB foundation, auth, RLS, audit | B | P0 | 3–4 |
| P2 | Events & adaptive interview (playbook) | F, B, A | P1 | 3 |
| P3 | AI adapter & plan generation | A | P1 (P2 for context) | 4 |
| P4 | Tasks & dependencies | B, F | P3 | 3 |
| P5 | Compliance: sources & requirements | A, B | P3 | 2–3 |
| P6 | Attendees & applications (capacity) | B, F | P1, P2 | 4 |
| P7 | Communications & approvals | B, F, Q | P6 | 4 |
| P8 | Incidents & re-plan (crisis recovery) | A, F | P4, P7 | 3 |
| P9 | Provider onboarding & marketplace matching (🚧 local) | B, F | P1 | 3–4 |
| P10 | Service requests, quotes (🚧 local), bookings, reviews | B, F | P7, P9 | 4 |
| P11 | Seed data, e2e, demo hardening | Q (all) | all demo phases | 3–4 |

---

## P0 — Scaffold & tooling — 🚧 steps 1–4 and 6 done; 5 and 7 remaining
**Already present (keep):** `package.json` (pinned versions, scripts incl. `verify`), `tsconfig.json` (strict, `@/*`),
`eslint.config.mjs` (next core-web-vitals + typescript), `next.config.ts`, `.npmrc`, `AGENTS.md`, `src/app/favicon.ico`.
**Done (2026-10-21):** steps 1–4 and 6 (with `errors.ts`/`http.ts` deferred to P1, where the first API route needs them).
Also done, beyond the original P0 scope: design system, UI components, landing page, app shell, error/loading/not-found states,
`/status` + `/api/health` (`event.md` §13).
**Remaining → do at the start of P1:** step 5 (Supabase deps + CLI, Playwright, `test:db`/`test:e2e`/`db:*` scripts, `supabase init`),
step 7 (ESLint `no-restricted-imports`; `server-only` already makes client imports of server modules fail at build), `src/lib/errors.ts`, `src/lib/http.ts`.

**Ordered tasks:**
1. Clean reinstall: `rm -rf node_modules && npm install` → commit `package-lock.json`. Confirm `node_modules/next/dist/docs/` exists and read the
   proxy, caching (`cacheComponents`) and route-handler guides (`AGENTS.md` rule).
2. Verify `partialPrefetching` and the `@tailwindcss/turbopack` loader against those docs; otherwise switch to
   `@tailwindcss/postcss` + `postcss.config.mjs` (open decision 6).
3. Create `src/app/layout.tsx`, `src/app/page.tsx` ("HalaEvents"), `src/app/globals.css`, `.prettierrc.json` (+ `.prettierignore`).
4. `vitest.config.ts` with two projects: `unit` (`tests/unit/**`, `src/**/*.test.ts(x)`, jsdom for `.tsx`) and `db` (`tests/db/**`, node env, excluded from `npm test`).
5. Add deps: `@supabase/supabase-js`, `@supabase/ssr`; dev: `supabase` (CLI), `@playwright/test`. Scripts: `test:db` (`vitest run --project db`),
   `test:e2e` (`playwright test`), `db:start`, `db:reset`, `db:types` (`supabase gen types typescript --local > src/lib/db/types.gen.ts`). Run `npx supabase init`.
6. `src/lib/env.server.ts` / `env.client.ts` (rules in `event.md` §9), `src/lib/errors.ts` (`AppError` codes from §10.1), `src/lib/http.ts` (`toResponse`).
7. ESLint `no-restricted-imports`: client components may not import `@/lib/db/admin`, `@/lib/env.server`, `@/lib/ai/gemini`, `@google/genai`.
**Acceptance:** `npm run verify` passes (lint, typecheck, format:check, unit tests, build) ✅; app shows "HalaEvents" home page ✅;
missing required env var fails with a readable Zod error (unit test) ✅; `npm ls` reports no missing/invalid packages ✅;
`npm ci` reproduces the install ✅. Every nav link resolves to a page (unit test) ✅; token contrast meets WCAG (unit test) ✅.

## P1 — DB foundation, auth, RLS, audit — 🚧 implemented and locally tested; live Supabase verification pending
**Built (2026-10-21):** `supabase/config.toml` (confirmations on, password policy, redirect allow-list, confirmation template),
migrations `20261021000001_accounts.sql`, `…02_providers.sql`, `…03_events.sql` (`event.md` §14.3), `src/proxy.ts`,
`src/lib/db/{config,server}.ts`, `src/lib/auth/session.ts`, `src/lib/errors.ts`, `src/lib/forms.ts`, `src/modules/auth/*`,
`src/modules/profiles/*`, `src/modules/events/{schemas,rules}.ts`, pages `/sign-in`, `/sign-up`, `/sign-up/check-email`,
`/auth/confirm`, `/auth/error`, `/onboarding`, `/account-status`, `/app/settings` (profile + roles), gated `/app` shell.
Providers and events exist as schema + RLS + RPCs only; their UIs are P9 and P2.
**Acceptance:**
- ✅ (local) `requireUser` redirects without a session; proxy redirects protected paths; forged cookie rejected (unit tests + smoke test).
- ✅ (local, PGlite) RLS: outsiders can't see/edit events, profiles, unverified providers or private provider data; viewers read-only.
- ✅ (local, PGlite) No self-granted admin, verification, account status or onboarding flags; suspended accounts can't write.
- ✅ (local, PGlite) `audit_log` has no write path for any API role; entries are written for privileged changes.
- ✅ (local, PGlite) anon has no table privileges and no function execute rights; every table has RLS; SECURITY DEFINER pins search_path.
- ⏳ Sign up → confirm email → onboarding → sign out → sign in against a **real** Supabase project (manual; needs credentials).
- ⏳ `npm run db:reset` on local Supabase (needs Docker access) or `supabase db push` to a hosted dev project; then `npm run db:types`.
- ⏳ Playwright (`@playwright/test`, `test:e2e`) — moved to P11, where the e2e journey is written.
- ⏳ ESLint `no-restricted-imports` — still not added (`server-only` already fails the build on client imports of server modules).
**Tests:** `tests/db/{accounts,providers,events,schema}.test.ts` (PGlite), `tests/unit/auth/*`, `tests/unit/profiles/*`.

## P2 — Events & adaptive interview — 🚧 minimal events (create/list/detail) built early for P9/P10; interview not started
**Files:** `src/modules/events/*`, `playbooks/university-hackathon.ts`, `src/modules/ai/playbook.ts` (PlaybookSchema),
`src/app/events/new`, `src/app/events/[id]`, `src/app/api/events/**`, migration `0004_events_interview.sql`.
**Acceptance:**
- Create event → persisted, creator is `owner`; reopen shows same data.
- Event transitions follow `event.md` §4; invalid transition → 409 `invalid_transition` (unit tests for every pair).
- Interview round 1 comes from playbook conditions (e.g. audience = school students ⇒ age/guardian questions).
- Answers saved per `question_key`; Zod rejects malformed answers.

## P3 — AI adapter & plan generation
**Files:** `src/lib/ai/{types,gemini,mock,index}.ts`, `src/modules/ai/{schemas,pipelines,service,repo}.ts`, migration `0005_ai.sql`.
**Acceptance:**
- `AI_PROVIDER=mock` runs full plan pipeline offline, deterministically (snapshot test).
- Adapter rejects invalid model JSON (unit test with malformed fixtures) → `invalid_output` after one repair retry.
- Plan output stored as `ai_suggestions(status=proposed)` + `ai_runs` row; nothing written to `tasks` until accepted.
- Gemini smoke test (`npm run test:ai-live`, manual, requires key) returns schema-valid plan. Not part of CI.
- No vendor SDK import outside `src/lib/ai/gemini.ts` (lint).

## P4 — Tasks & dependencies
**Files:** `src/modules/tasks/*`, `src/app/events/[id]/tasks`, `src/app/api/tasks/**`, migration `0006_tasks.sql` (incl. `add_task_dependency`).
**Acceptance:**
- Accepting plan suggestions creates tasks + dependencies in one RPC; temp ids resolved.
- Cycle, self-dependency, cross-event dependency rejected (unit `rules.test.ts` + DB test).
- Blocked/overdue derived correctly; cannot mark blocked task `done`.
- Viewer role can read, cannot edit (RLS test).

## P5 — Compliance: sources & requirements
**Files:** `src/modules/compliance/*`, migration `0007_compliance.sql`, seed of Dubai DET/DDA sources (unverified).
**Acceptance:**
- CHECK constraint: `verified_source` without `source_id` fails (DB test).
- Plan post-rule downgrades AI-claimed `verified_source` without verified source (unit test).
- UI shows label, source URL, last-verified time or "Not verified".
- Organizer can record evidence (e.g. permit reference) — recorded, never shown as "approved by authority".

## P6 — Attendees & applications
**Files:** `src/modules/attendees/*`, `src/app/register/[slug]`, `src/app/events/[id]/attendees`, migration `0008_attendees.sql`
(`register_attendee`, `accept_attendee`, `promote_from_waitlist`).
**Acceptance:**
- Public registration validates input; duplicate email per event → 409. Runs as `anon` via `register_attendee()` (no admin key).
- **Concurrency test:** 20 parallel `accept_attendee` calls with capacity 10 → exactly 10 accepted (`npm run test:db`).
- Eligibility rules are organizer-defined and deterministic; `ineligible` flags, never auto-rejects.
- Application review and participation statuses change independently; transition table unit-tested.

## P7 — Communications & approvals
**Files:** `src/modules/comms/*`, `src/lib/integrations/email/{types,mock,resend}.ts`, migration `0009_comms.sql` (`claim_approval`, `finish_approval` — two-phase, `event.md` §5.4).
**Acceptance:**
- Draft → request approval → approve → execute → `sent` (mock) with `is_mock=true`.
- Executing twice (including two concurrent calls) sends once (DB + unit test with counting mock adapter). Payload edited after approval → execution refused.
- Approval left in `executing` is shown as "needs check", never auto-resent.
- Failed send sets `failed` + reason; attendee participation status unchanged (test).
- Audit log shows requester, approver, payload hash, provider response.

## P8 — Incidents & re-plan
**Files:** `src/modules/trust/{incidents,replan}*`, `src/app/events/[id]/incidents`, migration `0010_incidents.sql`.
**Acceptance:**
- "Simulate venue cancellation" creates `is_simulated` incident; replan pipeline lists affected tasks (ids validated as belonging to event).
- Proposal changes nothing until approved; approving a subset applies only that subset via approval execution.
- Participant update drafts created as `draft`, not sent.

## P9 — Provider onboarding & marketplace — 🚧 implemented and locally tested (2026-10-21)
**Built:** migration `20261021000004_marketplace.sql`, `supabase/seed.sql` demo providers, `src/modules/profiles/providers-*`,
`src/modules/marketplace/*`, pages under `/app/marketplace`, `/app/provider`, `/app/admin/providers` (`event.md` §15).
**Acceptance:**
- ✅ (PGlite) Member creates a provider, adds services, venue details and credentials, submits; admin verifies, moderates, reviews credentials.
- ✅ (PGlite) Unverified, hidden or paused providers never appear in search or to unrelated members; credentials and private contact members-only.
- ✅ (unit) Deterministic directory order; filters; labels ("Indicative", "Price on request", "Verified", "Demo listing").
- ⏳ Against real Supabase: PostgREST embeds/RPC mapping, browser walkthrough. ⏳ Credential file uploads (Supabase Storage).
- ⏳ Weighted match score (`event.md` §7) not implemented. The directory filters but doesn't rank by fit.

## P10 — Service requests, quotes, bookings, reviews — 🚧 requests + quotes done (local); bookings and reviews not started
**Built:** service requests (1–10 invited providers), per-provider question threads, provider decline, quotes (draft/submit/revise/withdraw),
organizer decline and comparison view (`event.md` §15.4–15.5).
**Acceptance:**
- ✅ (PGlite) Invited provider sees request; uninvited cannot; a provider sees only its own invite, thread and quote.
- ✅ (PGlite) Organizers see non-draft quotes; viewers and other providers see none; every invalid transition rejected.
- ⏳ **Accepting a quote → approval → `pending_confirmation` booking → provider confirms** (`accept_quote`, `confirm_booking`). Needs P7 approvals.
- ⏳ Reviews after completed bookings.

## P11 — Seed, e2e, demo hardening
**Files:** `supabase/seed.sql`, `tests/e2e/demo-journey.spec.ts`, `docs/DEMO.md`.
**Acceptance:**
- `npm run test:e2e` runs the §1.2 demo journey in mock mode end-to-end.
- Demo works with network disabled except Supabase (all integrations mock).
- Backup recording made.

---

## Per-module acceptance & tests
| Module | Built in | Must-pass tests (file) | Acceptance summary |
|---|---|---|---|
| auth | P1 ✅ local | `tests/unit/auth/{rules,session,proxy}.test.ts`, `tests/db/accounts.test.ts` | redirect without session, no open redirect, no enumeration, no self-escalation |
| profiles | P1 ✅ local, P9 | `tests/unit/profiles/{actions,rules}.test.ts`, `tests/db/providers.test.ts` | identity from session only; only verified providers public; private data members-only; transitions match SQL |
| events | P2 | `tests/unit/events/rules.test.ts`, `tests/unit/events/schemas.test.ts` | all transitions table-tested; interview keys validated |
| tasks | P4 | `tests/unit/tasks/dag.test.ts`, `tests/db/task-deps.test.ts` | cycles rejected; blocked/overdue derived |
| ai | P3 | `tests/unit/ai/adapter.test.ts`, `tests/unit/ai/plan-postrules.test.ts`, `tests/unit/ai/playbook.test.ts` | invalid output never persisted; mock deterministic |
| compliance | P5 | `tests/unit/compliance/confidence.test.ts`, `tests/db/requirements.test.ts` | no `verified_source` without verified source |
| attendees | P6 | `tests/unit/attendees/rules.test.ts`, `tests/db/capacity-concurrency.test.ts` | no overbooking under concurrency |
| comms | P7 | `tests/unit/comms/rules.test.ts`, `tests/db/approval-execution.test.ts` | single send per approval; hash mismatch refused |
| marketplace | P9 🚧 | `tests/db/marketplace.test.ts`, `tests/unit/marketplace/{rules,authorization,pages}.test.ts` | visibility, filters, shortlist permissions; ranking weights still TODO |
| bookings | P10 🚧 | same files (requests/quotes); `tests/db/accept-quote.test.ts` (TODO) | request/quote isolation and transitions ✅; one booking per quote, provider-only confirm TODO |
| trust | P1, P8, P10 | `tests/db/audit-immutable.test.ts`, `tests/unit/trust/replan.test.ts`, `tests/db/reviews.test.ts` | audit append-only; replan applies only approved subset; review after completion |

## Test strategy
| Layer | Tool | What | Command |
|---|---|---|---|
| Format/lint/types | Prettier, ESLint, tsc | style, import restrictions, strict types | `npm run format:check`, `npm run lint`, `npm run typecheck` |
| Unit | Vitest (`unit` project) | `rules.ts` (transitions, DAG, eligibility, matching, plan post-rules), Zod schemas, AI adapter with mock/malformed fixtures, playbook validation | `npm test` |
| Component | Vitest + jsdom + Testing Library | forms show Zod errors; status badges ("Mock", "Not verified", "Pending confirmation") | `npm test` |
| DB (local) | Vitest (`db` project) + **PGlite** with `tests/db/supabase-shim.sql` (no Docker) | migrations apply; RLS per role; CHECK constraints; RPCs; privileges; audit immutability; TS↔SQL enum/transition parity | `npm run test:db` (also part of `npm test`) |
| DB (Supabase) | Supabase CLI + Docker, or a hosted dev project | same migrations on real Supabase; `db lint`; concurrency tests (capacity, approvals) need real parallel connections — PGlite is single-connection | `npm run db:start && npm run db:reset` (not yet run) |
| API | Vitest calling route handlers | auth 401/403, input validation 400, error shape | `npm test` |
| E2E | Playwright | demo journey in mock mode | `npm run test:e2e` |
| Live AI | manual script | Gemini schema compliance | `npm run test:ai-live` |

Pre-merge gate: `npm run verify` (lint → typecheck → format:check → test → build), **passing as of 2026-10-21**. Phases touching
migrations/RPCs/RLS additionally require `npm run test:db`, and P11 requires `npm run test:e2e`. Neither script exists yet (P0 step 5).
Current suites: `tests/unit/{lib,shell,design,ui,auth,profiles,marketplace}/` and `tests/db/` — 287 tests (162 unit + 125 db), all passing on 2026-10-21.

## Open decisions
1. Local Supabase via Docker vs a hosted dev project. Still open: needed for live auth verification, `db reset`, generated types and P6 concurrency tests (PGlite covers the rest). On the current dev machine Docker is
   installed but the user cannot reach the daemon socket (permission denied), and the Supabase CLI is not installed —
   fix with `sudo usermod -aG docker $USER` (re-login) and install the CLI as a dev dependency in P0, or use a hosted project.
2. Email provider for the stretch "real send": Resend (assumed) vs Gmail API.
3. Exact Gemini model id (set via `GEMINI_MODEL`) and whether the team has API quota.
4. Whether self-approval (requester = approver) is allowed in the demo (assumed yes, recorded explicitly).
5. Git root: `.git` is in `HALA_EVENTS/` (parent of the app). Keep the parent as root (docs paths become `HalaEvents/…` in CI)
   or move `.git` into `HalaEvents/` before the first commit. Recommended: move it, since nothing is committed yet.
6. ~~Tailwind integration~~ **Resolved:** keep the official `@tailwindcss/turbopack` loader (`event.md` §2.5).
7. Dark mode follows the OS only. Add a manual theme toggle? (Not planned; needs a cookie and a `data-theme` attribute.)
