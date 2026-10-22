# HalaEvents — Implementation Plan

> Status: P0 is mostly done (app foundation + design system, verified 2026-10-21); the remaining P0 items are listed below.
> P1–P7, P9 and P10 (except reviews) are built and tested locally (PGlite + fakes), not on a live Supabase, a real Gemini key or a real email provider; P8 (simulated venue-cancellation recovery) and the P10 reviews are built and tested locally too (2026-10-22); only P11 is not started. The user's "Phase 7" brief (bookings, attendees, communications) = P6 + P7 + P10 bookings (`event.md` §20–22). The user's "Phase 6" brief (event workspace + compliance) = P2 remainder + P4 + P5 + in-app notifications (`event.md` §18–19). The user's brief numbering differs: brief "Phase 1" = architecture docs, brief "Phase 2" = P0 + design system.
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
| P8 | Incidents & re-plan (crisis recovery) (🚧 local) | A, F | P4, P7 | 3 |
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

## P2 — Events & adaptive interview — ✅ built and locally tested (2026-10-22); `/api/events/**` route handlers not built (UI uses server actions)
**Built:** `src/modules/ai/playbook.ts` (PlaybookSchema), `src/playbooks/{index,university-hackathon}.ts` (moved from the planned root
`playbooks/` so the `@/` alias covers it), `src/modules/events/interview-rules.ts`, interview functions in `events/{repo,service,actions}.ts`,
`src/components/events/interview-question.tsx`, page `/app/events/[eventId]/interview`, migration `20261022000001_interview.sql` (`event.md` §16).
**Added (Phase 6 brief):** event edit page `/app/events/[eventId]/edit` and status change on the event page (`updateEvent`/`changeEventStatus`).
**Remaining:** `src/app/api/events/**` route handlers (none exist; the UI uses server actions).
**Acceptance:**
- ✅ (local, PGlite) Create event → persisted, creator is `owner` (P1 tests). ⏳ against real Supabase.
- ✅ Event transitions follow `event.md` §4: every pair table-tested in TS and SQL; the status form offers only allowed targets and the action refuses others with `invalid_transition` (`tests/unit/workspace/actions.test.tsx`). No HTTP API, so no 409 mapping test.
- ✅ (unit) Interview round 1 comes from playbook conditions: school students ⇒ age + guardian-consent questions; university students ⇒ neither;
  ≥ 12 h ⇒ overnight question; online ⇒ no campus questions. Rounds are ≤ 5 new questions and deterministic.
- ✅ (unit + PGlite) Answers saved per `question_key` (upsert); Zod rejects malformed answers, unknown options and forged rounds; viewers,
  outsiders, anon, suspended accounts and live/completed/cancelled events can't save; changing an answer removes dependent answers.

## P3 — AI adapter & plan generation — ✅ built and locally tested (2026-10-22); real Gemini call not yet run
**Built:** `src/lib/ai/{types,client,gemini,mock,hash,log}.ts`, `src/modules/ai/{schemas,rules,prompts,provider,repo,service,actions}.ts`,
`playbooks/university-hackathon.json` (v2), page `/app/events/[eventId]/plan`, follow-ups on the interview page,
migration `20261022000002_ai.sql` (`event.md` §17). **Decision:** Gemini is called over its REST API with `fetch`; no SDK (user, 2026-10-22).
**Acceptance:**
- ✅ `AI_PROVIDER=mock` runs the full plan pipeline offline and deterministically (`service.test.tsx` "mock provider produces the playbook plan").
- ✅ Invalid model JSON / schema / business-rule violations → one repair turn → `invalid_output`; nothing saved (`client.test.ts`, `service.test.tsx`).
- ✅ Plan stored as `ai_plans` + `ai_suggestions(status=proposed)` + `ai_runs` row; nothing written to `tasks` (no tasks table yet; P4 accepts).
- ⏳ Gemini smoke test `npm run test:ai-live` exists; **skipped** so far (no `GEMINI_API_KEY`/`GEMINI_MODEL` on the dev machine). Not part of `verify`.
- ✅ No vendor SDK anywhere, and the Gemini host only in `src/lib/ai/gemini.ts` (ESLint `no-restricted-imports` + `no-restricted-syntax`; checked with a probe file).
- ✅ Added: quota (429) never retried, single-flight runs, 20 runs/user/hour, duplicate-input reuse, playbook fallback when AI fails, audit of plan/suggestion changes.

