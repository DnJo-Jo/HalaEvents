# Session Handoff

## Last session: 2026-10-24 — service selection + Geoapify vendor discovery
- Built (event.md §16.5). **Needs approval:** push migration `20261024000005` (dry-run first); add `GEOAPIFY_API_KEY` to the hosted/server env. Not run: `next build`, a browser check of `/services` and `/vendors`. Next: vendor agent using the approved plan; quote requests via the approvals gate.

## Last session: 2026-10-24 — additional event details
- Built (event.md §16.4); migration `20261024000004` pushed and verified on hosted; checked in a headless browser. Next: a live custom draft with details filled in (check the conflicts warning), then vendor discovery.

## Earlier 2026-10-24 — full-AI custom drafts (AI_PLAN_STRATEGY=full)
- Model writes the whole custom draft from event facts + answers (event.md §17.8). Switch back: `AI_PLAN_STRATEGY=hybrid` in .env.local. Next: one live full draft on a realistic event (4–8 weeks out, interview answered); paste the `plan_draft` log line.

## Earlier 2026-10-24 — Phase 2 AI foundation (offline, nothing live)
- Built: gateway `src/lib/ai/`, prompt `src/modules/planning/plan-prompt.ts`, merge `src/modules/planning/agent.ts`, custom mode in `planning/service.ts` + plan page; migrations `20261024000002` (assumptions cap) and `20261024000003` (cloudflare provider, prompt_version) — **tested on PGlite only, not pushed**. Details: event.md §17.7, PROGRESS.md "Phase 2".
- Checks: lint, typecheck, format, `npm test` 752 ✅ (one earlier run OOM-killed a PGlite worker; machine has 3.7 GB), build ✅.
- **Exact next action (needs user approval):** (1) `npx supabase db push --dry-run` → expect 2 new migrations → push; (2) user adds Cloudflare id/token/model to `.env.local`; (3) one controlled live draft (procedure in the final report of this session).
- Not done: email/spreadsheet/vendor agents, BYOK, commit.
- Pre-deployment pass done; both migrations pushed and verified on hosted (2026-10-24). Next: Cloudflare credentials in .env.local, then one controlled live draft.


## Last session: 2026-10-24 — hosted walkthrough (main organizer path) passed
- Headless Chromium (scratchpad playwright-core + user-space libs, `LD_LIBRARY_PATH` from scratchpad `ldpath.txt`) against `npm run dev` + hosted Supabase: sign-up, onboarding, event, interview, plan generate/reload/dismiss/accept, tasks, stale banner, not-found pages all worked; DB rows confirmed read-only. No code changes needed. Test account `halaevents.walkthrough.*@example.test` + event "Walkthrough Campus Hack" now exist on the hosted project (delete later if unwanted).
- **Exact next action:** write unit tests for the plan-staleness warning (`tests/unit/planning/service.test.tsx`), then commit (when asked). Then the user's Cloudflare phase. Still open: first platform admin, dashboard auth settings, `db:types` → linked, revoke unused AI-era RPCs, walkthrough of messages/approvals/marketplace/bookings.

## Earlier 2026-10-24 — hosted Supabase deployed and verified
- `npx supabase db push` (approved, no seed) applied all 18 migrations; verified read-only: 18/18 in history, 43 tables / 141 functions match the repo, RLS everywhere, trigger present, 2 users → 2 profiles, anon locked down (details in PROGRESS.md "Hosted Supabase Cloud").
- **Exact next action:** browser walkthrough against hosted Supabase (`npm run dev`, sign in with an existing account → onboarding → create event → interview → plan). Still not done (need user decisions): first platform admin (event.md §14.7), dashboard Site URL/redirects/email confirmation/leaked-password protection, `db:types` → linked project, revoke unused AI-era RPCs (new migration), tests for the uncommitted plan-staleness warning.

## Earlier 2026-10-24 — hosted Supabase readiness (nothing pushed)
- Decision: hosted Supabase Cloud, no Docker. CLI is logged in and linked (by the user). Hosted `public` schema is empty; 2 auth users exist without profiles.
- Added `supabase/migrations/20261024000001_backfill_profiles.sql` + tests in `tests/db/accounts.test.ts`. `npm run test:db` 288 ✅, lint/typecheck/format ✅.
- `npx supabase db push --dry-run` → 18 migrations (20261021000001 … 20261024000001), no seeds.
- **Exact next action (needs user approval):** `npx supabase db push` (without `--include-seed` unless demo providers are wanted). Then verify read-only: `npx supabase migration list --linked` (18 applied), `supabase db query --linked` counts (≈42 tables, 2 profiles, trigger `on_auth_user_created`), anon probes (tables → permission denied, only `register_attendee`/`public_event_by_slug` executable), `npx supabase db advisors --linked`.
- Then: grant the first platform admin manually (event.md §14.7); dashboard: Site URL + redirect `…/auth/confirm`, decide email confirmation; point `db:types` at the linked project and regenerate `src/lib/db/types.gen.ts`; update README/CLAUDE.md for the cloud workflow.
- Uncommitted and kept: plan-staleness warning (`src/modules/planning/service.ts`, `src/app/app/events/[eventId]/plan/page.tsx`); write its tests in `tests/unit/planning/service.test.tsx`.

## Last session: 2026-10-23 — plan gate removed; Groq key/model still missing
- Local migrations: all 15 applied (incl. `20261023000001`), checked with `node_modules/.bin/supabase migration list --local` (the CLI is not on PATH; use `npx supabase`).
- Root cause of "plan won't generate": `generatePlan` refused to call the model unless the playbook's `requiredForPlan` answers existed, and the plan page hid the Generate button. Both gates removed; missing answers now go to the model as known gaps (assumptions / missingInformation). Prompt now separates confirmed facts, assumptions and estimates.
- `.env.local` has `XAI_API_KEY` (xai- prefix = xAI/Grok, not Groq) and EMPTY `GROQ_API_KEY`/`GROQ_MODEL`; `GEMINI_*` lines are gone. No model chosen, no live call.
- Checks: lint, typecheck, `npm test` 49 files / 720 pass.