## P4 — Tasks & dependencies — ✅ built and locally tested (2026-10-22)
**Built:** `src/modules/tasks/*`, `/app/events/[id]/tasks`, `/app/tasks`, migration `20261022000003_workspace.sql` (tasks, dependencies with a
cycle-checking trigger instead of an `add_task_dependency` RPC, `accept_ai_plan`, `event_timeline`, notifications) — `event.md` §18. No `/api/tasks/**`.
**Acceptance:**
- ✅ Accepting plan suggestions creates tasks + dependencies in one RPC; temp ids resolved, partial accepts wired later (`tests/db/workspace.test.ts`).
- ✅ Cycle (direct + indirect), self-dependency, cross-event dependency rejected (`tests/unit/tasks/rules.test.ts` + DB test; mutation-checked).
- ✅ Blocked/overdue derived (event timezone); a blocked task can't be marked `done` (service + trigger).
- ✅ Viewer role can read, cannot edit (RLS test + action test).
- ✅ Added: owners must be event managers; progress from persisted data; event timeline; in-app notifications (deadlines, missing info, decisions).

## P5 — Compliance: sources & requirements — ✅ built and locally tested (2026-10-22), redesigned as compliance checks
**Built:** `src/modules/compliance/*`, `/app/events/[id]/compliance` (+ `/[checkId]`), `/app/compliance` (source registry), migration
`20261022000004_compliance.sql` with 6 curated sources (none verified) — `event.md` §19. `event_requirements` with a `confidence` column was replaced
by `compliance_checks` with ten review states (Phase 6 brief).
**Acceptance (adapted):**
- ✅ "Source-supported finding" requires a referenced source a person verified (DB + unit test); the old `verified_source` CHECK is replaced by this rule.
- ✅ Plans can't claim anything about compliance: no AI output reaches compliance tables (plans have no requirement output), so no downgrade rule is needed.
- ✅ UI shows status label, source URL, retrieval status/time, "Not verified" or the verification time, and "Live verification is unavailable".
- ✅ Organizers record evidence (references, links, notes, their own submission references) — shown as recorded by the team, never as approved by an authority.
- ✅ Added: reviewer-only decisions, real (non-simulated) evidence required to clear, simulated-only official submissions (CHECK), notifications, audit history.
- ⏳ Not built: AI-assisted concern analysis; evidence file uploads (Storage); scheduled deadline reminders.

## P6 — Attendees & applications — ✅ built and locally tested (2026-10-22)
**Built:** `src/modules/attendees/*`, `/register/[slug]`, `/app/events/[id]/attendees`, migration `20261022000005_attendees.sql`
(`register_attendee`, `public_event_by_slug` (anon), `add_attendee`, `set_attendee_review`, `set_attendee_participation`, `withdraw_attendee`) — `event.md` §20.
No separate `applications` table and no `promote_from_waitlist` (promotion is an organizer decision through `set_attendee_participation`).
**Acceptance:**
- ✅ Public registration validates input (Zod + SQL), runs as `anon` via `register_attendee()` (no admin key). Duplicates are refused in SQL; the
  public form shows one neutral message for every outcome (no email enumeration), organizer adds get a 409-style `conflict`.
- 🚧 20 registrations for 10 places → exactly 10 accepted, 10 waitlisted (DB test) — **serialized on PGlite**; true parallel locking needs a
  multi-connection Postgres (live Supabase).
- ⏳ Organizer-defined eligibility rules: not built (application review is a human decision; nothing auto-rejects).
- ✅ Registration, review and participation change independently; both transition tables parity-tested TS ↔ SQL.

## P7 — Communications & approvals — ✅ built and locally tested (2026-10-22); Resend never called for real
**Built:** `src/modules/comms/*`, `src/lib/integrations/email/{types,mock,resend,index}.ts` (Resend over REST, no SDK), migration
`20261022000006_communications.sql` (`save_communication`, `request_approval`, `decide_approval`, `claim_approval`, `finish_communication`),
AI `draft_message` pipeline, `/app/events/[id]/messages` — `event.md` §21.
**Acceptance:**
- ✅ Draft → request approval → approve → execute → `sent` (mock) with `is_simulated = true` per recipient (DB + unit).
- ✅ Executing twice sends once (`already_executed`; DB + unit with the mock outbox). Payload edited (text or recipients) after request/approval →
  superseded, nothing sent (DB + unit). Concurrent executions are serialized by the row lock (not testable on PGlite).
- ✅ Approval left in `executing` is shown as "needs a check", never auto-resent.
- ✅ Failed recipients → `failed` + error; message `partially_failed`/`failed`; attendee status unchanged (DB test).
- ✅ Audit log has every approval status change; the approval row keeps requester, decider, payload, hash, executor and result; deliveries keep
  the provider id/response. Mock can't report "accepted", Resend can't report "simulated", nobody can report "delivered" (no webhooks).