## Last session: 2026-10-23 — Groq provider + `instant` fix
- Root cause of the failed Gemini plan: Google returned HTTP 429 (project quota for `gemini-3.5-flash` used up, retry ~7.8 h) on one click of "Suggest follow-up questions (AI)"; no auto-calls exist. The interview-page "Instant" error was fixed with `export const instant = false` on 20 data pages.
- Added Groq: `src/lib/ai/groq.ts` (fetch, OpenAI-compatible, JSON mode, no retry on 429), `AI_PROVIDER=groq` + `GROQ_API_KEY`/`GROQ_MODEL` in `env.server.ts`, `.env.example`, `provider.ts`, plan badge, migration `20261023000001_ai_provider_groq.sql` (ai_runs.provider check; **apply with `supabase migration up --local`**), prompt rule for assumptions/gaps, `tests/unit/ai/groq.test.ts`.
- Checks: lint, typecheck, format, `npm test` 49 files / 720 pass. No live call. Free-tier limits/model NOT verified (docs say limits are per model and shown in the Groq console).

## Last session: 2026-10-23 — Gemini workflow audit
- Found the workflow already complete (see next entry); only change: allow-listed the new `console.warn` in `src/lib/ai/gemini.ts` (logs Google's truncated error text, never the key) in `tests/unit/security/static.test.ts`. Uncommitted earlier edits (Gemini 3.x low thinking, no min/maxItems in schema, list limits in prompt) kept.
- Checks run: lint, typecheck, `test:unit` (434 pass), format:check. Build/db tests not re-run. **No live Gemini call.**
- Live test: `npm run test:ai-live` (one deliberate call).

## Last session: 2026-10-22 — Gemini plan proposal (overview) + config
- Existing pipeline reused (`src/modules/ai/*`, `src/lib/ai/gemini.ts`; one request per explicit "Generate plan" click, burst limiter, no auto-retry on quota, Zod-validated output, mock provider untouched). Added the missing proposal parts: `PlanOverview` (summary, requirements, missing information, budget categories as unverified estimates, risks) in `schemas.ts`, prompt text, URL check in `rules.ts`, playbook fallback fills it without estimates; stored via new migration `20261022000010_plan_overview.sql` (`ai_plans.overview` + `set_ai_plan_overview`, manager-only) and shown on the plan page with a schedule list; tasks are then dismissed/revised/accepted as before.
- Config: `AI_PROVIDER` is now case-insensitive (`.env.local` had `GEMINI`, which failed validation); `GEMINI_MODEL` was empty and was set to `gemini-2.5-flash` (the id used in `.env.example`; NOT verified as still served — check on the first live call). Key presence only checked, never printed.
- Verified: `npm run verify` exit 0 (48 files / 715 tests, build). Browser check with `AI_PROVIDER=mock`: generate -> overview + tasks shown and kept after reload. **No live Gemini call has been made.** Local DB got the migration via `supabase migration up --local` (file was edited once afterwards to re-grant two anon RPCs; local history row predates that edit).
- Manual edit of individual tasks before approval is not built; organizers dismiss tasks, ask AI to revise one (one request per click), or edit tasks after accepting them into the workspace.

---

## Last session: 2026-10-22 — Docker Supabase connected (DB gap)
- Docker works for this user; local Supabase stack running, all 13 migrations applied (`supabase_migrations.schema_migrations`). Created `.env.local` (git-ignored; URL + publishable key only, no secrets printed).
- Verified live: PostgREST up; anon `select` on `events` -> 401 permission denied; GoTrue sign-up works and the confirmation email lands in Mailpit (:54324); `npx supabase db lint --local` -> one warning (`simulatable_venue_bookings` STABLE but calls `perform`; read-only in effect, left because applied migrations are immutable); `npm run db:types` generated `src/lib/db/types.gen.ts` (1664 lines, prettier-formatted); `typecheck` passes.
- Auth click-through (headless Chromium via playwright-core in the scratchpad, not a project dependency; local Docker Supabase): weak/mismatched password errors; sign-up -> check-email; unconfirmed sign-in blocked with message; Mailpit confirm link -> /onboarding; onboarding -> /app; settings loads profile; sign-out -> /sign-in, /app then redirects; wrong password and unknown email give the same message; `next=https://evil...` ignored (lands on /app); session survives reload; reused confirm link -> /auth/error?reason=link_invalid. All passed.
- Findings: (1) no password-reset/forgot-password flow exists; (2) auth cookie `sb-…-auth-token` is httpOnly=false (@supabase/ssr default; the app has no browser Supabase client, so httpOnly could be enabled); (3) local `auth.rate_limit.email_sent = 2`/hour makes repeat sign-ups fail with "Too many attempts" (maps correctly); a duplicate-email sign-up once showed the generic error, not reproduced; (4) dev log once reported "uncached data during prerendering" for /app/settings (requireMember) though the page renders; (5) a signed-in user can still open /sign-in.
- **Auth follow-ups done (same day):** password reset (`/forgot-password`, `/reset-password`, `recovery.html` template wired in `supabase/config.toml`, `requestPasswordReset`/`updatePassword` in `src/modules/auth/service.ts`; other sessions are signed out after a reset; same response for known/unknown email); auth cookies now `httpOnly` (`src/lib/db/server.ts`, `src/proxy.ts`); local `email_sent` rate limit raised 2 -> 50 (Supabase was stopped/started; data kept). Live-tested in headless Chromium: forgot (invalid/unknown/known email), mail link -> reset page, weak and same password rejected, reset -> /app, reused link rejected, old password fails and new works, no-session `/reset-password` rejected. The earlier "signed-in /sign-in stays" was a test artefact: it redirects to /app. `npm run verify` exit 0: 47 files / 708 tests, build. Not re-checked: the "uncached data" dev warning on /app/settings; the one-off generic duplicate-sign-up error.
- **Dev-origin bug (user report):** on `127.0.0.1` (or the LAN IP) Next dev blocked HMR, forms posted without JS (no error shown) and `cookies()` threw `InvariantError`. Fixed for 127.0.0.1 with `allowedDevOrigins` in `next.config.ts`; the LAN IP is not allowed (machine-specific). Email links go to `NEXT_PUBLIC_APP_URL` (localhost), so use `http://localhost:3000`. Don't run `npm run build`/`verify` while `next dev` runs. Verified sign-in + `?next=` redirect on both hosts.
- **Click-through, organizer part (live, localhost):** sign-up -> confirm -> onboarding -> create event 'Click Gala' (form posts, redirects to the event) -> every organizer page loads with 200 and no server error: /app, events, new, tasks, marketplace, messages, notifications, attendees, compliance, reviews, settings, and the event's edit/interview/plan/tasks/attendees/bookings/compliance/messages/incidents. Findings: `/app/requests` has no index page (404; only `/app/requests/new` and `[requestId]` exist); Next dev logs the dev-only 'uncached data during prerendering' insight for every `/app/*` page (`export const instant = false` on `app/layout.tsx` did not silence it and was reverted; it never blocks the build); the Gala event was given the 'University hackathon' playbook (check playbook selection). Not yet walked: interview answers, plan generation, provider listing, admin verification, quotes, bookings.
- **Email confirmation disabled locally (user request):** `supabase/config.toml` `[auth.email] enable_confirmations = false`; sign-up -> /onboarding directly (verified in browser). The check-email page and confirm/reset email flows still exist for hosted use. Before any hosted deploy turn confirmations back on: without them anyone can register with an email they don't own.
- **Click-through, marketplace chain (live, localhost, headless Chromium):** interview (follow-up rounds appear and settle at 14 questions) -> mock-AI plan (14 proposals) -> provider signs up, creates venue listing, saves venue details, adds a service and a credential, submits -> admin (promoted via `insert into platform_admins`, §14.7) accepts the credential and verifies -> provider pause/resume (paused listings 404 for organizers, as intended) -> organizer shortlists, sends a quote request -> provider sees it in the inbox, asks a question, sends a quote -> organizer sees the quote with Decline / Propose booking. All worked except: **BUG FIXED:** `addToShortlist` used `.upsert()`, which PostgREST turns into `ON CONFLICT DO UPDATE SET <all columns>`, but `authenticated` only has UPDATE on `note` -> the event owner got 'You don't have permission'. Now insert, then update `note` on 23505 (`src/modules/marketplace/repo.ts`, test `tests/unit/marketplace/shortlist-repo.test.ts`). PGlite DB tests could not see this (no PostgREST). Stale copy ('arrive in P10') on the request page corrected. `npm run verify` exit 0: 48 files / 711 tests, build.
- Not walked yet: accepting a quote / proposing a booking through the approval gate (P7/P10), provider confirmation, messages/approvals, attendees/registration page, reviews, incidents. Only one playbook exists (`playbooks/university-hackathon.json`), so every event gets it. A one-off dev `InvariantError` on GET /sign-up in the user's own browser was not reproducible with fresh sessions (suspect a stale/expired auth cookie there: clear localhost cookies).
- Still unverified: repos still use hand-written types (not switched to `types.gen.ts`); browser click-through (sign-up -> confirm -> onboarding -> event -> marketplace -> quote flow); RPC argument names/embedded selects over HTTP beyond the checks above; live Gemini.
- Next: continue the click-through (events, marketplace, quotes) with `npm run dev`, fix defects found, then switch repos to generated types, then P11.

---

## Last session: 2026-10-22 — Integrations, security & reliability (user's "Phase 9" brief; `PROGRESS.md` Phase 10)
- Added provider interfaces + mocks (weather, places, official sources, calendar interface), an Open-Meteo adapter, security headers/CSP, body limit, AI burst limiter, startup env check, guarded `npm run db:reset -- --yes`, security regression tests. Details and limitations: `event.md` §25.
- `npm run verify` ✅ (703 tests, build). Nothing committed. No live Gemini/Resend/Open-Meteo/Supabase call was made.
- Next: P11 seed/e2e/demo; optionally surface weather on the event page (use `FORECAST_DISCLAIMER`); live Supabase + Gemini checks listed in earlier sessions below still pending.

---

## Last session: 2026-10-22 — Crisis recovery (P8) and post-event reviews (user's "Phase 8" brief)

### Starting state (verified, not assumed)
- Still uncommitted on `01f6d60`; no Docker access, no `.env.local`. The previous handoff said P8 was not started, but an interrupted session had left
  `supabase/migrations/20261022000008_recovery.sql` (~980 lines) and `src/modules/recovery/schemas.ts` with no tests, TS layer, UI or docs. `npm test` passed (540) because the DB harness applies every migration;
  `format:check` failed on 2 files (fixed with prettier, whitespace only).

### What was done
- **Recovery (P8, `event.md` §23):** reviewed migration 0008 by writing `tests/db/recovery.test.ts` first (no logic fix needed; header comment corrected), then `src/modules/recovery/{rules,prompts,repo,service,actions}.ts`,
  mock fixture + `recovery` pipeline type, comms changes (`ApprovalAction` has the two new actions, `CommunicationRow.recovery_plan_id`, `sendApproved` forces the mock transport for recovery drafts),
  pages `/app/events/[id]/incidents` and `/incidents/[incidentId]`, event-page button, messages badge, error messages for the new SQL rules.
- **Reviews (P10, `event.md` §24):** new migration `20261022000009_reviews.sql`, `src/modules/reviews/*`, `src/components/reviews/rating.tsx`, pages `/app/reviews` and `/app/admin/reviews`, a Reviews card on `/app/marketplace/[providerId]`, two nav items.
- Docs: `event.md` header + §23 + §24, `docs/IMPLEMENTATION_PLAN.md` (header, P8, P10, module table, totals), `PROGRESS.md` Phase 9.

### Commands run and results
See `PROGRESS.md` Phase 9. Final `npm run verify`: ✅ exit 0 — lint, typecheck, format, **44 files / 685 tests (405 unit + 280 db)**, build. New tests: `tests/db/recovery.test.ts` 32, `tests/db/reviews.test.ts` 36,
`tests/unit/recovery/{rules,service}` 30 + 16, `tests/unit/reviews/{rules,service}` 16 + 13. Mutation checks failed the tests as intended and the files were restored byte-for-byte (backups compared with `cmp`).
Signed-out smoke on `next start`: new routes 307 → sign-in.

### Decisions made
1. Recovery is **simulation only**: `incidents.is_simulated` CHECK-true; no code path cancels/rebooks/confirms anything. Real cancellation stays the approval-gated booking action (§22).
2. Service bookings are never cancelled by the workflow; they are flagged `reconfirm` (code decides, not the model) and get templated inquiries; compliance checks are flagged `reassess`.
3. A recovery plan can only contain `reschedule_task`, `add_task`, `flag_review`. Approvals bind the selected changes **and** the current state of what they touch; any drift supersedes.
4. A failed/invalid model proposal stores nothing and no fallback proposal is invented. Text checks (availability/consent/permit/price claims) are best-effort regexes; structural guarantees carry the safety.
5. Idempotency key is derived server-side (`sim:<booking>:<n earlier incidents>`), plus one active incident per booking in SQL.
6. Reviews: one per **booking and direction** (the team shares the slot), not editable; "verified" is derived from the booking and never an input; provider→organizer reviews are behind the platform setting `provider_reviews_of_organizers` (default **off**).
7. Public rating functions return **no rows** (not zero) when the caller may not see the provider; an empty history shows "No reviews yet".

### Not verified
- **No real Gemini request** was made. The nested `RecoveryProposal` JSON schema has never been sent to Google; `toGeminiSchema` may need adjusting (HTTP 400) when the first live call happens.
- Live Supabase/PostgREST (RPC argument names, `jsonb` payloads, embedded selects), concurrency (PGlite is single-connection), and a browser walkthrough of the new pages (incident page, reviews, admin moderation, marketplace card).
- No email was sent, no provider contacted, no real booking cancelled. Nothing committed.

### Exact next action
1. **User (still pending):** Docker group or a hosted Supabase project → `npm run db:reset` → walk through: confirm a venue booking (provider account) → simulate cancellation on `/app/events/<id>/incidents` → "Propose recovery" → select a subset → request approval →
   approve → apply (check only the subset changed and the caterer booking is still confirmed) → request/approve/record an inquiry → approve the attendee draft on `/messages` (mock) → complete a booking after its end date → write a review on `/app/reviews` →
   respond/dispute as the provider → hide/restore as a platform admin (§14.7) → check the Reviews card on the provider page.
2. Put `GEMINI_API_KEY` and `GEMINI_MODEL` in `.env.local` (never in chat), set `AI_PROVIDER=gemini`, run `npm run test:ai-live`, then try "Propose recovery" once; if the nested schema is rejected, simplify `RecoveryProposal` or `toGeminiSchema`.
3. To try provider→organizer reviews: sign in as a platform admin and enable the policy on `/app/admin/reviews`.
4. Next phase: **P11 seed, e2e, demo hardening** (a seed that includes a confirmed venue booking and a completed booking so the recovery and review demos start immediately), then the follow-ups: reviews edit/notifications/ranking, dependency-order check when moving tasks, delivery webhooks.

---

## Earlier session: 2026-10-22 — Bookings, attendees & communications (user's "Phase 7" brief)
### Starting state (verified)
- Phase 6 (workspace + compliance) done the same day; `npm run verify` green at 483 tests. Still uncommitted on `01f6d60`. No Docker, no `.env.local`.

### What was done
- **Attendees (P6):** migration `20261022000005_attendees.sql`, `src/modules/attendees/`, `/register/[slug]` (public), `/app/events/[id]/attendees`, `/app/attendees`.
- **Approvals + communications (P7):** migration `20261022000006_communications.sql`, `src/modules/comms/`, `src/lib/integrations/email/` (mock + Resend REST),
  AI `draft_message` pipeline (mock fixture + Gemini), `/app/events/[id]/messages`, `/app/messages`.
- **Bookings (P10):** migration `20261022000007_bookings.sql`, `src/modules/bookings/booking-*.ts`, `/app/events/[id]/bookings`, `/app/provider/bookings`,
  `/app/admin/bookings`, "Propose booking" on request pages; nav items "Bookings" (providers) and "Booking disputes" (admins).
- `src/lib/errors.ts` maps every new SQL rule; `src/lib/rate-limit.ts` (in-memory) for the public form.
- Docs: `event.md` header, §3, §4, §5.2, new §20–22; `docs/IMPLEMENTATION_PLAN.md` header, P6, P7, P10, test table, totals, decision 4; `PROGRESS.md` Phase 8.

### Commands run and results
See `PROGRESS.md` Phase 8. Final `npm run verify`: ✅ 38 files / 540 tests (328 unit + 212 db), build OK. Signed-out smoke: new `/app` routes 307,
`/register/campus-hack` 200 (public). Mutation checks were cumulative (scratchpad backups failed); files were restored by hand and re-tested (31 ✅).

### Decisions made
1. Booking states: proposed → awaiting organizer approval → awaiting provider → confirmed / declined; cancelled, completed, disputed. Quotes keep their own states.
2. Approvals carry a payload **built in SQL** from the target (incl. recipients) + sha256; any difference supersedes. Self-approval allowed (decision 4).
3. Booking approvals execute in one DB transaction (`execute_booking_approval`); message approvals are two-phase (claim → transport → finish).
4. Delivery statuses: `simulated` (mock), `accepted` (provider API), `failed`; `delivered`/`bounced` reserved for webhooks (not built).
5. Venue overlap is the only availability rule (venues can't be double-booked); service providers can serve several events.
6. Public registration answers with one neutral message; no applications table (review is a column); waitlist promotion is manual.
7. Two anon functions (`register_attendee`, `public_event_by_slug`) re-granted after each migration's trailing revoke; schema test pins them.

### Not verified
- Live Supabase/PostgREST, real concurrency (PGlite serializes), a browser walkthrough of any new page.
- **Resend**: never called; adapter tested with a fake `fetch`. No real email has been sent by HalaEvents.
- No real provider account has confirmed a booking. Nothing committed.

### Exact next action
1. **User (still pending):** Supabase (Docker group or hosted project) → `npm run db:reset` → walk through: open registration → register from a
   private window (capacity 2: two accepted, third waitlisted) → draft a reminder with AI → request approval → approve → send (simulated) → check
   delivery rows; propose a booking from a quote → approve → send → confirm as the provider account → try a cancellation approval.
2. Optional real email: a Resend account with a verified domain, `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` in `.env.local`; send one
   message to your own address and check that the UI says "accepted — delivery not confirmed".
3. Next phase: **P8 incidents & re-plan** (uses approvals for applying changes and comms for participant updates), then P11 seed/e2e/demo.
4. Follow-ups: delivery webhooks (Resend events → `delivered`/`bounced`), attendee self-service links, reviews (P10), scheduled reminders.

---

## Earlier session: 2026-10-22 — Event workspace & compliance workflow (user's "Phase 6" brief)

### Starting state (verified)
- P3 finished and documented earlier the same day; `npm run verify` green (420 tests). Still uncommitted on top of `01f6d60`. No Docker access, no `.env.local`.

### What was done
- **P2 leftovers:** `/app/events/[id]/edit`, lifecycle status form on the event page (`updateEvent`, `changeEventStatus`).
- **P4 tasks (`src/modules/tasks/`, migration `20261022000003_workspace.sql`):** tasks, dependencies (trigger: same event, no self, no cycle, event lock),
  deterministic transitions, blocked/overdue/due-soon derived, owners = event managers, `accept_ai_plan`, `/app/events/[id]/tasks`, `/app/tasks`.
- **Workspace:** progress cards, due-soon list, timeline (`event_timeline()` over `audit_log`, whitelisted fields), reminders button.
- **Notifications (`src/modules/notifications/`, `/app/notifications`, nav item):** in-app only, dedupe keys, `delivered`/`read`.
- **P5 compliance (`src/modules/compliance/`, migration `20261022000004_compliance.sql`):** curated `knowledge_sources` (6, none verified), `compliance_checks`
  with ten states, references, evidence, simulated-only `official_submissions`, reviewer-only decisions, deterministic detection, `/app/events/[id]/compliance`
  (+ check page), `/app/compliance` (registry + admin verification). Audit triggers and notification triggers.
- `src/lib/errors.ts` maps every new SQL rule to a readable message. `vitest.config.mts`: db project `maxWorkers: 3`, `groupOrder: 1` (OOM fix).
- Docs: `event.md` header, §3, §4, new §18–19; `docs/IMPLEMENTATION_PLAN.md` header, P2/P4/P5, test table, totals; `PROGRESS.md` Phase 7.

### Commands run and results
See `PROGRESS.md` Phase 7. Final `npm run verify`: ✅ 32 files / 483 tests (303 unit + 180 db), build OK. Mutation checks on the cycle/blocked
and reviewer/evidence rules failed the tests as intended. Signed-out smoke: all new routes 307 → sign-in.

### Decisions made
1. Compliance uses **checks with review states** instead of `event_requirements.confidence` (`event.md` §19 supersedes the §3/§4 requirement design).
2. Detection is **deterministic only**; AI-assisted concern analysis was not built (the brief said "rules and/or AI").
3. "Cleared" needs the assigned reviewer (or a platform admin), a reason and **non-simulated** evidence. "Source-supported" needs a source a platform admin verified.
4. Official submissions can only be simulated (CHECK). Real applications are tracked as the organizer's own `submission_reference` evidence.
5. Tasks add `todo → done` and `cancelled → todo` to the §4 table. Deadlines are `date`s in the event timezone.
6. Notifications are in-app only and refreshed on organizer actions; there is no scheduler.
7. Source data lives in the migration (reference data needed by the app), with retrieval facts recorded honestly (403 / 404 / search snippet).

### Not verified
- No live Supabase/PostgREST, no browser walkthrough of any new page, no multi-connection concurrency test (PGlite is single-connection).
- The **current content of the DET/DDA pages**: DET blocks automated fetches; summaries are search snippets. A person must open each page and verify it in the app.
- Nothing committed.

### Exact next action
1. **User:** open each source on `/app/compliance` in a browser and (as platform admin, §14.7) record what was checked, or correct the summaries.
   Confirm with DET whether a free university hackathon with registration needs an event/ticketed-event permit before any demo claims it.
2. **User (still pending):** Docker group or a hosted Supabase project → `npm run db:reset` → walk through: create event → interview → plan → accept →
   tasks (dependency, blocked, done) → run compliance checks → assign reviewer → record evidence → clear; simulate a submission; check notifications.
   Also `GEMINI_API_KEY`/`GEMINI_MODEL` in `.env.local` → `npm run test:ai-live`.
3. **Next phase: P6 attendees & applications** (`register_attendee`, capacity-safe `accept_attendee`), then P7 approvals (two-phase execution).
4. Optional follow-ups: scheduled deadline reminders (Supabase cron), evidence uploads (Storage), `/api/**` route handlers.

---

## Earlier session: 2026-10-22 — P3 AI adapter & plan generation (finishing an interrupted session)

### Starting state (verified, not assumed)
- An earlier session (after the P2 interview session below) built P3 but was interrupted before updating any docs. Uncommitted, on top of `01f6d60`:
  `src/lib/ai/*`, `src/modules/ai/{schemas,rules,prompts,provider,repo,service,actions}.ts`, `playbooks/university-hackathon.json`
  (the `src/playbooks/university-hackathon.ts` file was replaced by it), `/app/events/[eventId]/plan`, follow-ups on the interview page,
  migration `20261022000002_ai.sql`, tests `tests/unit/ai/*`, `tests/db/ai.test.ts`, `tests/live/gemini.live.test.ts`, `test:ai-live` script.
- `typecheck` and `lint` were clean, and `npm test` passed 26 files / 420 tests, so nothing was rebuilt.
- The user confirmed: **no SDK, call the Gemini REST API directly.** That matches the existing `gemini.ts` (plain `fetch`).

### What was done
- ESLint guard for the P3 acceptance item: `@google/genai`, `@google/generative-ai`, `@google-cloud/vertexai` imports are errors everywhere,
  and the Gemini host string is an error in `src/**` except `src/lib/ai/gemini.ts` (`eslint.config.mjs`). A probe file was used to confirm it, then deleted.
- Docs: `event.md` §17 (new) + header, §2.3 tree, §6.1/§6.4 notes, §16.1/§16.3; `docs/IMPLEMENTATION_PLAN.md` P3 status/acceptance, test table, totals,
  open decision 3; `PROGRESS.md` Phase 6.

### Commands run and results
| Command | Result |
|---|---|
| `npm run typecheck` / `npm run lint` (as found) | ✅ |
| `npm test` (as found) | ✅ 26 files, 420 tests |
| `npm run verify` | ✅ lint, typecheck, format, 420 tests, build (`◐ /app/events/[eventId]/plan`) |
| `npm run test:unit` / `test:db` | ✅ 266 / ✅ 154 |
| `npm run test:ai-live` | ⏭ skipped: no `GEMINI_API_KEY`/`GEMINI_MODEL`, no `.env.local` |
| ESLint probe + `npx eslint .` | ✅ probe flagged 3 errors; repo clean |
| `npm run verify` (end, after the ESLint change and docs) | ✅ exit 0: lint, typecheck, format, 420 tests, build |

### Decisions made
1. Gemini via REST only (user). Quotas are not assumed: 429 is never retried in-request; the app also caps 20 AI runs per user per hour.
2. Playbooks are JSON data in root `playbooks/`, loaded by `src/playbooks/index.ts` (supersedes decision 1 of the P2 session).
3. AI output is proposals only (`ai_plans`, `ai_suggestions`); `accepted` is reserved for P4, which turns proposals into tasks.
4. Known limitation recorded in `event.md` §17.6: organizers could store hand-written "AI" proposals for their own events via the RPCs.

### Not verified
- **No real Gemini request** has ever been made, so `responseJsonSchema` acceptance of the reduced schema and real model quality are unknown.
- No live Supabase / PostgREST, no browser walkthrough of `/plan` or the follow-ups. Nothing committed.

### Exact next action
1. **User:** put `GEMINI_API_KEY` and `GEMINI_MODEL` (e.g. a current Flash model id) in `.env.local` (never in chat), then run `npm run test:ai-live`.
   If Google rejects the schema (HTTP 400), adjust `toGeminiSchema` in `src/lib/ai/gemini.ts`.
2. **Finish P2 leftovers:** event edit + status transitions on `/app/events/[eventId]` (see the P2 session's "Exact next action" below; still not started).
3. **P4 — Tasks & dependencies:** `tasks`/`task_dependencies` migration and an `accept_ai_plan` RPC that turns `ai_suggestions(kind=task, status=proposed)`
   into tasks in one transaction (temp ids → ids, cycle check in SQL, suggestion → `accepted`, audit).
4. Still pending on the user: Docker access or a hosted Supabase project, then `npm run db:reset` and a browser walkthrough.

---

## Earlier session: 2026-10-22 — P2 adaptive interview (deterministic playbook round)

### Starting state (verified, not assumed)
- Repo root `HalaEvents/` (its own `.git`, branch `master`, one commit `01f6d60 "Initial commit p5"`), clean tree. The parent
  `HALA_EVENTS/.git` has no commits and is unused (open decision 5 is effectively resolved; the user may delete it).
- `npm run verify` passed before any change: 18 files, 287 tests, build OK. Docker still inaccessible, no `.env.local`.

### Why this task
The previous handoff suggested P7 next, but the plan's dependencies are P7 ← P6 ← P2, and P2's interview wasn't built. The critical path
(`P2 → P3 → P4 → P6 → P7`) makes the interview the first unfinished item. Live Supabase is still blocked on the user (Docker group or hosted project).

### What was done
- `PlaybookSchema` (`src/modules/ai/playbook.ts`) + playbook `src/playbooks/university-hackathon.ts` (v1, 19 questions) + `src/playbooks/index.ts`.
- Pure interview logic `src/modules/events/interview-rules.ts`; `listInterviewAnswers`/`saveInterviewAnswers` (repo), `getInterview`/`saveInterview`
  (service), `saveInterviewAction` (actions) in `src/modules/events/`.
- Migration `supabase/migrations/20261022000001_interview.sql`: `interview_answers`, RPC `save_interview_answers`, RLS (members read, RPC-only writes).
- Page `src/app/app/events/[eventId]/interview/page.tsx`, component `src/components/events/interview-question.tsx`, "Planning interview" button on the event page.
- Tests: `tests/unit/events/interview.test.ts` (27), `tests/unit/events/interview-actions.test.tsx` (9), `tests/db/interview.test.ts` (13).
- Docs: `event.md` §16 (+ header, §2.3, §3, §12), `docs/IMPLEMENTATION_PLAN.md` P2, open decision 5, test totals; `PROGRESS.md` Phase 5.

### Commands run and results
| Command | Result |
|---|---|
| `npm run verify` (start) | ✅ 287 tests |
| `npx vitest run --project unit tests/unit/events/` | ✅ 36 (after fixing 1 real bug + 1 assertion wording) |
| `npx vitest run --project db tests/db/interview.test.ts` | ✅ 13 (after fixing 1 test mistake); mutation check fails 1 as intended, then restored |
| `npm run verify` (end) | ✅ lint, typecheck, format, 21 files / 336 tests (198 unit + 138 db), build |
| `next start` smoke, no Supabase env | ✅ interview route → 307 `/sign-in?next=…` |

### Decisions made
1. Playbooks live in `src/playbooks/` (not root `playbooks/`), so they're covered by the `@/` alias with no config change.
2. Conditions may reference only event facts or earlier questions, which rules out cycles by construction. Rounds are ≤ 5 new questions.
3. Answers are editable while the event is draft/planning/ready, read-only after that (TS + SQL). Skipped optional questions are stored as JSON `null`.
4. Answers whose question stops applying are deleted in the same RPC call. `custom.*` keys are reserved for P3 AI follow-ups.
5. Interview answers are not audit-logged (not a consequential action); `answered_by`/`updated_at` record the last change.

### Not verified
- No live Supabase: the RPC over PostgREST (named args, `jsonb` payload), the page against real data, and a browser walkthrough are untested.
- Concurrent saves by two organizers are not tested (PGlite is single-connection). Worst case is a no-longer-applicable answer, hidden on read.
- Nothing committed this session (commit only when asked).

### Exact next action
1. **Finish P2: edit event details + status transitions** on `/app/events/[eventId]`. Add `updateEventInput(timeZone)` to
   `src/modules/events/schemas.ts` (partial of `eventFormInput` + optional `status`), `updateEvent`/`changeEventStatus` in
   `events/{repo,service,actions}.ts` (service checks `canTransition` → `AppError("invalid_transition")`; the DB trigger in
   migration 0003 already enforces it), and offer only the allowed next statuses from `EVENT_TRANSITIONS`. Tests: an action-authorization
   test (viewer refused, invalid transition → `invalid_transition` message), plus a DB test that the organizer update path works (0003 grants `status`).
   Changing timezone or dates must re-evaluate `event.duration_hours`; the interview already recomputes on read.
2. Then **P3 — AI adapter & plan generation** (mock provider first, `AI_PROVIDER=mock`), which reads `interview_answers` via `interviewState().answered`.
3. Still pending on the user: Docker access (`sudo usermod -aG docker $USER`, re-login) or a hosted Supabase project. Then run `npm run db:reset` and
   walk through the interview and marketplace flows in a browser (`docs/SESSION_HANDOFF.md` earlier sections list the marketplace walk-through).

### Configuration still required
- `.env.local` with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (names in `.env.example`; never paste values in chat).
- Hosted projects: confirmation template + redirect URLs (`event.md` §14.1); first admin via SQL (§14.7).

---

## Earlier session: 2026-10-21 — Phase 4 (provider marketplace)

### What was done
- Migration `20261021000004_marketplace.sql` + demo seed; modules `profiles/providers-*`, `marketplace/*`, `bookings/*`, minimal `events/*` (`event.md` §15).
- Pages: marketplace directory/detail, events create/list/detail, request create + organizer comparison, provider onboarding/management,
  provider inbox/response, admin review. Shared `ActionForm` (keeps input, focused error summary) and `ConfirmSubmit`.
- Tests: 125 DB tests on PGlite (26 new for the marketplace), 162 unit tests incl. authorization with a Supabase double and server-page render
  smoke tests. `npm run verify` passes.

### Conflicts / decisions made
1. **Events UI was missing** (P2 not built) but requests need events, so a minimal create/list/detail slice was built. The adaptive interview is still P2.
2. **Verification vs moderation:** Phase 3 stored `suspended` inside `verification_status`. The brief asks for separate states, so 0004 adds
   `moderation_status` (active/hidden/suspended) and migrates existing rows. `rules.ts`, tests and docs are updated.
3. **Demo providers can't receive requests** (no members), so nobody can quote on their behalf.
4. **Credentials are metadata only** (reference number, issuer, expiry). File upload needs Supabase Storage on a live project.
5. **Quotes have no `accepted` state.** Acceptance → booking is P10 behind the P7 approval gate. The UI says so on every quote surface.

### Not verified
- No live Supabase: PostgREST embedded selects, RPC argument names over HTTP, cookies in a browser, and the full click-through are untested.
- No browser or accessibility pass on the new pages. Render tests use a fake client.

### Next task
1. **Connect Supabase** (still blocked on Docker group or a hosted project, both need the user), `npm run db:reset`, then walk through:
   organizer creates event → shortlists demo + real provider → provider (second account) creates listing → admin verifies (§14.7) →
   organizer requests quote → provider asks question, submits quote → organizer compares, declines.
2. Then P7 (communications & approvals) so P10's `accept_quote` → booking can go through the approval gate.

---

## Earlier session: 2026-10-21 — Phase 3 (authentication, authorization & database)

### What was done
- Supabase Auth via `@supabase/ssr` with server actions (no browser Supabase client, no service-role client in app code).
- Migrations: `20261021000001_accounts.sql`, `20261021000002_providers.sql`, `20261021000003_events.sql` (`event.md` §14.3).
- Pages: `/sign-up`, `/sign-up/check-email`, `/sign-in`, `/auth/confirm`, `/auth/error`, `/onboarding`, `/account-status`; `/app` is gated
  (`src/proxy.ts` + `MemberGate`/`requireMember`); `/app/settings` edits profile and roles; header shows the member and sign-out.
- Local DB testing on PGlite with a Supabase shim (`tests/db/`): 81 tests for unauthenticated, unauthorized, role, ownership,
  escalation, privileges and audit. Full suite: 209 tests; `npm run verify` passes.
- Fixed two security bugs the tests and build output exposed (`PROGRESS.md` Phase 3).

### Not verified (be explicit when reporting)
- No live Supabase project was used: no real sign-up, email, `getClaims` against JWKS, or browser cookie refresh.
- `supabase start` / `db reset` / `db lint` / `gen types` not run (Docker socket permission denied).
- No browser-based manual test of the forms. Server actions are covered by unit tests with a Supabase double.

### Next task
1. **Connect Supabase (needs the user):** either `sudo usermod -aG docker $USER` + re-login then `npm run db:start && npm run db:reset`,
   or create a hosted dev project and `npx supabase link` + `npx supabase db push`. Put the URL and publishable key in `.env.local`
   (never in chat). For hosted projects also set the confirmation template and redirect URLs (`event.md` §14.1).
2. Manually run: sign up → confirm email → onboarding → settings → sign out → sign in; suspend a test user as admin (§14.7) and confirm the redirect.
3. `npm run db:types` and switch repos to the generated types.
4. Then **P2 — Events & adaptive interview** (event create/list UI on the existing `events` schema).

---

## Earlier session: 2026-10-21 — Phase 2 (application foundation & design system)

### What was done
- Clean `npm install` → `package-lock.json`; `npm ci` verified. No new dependencies.
- Read bundled Next 16 docs (CSS, error handling, route handlers, partial prefetching, `usePathname`, `connection`).
  Kept `cacheComponents`, `partialPrefetching` and the `@tailwindcss/turbopack` loader (`event.md` §2.5).
- Design system: tokens + dark mode in `src/app/globals.css`, components in `src/components/ui/`, shell in
  `src/components/shell/`, documented in `event.md` §13.
- Pages: `/`, `/app` + 7 sections (labelled placeholders), `/sign-in` (no form), `/status`, `/api/health`, `/design-system`,
  error/not-found/loading boundaries.
- Tooling: `.prettierrc.json`, `.prettierignore`, `vitest.config.mts` (+ `server-only` stub alias), `vitest.setup.ts`
  (jest-dom; `<dialog>` polyfill for jsdom).
- `npm run verify` passes (lint, typecheck, format:check, 73 unit tests, build). Command results are in `PROGRESS.md`.

### Known limitations
- `/app/**` is reachable without auth **by design for this phase**, shown as a preview with no data. P1 must add `src/proxy.ts` + `requireUser()`.
- No manual browser, keyboard or screen-reader pass and no axe/Lighthouse run yet. Accessibility is covered by unit tests (roles, labels, contrast) only.
- `npm audit`: 5 high findings in dev-only lint tooling; not fixed (fix is a breaking downgrade).
- Nothing committed. Open decision 5 (git root in the parent folder) is still unresolved and blocks a clean first commit.

### Next task
**P1 — DB foundation, auth, RLS, audit** (`docs/IMPLEMENTATION_PLAN.md`), starting with the remaining P0 items:
1. Decide local Docker Supabase vs hosted dev project (open decision 1). Docker socket access was denied for this user last time.
2. Add `@supabase/supabase-js`, `@supabase/ssr`, `supabase` CLI (dev), `@playwright/test`; scripts `test:db`, `test:e2e`, `db:*`; `supabase init`;
   a Vitest `db` project.
3. `src/lib/errors.ts`, `src/lib/http.ts`; ESLint `no-restricted-imports`.
4. Then migrations 0001–0003, Supabase clients, `src/proxy.ts`, real `/sign-in`, `requireUser`/`requireEventRole`, and the RLS DB tests.

---

## Earlier session: 2026-10-21 — Phase 1 (architecture & plan)

### State of the repo
- Path: `~/Desktop/HALA_EVENTS/HalaEvents` (renamed from `EventPilot`, which was an empty folder).
- Git initialised (`master`), **no commits**.
- Docs only: `CLAUDE.md`, `event.md`, `PROGRESS.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/SESSION_HANDOFF.md`, `.env.example`, `.gitignore`.
- No application code, no dependencies installed. Architecture is **documented, not tested**.
- Toolchain on this machine: Node 24.21.0, npm 11.19.0, git 2.53.0. Docker installed but daemon socket access is
  denied for the current user; Supabase CLI not installed. Local DB tests cannot run until one of these is fixed.
- Source spec: `~/Downloads/EventPilot_AI_Project_Report.docx` (outside the repo, still uses the old name; not modified).

### Phase 1 review pass (same day)
- Re-ran the Phase 1 brief against the docs. Added: shared Zod schema catalogue, `ApprovalActionType` list and
  error→HTTP mapping (`event.md` §10.1); per-module acceptance/test table (`IMPLEMENTATION_PLAN.md`); Docker/Supabase CLI finding.
- The re-pasted brief is titled "EVENTPILOT"; the project name remains **HalaEvents** per the user's rename request.

### Reconciliation pass (same day, later session)
Between sessions a scaffold was started but not finished. Found: `package.json` (Next 16.4.2, React 19.3.0, Zod 4.6.7,
Vitest 5.0.5, Tailwind 4.3.3, Prettier, Testing Library, jsdom; `verify` script), `tsconfig.json`, `eslint.config.mjs`,
`next.config.ts` (`cacheComponents`, `partialPrefetching`, Tailwind Turbopack loader), `.npmrc`, `AGENTS.md`,
`src/app/favicon.ico`, empty `public/`. `node_modules` is **incomplete** (package dirs without `package.json`,
no `.bin`, no lockfile) and no install process was running, so lint/typecheck/test/build were **not** run.
Docs updated: `event.md` §2.1, §2.5, §4 (approval), §5.1–5.4, §9, §12; `IMPLEMENTATION_PLAN.md` P0 rewritten as
"finish, don't re-scaffold", P1/P6/P7 acceptance, test strategy, open decisions 5–6; `CLAUDE.md` commands note.
Nothing was implemented; architecture remains **documented, not tested**.

### Next step
Finish **P0** starting at step 1 (clean `npm install`, then read bundled Next 16 docs). Resolve open decision 5
(git root) before the first commit, and decisions 1–3 before P1/P3/P7.

### Conflicts between the requested architecture and the source material
1. **Required docs did not exist.** `CLAUDE.md`, `event.md`, `PROGRESS.md`, `docs/SESSION_HANDOFF.md` were missing and
   the repo was empty; they were created in this session from the project report. There was no existing code to reconcile.
2. **Scope expansion.** The Phase 1 brief adds member/provider profiles, a provider marketplace, service requests, quotes,
   bookings and reviews. The report has none of these and lists autonomous booking as out of scope. Resolution: providers
   are platform users who confirm bookings themselves in-app (a real party confirms, so no false "booked" claims); no
   payments; these modules are scheduled after the demo-critical path (P9–P10).
3. **Timeline vs scope.** The report targets 24–48 h for 3–4 people; 11 modules will not all fit. Critical path defined in the plan.
4. **Project structure.** Report suggests `eventpilot/` with flat `lib/ai.ts`, `lib/schemas.ts`… Replaced by `src/modules/<m>/`
   with per-module schemas/rules/repo/service for ownership clarity.
5. **Data model.** Report's `tasks.depends_on` column replaced by a `task_dependencies` join table (multiple deps, cycle checks);
   `monitoring_alerts` replaced by `incidents` + `replan_proposals`; `integration_connections` deferred (no OAuth integrations in MVP).
6. **Endpoints.** Report's `POST /api/messages/:id/send` replaced by approval execution (`/api/approvals/:id/execute`) so every
   send passes the approval gate; `POST /api/registrations` becomes the public `/api/public/events/:slug/register`.
7. **Official sources.** Dubai DET / DDA links from the report are to be seeded as **unverified** `knowledge_sources`;
   nobody has checked them yet.
8. **Supabase key naming.** Docs use the newer publishable/secret key names; legacy anon/service-role keys map to the same variables.
9. **Partial scaffold vs plan (new).** See `event.md` §12: broken install, missing layout/page, unverified
   `next.config.ts` options, missing Supabase/Playwright deps and scripts, `middleware.ts` → `proxy.ts` in Next 16,
   git root is the parent folder. The plan's P0 now finishes the existing scaffold instead of re-running `create-next-app`.
10. **Admin key usage narrowed.** Earlier draft routed public registration through the admin client; now an
   `anon`-granted `security definer` RPC, so the secret key is used only for seeding and tests.

## Groq fix (2026-10-23)
- Cause: `GROQ_API_KEY` held an xAI key (`xai-`), `GROQ_MODEL` was `grok-4.7`. xAI keys/models don't work on api.groq.com.
- Done: key-prefix check in `src/lib/env.server.ts` + test; `GROQ_MODEL=llama-3.3-70b-versatile` in `.env.local`.
- Next: put a real `gsk_` key in `.env.local`, restart `npm run dev`, then one live plan generation (confirm the model id at console.groq.com/settings/limits first). If xAI/Grok is wanted instead, that needs a new adapter (not built).

## xAI (Grok) provider (2026-10-23)
- Added `AI_PROVIDER=xai` (`XAI_API_KEY`, `XAI_MODEL`). Next: edit `.env.local` as listed in PROGRESS.md, restart `npm run dev`, generate one plan. Note xAI's own sample uses `/v1/responses`; we use `/v1/chat/completions` (not yet confirmed live).

## Session 2026-10-23 (late): external AI removed, playbook engine is the only planning path
- **Read first:** `event.md` §17.0 (current architecture) and `PROGRESS.md` last section. Everything about Gemini/Groq/xAI in §6 and §17.1–17.6 is history.
- `src/modules/ai` is now `src/modules/planning` (engine.ts, rules.ts, schemas.ts, playbook.ts, service.ts, repo.ts, actions.ts). DB tables/RPCs keep their `ai_*` names.
- Playbooks: `/playbooks/{university-hackathon,conference,workshop}.json`, registered in `src/playbooks/index.ts`. To add an event type: JSON playbook + `EventType` enum + CHECK migration + `EVENT_TYPE_LABELS`; the tests in `tests/unit/planning/engine.test.ts` (dependency order, schedule, no-AI scans) and `tests/db/ai.test.ts` then cover it if you add it to their lists.
- `.env.local` no longer has AI variables. A dev server (`next-server`) was already running when `npm run verify` ran the build, so **restart `npm run dev`** (shared `.next`).
- Next: browser walkthrough of Plan / Interview / Messages / Incidents; hosted Supabase: apply migration `20261023000003`; decide whether to edit assumptions in place.