## P8 — Incidents & re-plan — 🚧 implemented and locally tested (2026-10-22), simulation only
**Built:** migration `20261022000008_recovery.sql`, `src/modules/recovery/*`, pages `/app/events/[id]/incidents[/[incidentId]]` (`event.md` §23).
(The plan's earlier file names `src/modules/trust/…` and `0010_incidents.sql` were superseded: the module is `recovery`, the migration number follows the real sequence.)
**Acceptance:**
- ✅ (PGlite) "Simulate venue cancellation" creates an `is_simulated` incident (CHECK: can't be false); repeated requests/keys never duplicate; booking untouched.
- ✅ (PGlite) Affected tasks = venue tasks + transitive dependents, this event only; services listed but never cancelled (flagged for reconfirmation); venue-related compliance flagged for reassessment.
- ✅ (unit + PGlite) Model proposal validated by Zod + rules + SQL; ids outside the incident, invented availability/price/consent/permit claims, links and unknown placeholders are rejected; nothing stored on failure.
- ✅ (PGlite) Proposal changes nothing until approved; approving a subset applies only that subset in one transaction; a changed task or a changed selection supersedes the approval.
- ✅ Provider inquiries and the attendee update are drafts; sending needs approval; inquiries are only *recorded* as simulated; the attendee update can only use the mock transport (service + trigger).
- ⏳ A real Gemini response for the recovery schema; live Supabase; browser walkthrough; dependency-order enforcement for moved tasks.

## P9 — Provider onboarding & marketplace — 🚧 implemented and locally tested (2026-10-21)
**Built:** migration `20261021000004_marketplace.sql`, `supabase/seed.sql` demo providers, `src/modules/profiles/providers-*`,
`src/modules/marketplace/*`, pages under `/app/marketplace`, `/app/provider`, `/app/admin/providers` (`event.md` §15).
**Acceptance:**
- ✅ (PGlite) Member creates a provider, adds services, venue details and credentials, submits; admin verifies, moderates, reviews credentials.
- ✅ (PGlite) Unverified, hidden or paused providers never appear in search or to unrelated members; credentials and private contact members-only.
- ✅ (unit) Deterministic directory order; filters; labels ("Indicative", "Price on request", "Verified", "Demo listing").
- ⏳ Against real Supabase: PostgREST embeds/RPC mapping, browser walkthrough. ⏳ Credential file uploads (Supabase Storage).
- ⏳ Weighted match score (`event.md` §7) not implemented. The directory filters but doesn't rank by fit.

## P10 — Service requests, quotes, bookings, reviews — 🚧 requests, quotes, bookings and reviews done (local)
**Built:** service requests (1–10 invited providers), per-provider question threads, provider decline, quotes (draft/submit/revise/withdraw),
organizer decline and comparison view (`event.md` §15.4–15.5).
**Acceptance:**
- ✅ (PGlite) Invited provider sees request; uninvited cannot; a provider sees only its own invite, thread and quote.
- ✅ (PGlite) Organizers see non-draft quotes; viewers and other providers see none; every invalid transition rejected.
- ✅ (PGlite) **Quote → proposed booking (snapshot) → approval → awaiting provider → provider confirms** (`propose_booking`, `request_booking_approval`,
  `execute_booking_approval`, `provider_booking_action`), cancellation of confirmed bookings via approval, disputes resolved by admins, venue overlap
  refused, one live booking per quote/request (`event.md` §22, migration `20261022000007_bookings.sql`). Quotes keep their own states (no `accepted`).
- ✅ (PGlite + unit) **Reviews** (`event.md` §24, migration `20261022000009_reviews.sql`): only through `create_review` for a *completed* booking; organizer→provider always, provider→organizer only
  while the platform setting is on (default off); one per booking and direction; no conflict of interest; "verified" is derived from the booking, never claimed; averages count published reviews of
  still-completed bookings (empty → "No reviews yet"); responses, reports, disputes, admin moderation. ⏳ edit/delete, review window, notifications, ratings in directory ranking.

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
| events | P2 ✅ local | `tests/db/events.test.ts`, `tests/unit/events/{interview,interview-actions,timeline}.test.ts(x)`, `tests/db/interview.test.ts` | all transitions table-tested ✅; interview keys/answers validated ✅; status change via UI ✅ |
| tasks | P4 ✅ local | `tests/unit/tasks/rules.test.ts`, `tests/db/workspace.test.ts`, `tests/unit/workspace/actions.test.tsx` | cycles rejected ✅; blocked/overdue derived ✅; TS↔SQL parity ✅ |
| ai | P3 ✅ local | `tests/unit/ai/{client,gemini,rules}.test.ts`, `tests/unit/ai/service.test.tsx`, `tests/db/ai.test.ts`, `tests/live/gemini.live.test.ts` (manual) | invalid output never persisted ✅; mock deterministic ✅; real Gemini ⏳ |
| compliance | P5 ✅ local | `tests/unit/compliance/rules.test.ts`, `tests/db/compliance.test.ts`, `tests/unit/workspace/actions.test.tsx` | no source-supported without a verified source ✅; reviewer-only + real-evidence clearing ✅; simulated-only submissions ✅ |
| attendees | P6 ✅ local | `tests/db/attendees.test.ts`, `tests/unit/comms/{rules,actions}.test.ts(x)` | capacity ✅ (serialized); duplicates ✅; separate states ✅; true concurrency ⏳ live DB |
| comms | P7 ✅ local | `tests/db/communications.test.ts`, `tests/unit/comms/{rules,email,actions}.test.ts(x)` | single send per approval ✅; hash mismatch superseded ✅; mock vs real delivery ✅ |
| marketplace | P9 🚧 | `tests/db/marketplace.test.ts`, `tests/unit/marketplace/{rules,authorization,pages}.test.ts` | visibility, filters, shortlist permissions; ranking weights still TODO |
| bookings | P10 🚧 | `tests/db/{marketplace,bookings}.test.ts`, `tests/unit/comms/actions.test.tsx` | request/quote isolation ✅; one booking per quote/request ✅; provider-only confirm ✅; venue overlap ✅ |
| recovery | P8 🚧 local | `tests/db/recovery.test.ts`, `tests/unit/recovery/{rules,service}.test.ts(x)` | idempotent simulation ✅; affected-task analysis ✅; invalid model proposals discarded ✅; nothing applied before approval ✅; subset only ✅; simulated-only sends ✅ |
| reviews | P10 🚧 local | `tests/db/reviews.test.ts`, `tests/unit/reviews/{rules,service}.test.ts(x)` | eligibility ✅; duplicates ✅; verified derived not claimed ✅; averages/empty/moderation ✅; admin-only moderation ✅ |
| trust | P1 | `tests/db/audit-immutable.test.ts` (planned) | audit append-only (the P8 and review rows above replaced the earlier `trust` placeholders) |

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
Current suites: `tests/unit/{lib,shell,design,ui,auth,profiles,marketplace,events,ai,tasks,compliance,workspace,comms,recovery,reviews}/` and `tests/db/` — 685 tests in 44 files (405 unit in 30 files + 280 db in 14 files), all passing on 2026-10-22. The db project runs after the unit project with at most 3 workers (PGlite memory; see `vitest.config.mts`). `tests/live/` (`npm run test:ai-live`) is separate and needs a Gemini key.

## Open decisions
1. Local Supabase via Docker vs a hosted dev project. Still open: needed for live auth verification, `db reset`, generated types and P6 concurrency tests (PGlite covers the rest). On the current dev machine Docker is
   installed but the user cannot reach the daemon socket (permission denied), and the Supabase CLI is not installed —
   fix with `sudo usermod -aG docker $USER` (re-login) and install the CLI as a dev dependency in P0, or use a hosted project.
2. Email provider for the stretch "real send": Resend (assumed) vs Gmail API.
3. Exact Gemini model id (set via `GEMINI_MODEL`) and whether the team has API quota. Integration style **resolved (2026-10-22): REST API directly, no SDK.** The code assumes no quota (handles 429, caps 20 runs/user/hour).
4. Whether self-approval (requester = approver) is allowed in the demo. **Implemented as allowed (2026-10-22)** and recorded (requester and decider are both stored); requiring a second person is a one-line check in `decide_approval` if the team wants it.
5. ~~Git root~~ **Resolved (observed 2026-10-22):** the repo is `HalaEvents/.git` (branch `master`, first commit `01f6d60`). The parent
   `HALA_EVENTS/.git` still exists but has no commits; it is unused and can be deleted by the user.
6. ~~Tailwind integration~~ **Resolved:** keep the official `@tailwindcss/turbopack` loader (`event.md` §2.5).
7. Dark mode follows the OS only. Add a manual theme toggle? (Not planned; needs a cookie and a `data-theme` attribute.)
