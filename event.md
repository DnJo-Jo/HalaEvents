# HalaEvents — Product Specification & Architecture

> Status: **documented, not implemented, not tested.** Architecture agreed in Phase 1 (2026-10-21);
> reconciled with the partial Phase 0 scaffold on the same day (§12). Application foundation and design
> system built and verified 2026-10-21 (§13). Auth, profiles/roles, provider profiles, events schema,
> RLS and audit implemented 2026-10-21 (§14) and tested on a **local PGlite database, not a live Supabase project**.
> Provider marketplace (listings, directory, shortlists, service requests, questions, quotes) implemented 2026-10-21 (§15),
> tested the same way. No booking exists yet: a quote is never a booking.
> Source: `EventPilot_AI_Project_Report.docx` (14 Oct 2026), renamed to HalaEvents, extended with the
> Phase 1 module list (providers, marketplace, quotes, bookings, reviews) which the report did not cover.

---

## 1. Product summary

HalaEvents is a source-aware, approval-driven event operations platform. It takes an organizer from an
idea to a coordinated event: structured event profile → adaptive interview → source-backed plan
(tasks, deadlines, dependencies, requirements) → attendee applications → approved communications →
provider sourcing (quotes/bookings) → disruption recovery → close-out and reviews.

**First event type:** university hackathons (Dubai/UAE context first).
**Core principle:** the organizer stays in control. HalaEvents recommends and prepares; it does not
autonomously send, book, pay, or file.

### 1.1 Users and roles
| Actor | Description |
|---|---|
| Visitor | Unauthenticated; can view a published registration page and apply. |
| Member | Any authenticated user with a profile. |
| Event owner / organizer / viewer | Event-scoped roles via `event_members`. |
| Provider owner / staff | Provider-scoped roles via `provider_members` (venues, caterers, AV, etc.). |
| Platform admin | Verifies providers, moderates reviews. `platform_admins` table. |

### 1.2 Demo journey (must work end-to-end, mock mode allowed)
1. Organizer creates a university hackathon.
2. Adaptive interview asks context-dependent follow-ups.
3. Plan generated: tasks with dependencies + requirements labelled verified / conditional / recommended.
4. Organizer accepts plan suggestions → tasks persisted.
5. Participant applies; organizer reviews → accepted / waitlisted (capacity enforced).
6. Acceptance email drafted → approval → sent (real or mock).
7. Organizer requests catering quote from a matched provider; provider quotes; organizer accepts (approval) → booking pending → provider confirms.
8. Simulated venue cancellation → incident → re-plan proposal → organizer approves selected changes.
9. After event: booking completed → review left; audit log shows every consequential action.

---

## 2. Architecture

### 2.1 Runtime & stack
| Concern | Decision |
|---|---|
| App | Single Next.js app (App Router), TypeScript `strict`, Tailwind CSS v4. Pinned in `package.json`: `next 16.4.2`, `react`/`react-dom 19.3.0`, `typescript 5.9.3`, `tailwindcss 4.3.3`, `zod 4.6.7`, `vitest 5.0.5` (`.npmrc`: `save-exact`, `engine-strict`). |
| Runtime | Node.js 24.x (`engines: >=24 <25`; dev machine 24.21.0, npm 11.19.0). Node runtime for all route handlers (no Edge). |
| Database | Supabase PostgreSQL. Migrations in `supabase/migrations/` via Supabase CLI. |
| Auth | Supabase Auth (email magic link + password), cookie sessions via `@supabase/ssr`. |
| DB access | `@supabase/supabase-js 2.118.0` + `@supabase/ssr 0.12.7` (no ORM). Rows parsed with Zod in `repo.ts`; generated types (`npm run db:types`) need a running local Supabase (Docker), not yet available. |
| DB tooling (dev) | `supabase 2.121.0` CLI (config + migrations), `@electric-sql/pglite 0.5.11` (in-process Postgres for migration/RLS tests without Docker, §14.6). |
| Validation | Zod (v4) — inputs, outputs, env, model responses. |
| AI | Gemini via `@google/genai`, behind the `AiProvider` adapter (§6). |
| Email | `mock` by default; Resend optional (single provider). |
| Tests | Vitest (unit + DB; jsdom + Testing Library for component tests), Playwright (e2e demo journey). |
| Formatting | Prettier + `prettier-plugin-tailwindcss` (already in `package.json`, part of `npm run verify`). |

No other runtime dependencies are planned. RAG uses curated playbooks + stored source excerpts selected by
tags; **no vector DB in the MVP** (pgvector is a later option inside the same database).

### 2.2 Layering
```
Browser (React client components)            ← only NEXT_PUBLIC_* config, no secrets
   │  fetch / form posts
   ▼
src/app/api/**/route.ts  (thin)              ← Zod-parse input, get session, call service, map errors
src/app/**/page.tsx (server components)       ← read via services directly (no self-fetch)
   ▼
src/modules/<m>/service.ts  (server-only)    ← authorization (requireUser / requireEventRole …),
   │                                            state-transition checks, orchestration, audit
   ├── rules.ts   (pure, deterministic, unit-tested)
   ├── repo.ts    (supabase queries + RPC calls)
   └── src/lib/ai, src/lib/integrations (adapters, mock/real)
   ▼
PostgreSQL: tables + CHECK constraints + RLS + plpgsql functions (transactions) + audit triggers
```

### 2.3 Module structure
```
src/
  app/                         # routes & pages (UI + API), no business logic
  lib/
    env.server.ts              # Zod-validated server env (server-only)
    env.client.ts              # NEXT_PUBLIC_* only
    db/                        # supabase server/browser/admin clients, generated types
    auth/                      # getSession, requireUser, requireEventRole, requireProviderRole, requireAdmin
    ai/                        # AiProvider interface, gemini.ts, mock.ts, index.ts (factory)
    integrations/              # email/, weather/, places/ — each: interface + mock + real
    audit/                     # writeAudit helper (for non-trigger audit entries)
    errors.ts, http.ts         # AppError, toResponse()
  modules/
    auth/                      # sign-in/out, session helpers, role checks
    profiles/                  # member profiles, provider onboarding & verification
    events/                    # events, event_members, interview answers, event lifecycle
    marketplace/               # provider listings, search, deterministic matching
    bookings/                  # service_requests, quotes, bookings
    tasks/                     # tasks, task_dependencies, DAG rules, blocked/overdue derivation
    ai/                        # orchestrator pipelines, playbooks, ai_suggestions
    compliance/                # knowledge_sources, event_requirements, requirement_evidence
    attendees/                 # attendees, applications, eligibility rules, capacity RPCs
    comms/                     # communications, approvals, send pipeline
    trust/                     # reviews, audit_log queries, incidents, replan proposals
supabase/
  migrations/                  # numbered SQL migrations (schema, RLS, functions, triggers)
  seed.sql                     # demo data (one hackathon, providers, sources)
playbooks/
  university-hackathon.ts      # versioned curated playbook (questions, tasks, risks)
tests/
  unit/ db/ e2e/
```
**Ownership rule:** a module's tables are written only by that module's `repo.ts`/RPCs. Other modules call its
`service.ts`. Cross-module reads may use the other module's `repo` read functions.

### 2.4 Module boundaries
| Module | Owns tables | Exposes | Depends on |
|---|---|---|---|
| auth | (Supabase `auth.users`), `platform_admins` | `requireUser`, role guards | — |
| profiles | `profiles`, `providers`, `provider_members`, `provider_services` | profile CRUD, provider onboarding/verification | auth |
| events | `events`, `event_members`, `interview_answers` | event CRUD, lifecycle transitions, membership | auth |
| tasks | `tasks`, `task_dependencies` | CRUD, dependency validation, blocked/overdue | events |
| ai | `ai_runs`, `ai_suggestions` | pipelines: interview, plan, replan, draft, match-explain | events, tasks, compliance, lib/ai |
| compliance | `knowledge_sources`, `event_requirements`, `requirement_evidence` | requirements CRUD, verification | events |
| attendees | `attendees`, `applications` | register (public), review, decide, check-in | events, comms |
| comms | `communications`, `approvals` | drafts, approval decisions, execute/send | events, integrations |
| marketplace | (reads providers), `provider_blackouts` | search, match scoring | profiles, events |
| bookings | `service_requests`, `quotes`, `bookings` | RFQ, quote, accept (via approval), confirm | marketplace, comms(approvals) |
| trust | `reviews`, `audit_log`, `incidents`, `replan_proposals` | reviews, audit queries, incident/replan flow | everything (read), ai |

### 2.5 Next.js 16 constraints (checked against `node_modules/next/dist/docs/` on 2026-10-21)
`AGENTS.md` warns that this Next.js version differs from older conventions. Decisions that depend on it:
- **Session refresh lives in `src/proxy.ts`** (Next 16 renamed `middleware.ts` to `proxy.ts`). The proxy only refreshes
  the Supabase cookie and redirects unauthenticated page requests. It is **not** an authorization layer: services
  still check every operation.
- **`cacheComponents: true`** is set in `next.config.ts`. Rule: never put `"use cache"` (or any cache API) on code that
  reads cookies/session or returns RLS-scoped or per-user data. Caching is allowed only for public, non-personal
  data (published playbooks, verified provider listings without PII). Pages that read the session render dynamically
  inside `<Suspense>`.
- `partialPrefetching: true` is a documented option that requires `cacheComponents`. It is recommended for new apps, and the
  build log confirms both are enabled. Links prefetch the route's static App Shell.
- Tailwind runs through the official `@tailwindcss/turbopack` loader (its README shows this exact `turbopack.rules` config),
  so there's no `postcss.config`. The Next docs describe the `@tailwindcss/postcss` path instead. Switch only if the loader causes problems.
- Error boundaries receive `{ error: unknown, retry }` (not `reset`); `global-error.tsx` renders its own `<html>` and
  cannot rely on `globals.css`.
- Request-time reads (env-based status, the mock banner) call `await connection()` inside a `<Suspense>` boundary.
  Otherwise they would be frozen at build time. Client components that call `usePathname()` sit inside `<Suspense>`
  because dynamic segments (e.g. `/app/events/[id]`, P2) would otherwise fail the build.

---

## 3. Data model
> Implemented so far: `profiles`, `user_roles`, `platform_admins`, `audit_log`, `providers`, `provider_private`,
> `provider_members`, `events`, `event_members`. Their exact columns and rules are in §14 and `supabase/migrations/`;
> where §14 differs from the table below, §14 wins.

All tables: `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`,
`updated_at timestamptz` (trigger). Status columns use CHECK constraints listing the values below.
`is_mock boolean default false` on rows produced by mock integrations.

| Table | Key fields | Relationships / constraints |
|---|---|---|
| profiles | user_id (pk → auth.users), display_name, phone, locale | 1:1 with auth user |
| platform_admins | user_id | |
| events | owner_id, name, event_type, status, venue_type, location_text, city, country, timezone (IANA), starts_at, ends_at, capacity, budget_amount, currency, registration_open, published_slug | CHECK ends_at > starts_at, capacity > 0 |
| event_members | event_id, user_id, role (owner/organizer/viewer) | unique(event_id,user_id); exactly one owner |
| interview_answers | event_id, question_key, answer jsonb, source (`organizer`/`ai_suggested_default`) | unique(event_id, question_key) |
| tasks | event_id, title, description, priority (low/medium/high/critical), status, due_at, owner_user_id, owner_label, origin (manual/ai_accepted/playbook), requirement_id? | |
| task_dependencies | task_id, depends_on_task_id | same event; no self-dependency; acyclic (checked in rules + RPC) |
| knowledge_sources | url, title, source_type (official_gov/venue_policy/organizer_rule/other), jurisdiction, excerpt, retrieved_at, last_verified_at, verified_by | |
| event_requirements | event_id, title, category, confidence (verified_source/conditional/recommended), status, applicability_note, source_id?, due_at | CHECK confidence ≠ verified_source OR (source_id NOT NULL) |
| requirement_evidence | requirement_id, kind (document/reference_number/note/link), value, recorded_by | e.g. organizer-recorded permit reference |
| attendees | event_id, full_name, email (citext), phone, participation_status | unique(event_id, email) where status not in (withdrawn) |
| applications | event_id, attendee_id, answers jsonb, eligibility_status, review_status, decision_reason, reviewed_by | 1 active per attendee |
| communications | event_id, attendee_id?, provider_id?, channel (email/whatsapp), recipient, subject, body, template_key, delivery_status, approval_id?, provider_name, provider_message_id, sent_at, failure_reason | |
| approvals | event_id, action_type, payload jsonb, payload_hash, status, requested_by, decided_by, decided_at, executed_at, result jsonb | |
| providers | name, category (venue/catering/av/security/photography/other), description, service_area (cities[]), min_capacity, max_capacity, price_min, price_max, currency, verification_status, rating_avg, rating_count | |
| provider_members | provider_id, user_id, role (owner/staff) | |
| provider_services | provider_id, title, unit, unit_price | |
| provider_blackouts | provider_id, starts_at, ends_at | provider-declared unavailability |
| service_requests | event_id, category, requirements jsonb, budget_max, needed_from, needed_to, status, invited_provider_ids uuid[] | |
| quotes | service_request_id, provider_id, amount, currency, terms, valid_until, status | unique(service_request_id, provider_id) for active quotes |
| bookings | event_id, quote_id (unique), provider_id, status, confirmed_by, confirmed_at | one booking per quote |
| reviews | booking_id, reviewer_user_id, target (provider/organizer), rating 1–5, body, status (published/hidden), provider_response | unique(booking_id, reviewer_user_id) |
| incidents | event_id, kind (venue_cancellation/weather/supplier_failure/other), severity, description, source_url, status, is_simulated | |
| replan_proposals | incident_id, ai_run_id, changes jsonb, status | |
| ai_runs | event_id, pipeline, provider, model, input_hash, status (succeeded/invalid_output/failed), error, latency_ms | prompts/outputs stored without secrets |
| ai_suggestions | event_id, ai_run_id, kind (question/task/requirement/message_draft/replan_change), payload jsonb, status (proposed/accepted/rejected/superseded) | |
| audit_log | actor_user_id (null = system), actor_kind (user/system/ai), entity_type, entity_id, event_id?, action, before jsonb, after jsonb, at | append-only |

---

## 4. Status models and valid transitions

Transitions are defined once per entity in `src/modules/<m>/rules.ts` as `const TRANSITIONS: Record<Status, Status[]>`
with a pure `canTransition(from, to)` used by services. Consistency-critical ones (✱) are additionally enforced in
plpgsql functions/triggers.

**Event** `draft → planning → ready → live → completed → archived`; `draft|planning|ready → cancelled`;
`ready → planning` (re-plan). Registration only when `registration_open` and status ∈ {planning, ready}.

**Task** `todo ⇄ in_progress → done`; `todo|in_progress → cancelled`; `done → in_progress` (reopen).
`blocked` is **derived**, not stored: a task is blocked if any dependency is not `done`/`cancelled`.
Cannot move to `done` while blocked. Overdue = `due_at < now()` and status ∉ {done, cancelled}.

**Event requirement** confidence ∈ {verified_source, conditional, recommended} (set by rules/human, never by AI to `verified_source`).
status: `open → in_progress → satisfied | not_applicable`; `satisfied|not_applicable → open`.

**Attendee participation ✱**
`identified → invited → registered`; `(public form) → registered`;
`registered → accepted | waitlisted | rejected`; `waitlisted → accepted | rejected`;
`accepted → confirmed → checked_in → followed_up`; `registered|accepted|waitlisted|confirmed → withdrawn`.
Entering `accepted` is capacity-checked inside `accept_attendee()` (row lock on event). If full → caller gets
`capacity_full` and may waitlist instead.

**Application review** `not_reviewed → under_review → approved | declined | needs_info`; `needs_info → under_review`.
**Eligibility** (deterministic, from organizer-defined rules only): `unknown | eligible | ineligible | needs_human_review`.
Ineligible never auto-rejects; it flags for review.

**Communication delivery** `draft → awaiting_approval → approved → queued → sent → delivered | read | failed`;
`awaiting_approval → draft` (rejected/edited); `draft|awaiting_approval|approved → cancelled`;
`failed → queued` (retry of the *same approved payload*). Delivery status never changes participation status.

**Approval ✱** `pending → approved | rejected | expired`; `approved → executing → executed | execution_failed`.
`claim_approval()` atomically claims `approved → executing` (idempotent; no double send) and refuses if the recomputed
`payload_hash` differs; `finish_approval()` records the outcome (§5.4 two-phase execution).

**Provider verification** `draft → submitted → verified | rejected`; `rejected → submitted`; `verified → suspended → verified`.
Only `verified` providers appear in marketplace search.

**Service request** `draft → open → quoted → awarded → closed`; `draft|open|quoted → cancelled`.
**Quote ✱** `submitted → accepted | declined | withdrawn | expired`. Accepting one quote declines the others in the
same request (single transaction, `accept_quote()`), requires an executed approval.
**Booking ✱** `pending_confirmation → confirmed | declined_by_provider`; `confirmed → completed | cancelled`;
`pending_confirmation → cancelled`. Only a provider member can confirm. Cancelling a confirmed booking requires approval.
**Review** created only when booking is `completed`, by an event owner/organizer (or provider for organizer review);
`published ⇄ hidden` (admin).

**Incident** `reported → assessing → replan_proposed → resolved | dismissed`.
**Replan proposal** `proposed → approved | partially_approved | rejected`; approved items applied via approval execution.

---

## 5. Security and authorization

### 5.1 Supabase Auth
- `@supabase/ssr` server client reads the session cookie; `src/proxy.ts` refreshes sessions (§2.5).
- Identity in services always comes from `supabase.auth.getUser()` / verified claims, never from an unverified
  cookie payload or a client-supplied user id.
- `requireUser()` → 401 if no session. Role guards query `event_members` / `provider_members` / `platform_admins` → 403.

### 5.2 Three keys, three clients
| Client | Key | Where | Purpose |
|---|---|---|---|
| browser | publishable/anon key | — | **not created** (all auth goes through server actions) |
| server (user) | publishable/anon key + user session cookie | `src/lib/db/server.ts` (`server-only`) | all user operations — RLS applies |
| admin | secret/service-role key | — | **not created.** The app has no runtime use for it; seeding/admin grants are done with DB-owner SQL |

Any use of the admin client must be preceded by an explicit server-side authorization check in the service and
is listed below. Admin client is never imported from `src/app/**` client components (lint rule + `server-only`).

**Approved admin-client uses (MVP), complete list:** `supabase/seed.sql` / seed scripts, DB test fixtures (creating
test users). That is all. Public registration does **not** use it: `register_attendee()` is a `security definer`
function granted to `anon`, which validates the slug and registration window itself. Approval execution runs with the
organizer's JWT. Adding any other use requires updating this list.

### 5.3 Row-level security (enabled on every table)
- Helper SQL functions (`security definer`, `stable`): `is_event_member(event_id, roles[])`, `is_provider_member(provider_id)`, `is_platform_admin()`.
- events/tasks/requirements/attendees/applications/communications/approvals/incidents: select for event members; insert/update for owner/organizer; viewers read-only. Attendee PII is not readable by providers.
- providers: public select where `verification_status = 'verified'`; members manage own; admins verify.
- service_requests: event organizers; invited provider members can select requests they're invited to.
- quotes: provider members insert/update their own; event organizers select quotes on their requests.
- bookings: event organizers + the provider's members.
- reviews: public select where published; insert only via `create_review()` checks.
- audit_log: select for event owner/organizers (event rows) and admins; **no update/delete policy for anyone**; inserts by triggers.
- Public registration: no anon table access. `POST /api/public/events/:slug/register` validates input, rate-limits by IP, and calls `register_attendee()` RPC.

### 5.4 Transactions & constraints
plpgsql functions (called via RPC): `register_attendee`, `accept_attendee`, `promote_from_waitlist`,
`claim_approval`, `finish_approval`, `accept_quote`, `confirm_booking`, `create_review`, `add_task_dependency` (cycle check).
Each locks the relevant parent row (`select … for update`), checks transition validity, writes, and lets the audit trigger fire.

- **Grants:** `revoke execute on all functions … from public`; each RPC is then granted explicitly to `authenticated`
  (and only `register_attendee` to `anon`). `security definer` functions set `search_path = ''` and re-check the
  caller's role with `is_event_member()` / `is_provider_member()` internally.
- **Uniqueness by constraint:** one booking per quote (`unique(quote_id)`), one accepted quote per request (partial
  unique index), one review per reviewer per booking, one active application per attendee (partial unique index).

**Two-phase approval execution (external side effects).** An email cannot be sent inside a DB transaction, so:
1. `claim_approval(id)`: in one transaction, lock the row, require `status = approved` and matching `payload_hash`,
   set `executing`, and return the payload. A second caller gets `conflict`, which is the idempotency guarantee.
2. The service performs the side effect through the integration adapter, passing `approval.id` as the idempotency key.
3. `finish_approval(id, result)`: `executing → executed | execution_failed`, which stores the provider response and fires the audit trigger.
DB-only actions (`accept_quote`, `cancel_booking`, `apply_replan`) do steps 1 and 3 in a single function with no
intermediate state. An approval stuck in `executing` (process crash between steps) is **not** auto-retried. It is
surfaced to the organizer, who checks for delivery before retrying, because silently resending could double-send.

### 5.5 Audit
Triggers on status columns of events, attendees, applications, communications, approvals, quotes, bookings,
event_requirements, incidents write `audit_log` (before/after, actor from `auth.uid()` or `system`). Services add
explicit entries for AI runs and approvals with the approved payload.

### 5.6 Data protection
- Minimal attendee data (name, email, optional phone, organizer-defined answers). No sensitive traits used for eligibility.
- Retrieved web content and model outputs are untrusted data: delimited in prompts, Zod-validated, never executed.
- Rate limiting on public registration and AI endpoints (in-memory token bucket for MVP; documented limitation).

---

## 6. AI orchestration

### 6.1 Provider adapter (`src/lib/ai/types.ts`)
```ts
export interface AiProvider {
  readonly name: "gemini" | "mock" | (string & {});
  generateStructured<T>(req: StructuredRequest<T>): Promise<AiResult<T>>;
}
export interface StructuredRequest<T> {
  pipeline: AiPipeline;               // "interview" | "plan" | "replan" | "draft_message" | "match_explain"
  system: string;
  messages: { role: "user" | "model"; content: string }[];
  schema: z.ZodType<T>;               // converted with z.toJSONSchema() for provider-side structured output
  temperature?: number;
  timeoutMs?: number;                 // default 30s
}
export type AiResult<T> =
  | { ok: true; data: T; model: string; latencyMs: number; usage?: { inputTokens: number; outputTokens: number } }
  | { ok: false; error: { code: "timeout" | "rate_limited" | "invalid_output" | "provider_error" | "not_configured"; message: string } };
```
- `getAiProvider()` picks implementation from `AI_PROVIDER` (`gemini` | `mock`). Model from `GEMINI_MODEL` (not hard-coded).
- Every result is `schema.safeParse`d by the adapter; one repair retry on `invalid_output`, then fail. Unvalidated data is never returned.
- Mock provider returns deterministic fixtures derived from the playbook, so the demo runs offline.
- Swapping providers = new file implementing `AiProvider`; no module outside `src/lib/ai` imports a vendor SDK.

### 6.2 Pipelines (fixed, not an autonomous loop)
Each pipeline: load context → select playbook + source excerpts → call `generateStructured` → apply deterministic
post-rules → store `ai_runs` + `ai_suggestions(status = proposed)`. The AI has **no side-effecting tools**.

| Pipeline | Output schema | Deterministic post-rules |
|---|---|---|
| interview | next questions (key, text, type, options, why) | drop questions already answered; max 5 per round; keys must exist in playbook or be namespaced `custom.*` |
| plan | tasks (temp ids, deps), requirements (claimed confidence + source refs) | dependency DAG check; due dates clamped before event start; any requirement citing no stored `knowledge_sources` id is downgraded to `conditional`/`recommended`; `verified_source` only when a source with `last_verified_at` exists |
| replan | affected task ids, proposed changes, message drafts | referenced ids must belong to the event; no status changes applied — proposals only |
| draft_message | subject, body, template_key | recipients chosen by code, not AI; body length limits; placeholders filled by code |
| match_explain | short rationale per provider | ranking computed deterministically (§7); AI text is explanatory only |

### 6.3 Deterministic vs AI responsibilities
| Deterministic (code/DB) | AI-suggested (needs acceptance) |
|---|---|
| State transitions, capacity, eligibility rules, dependency cycles, blocked/overdue, due-date bounds | Interview follow-up questions |
| Confidence labels' upper bound (verified only with verified source) | Task list, descriptions, priorities |
| Marketplace ranking & hard filters | Requirement candidates + applicability notes |
| Recipient selection, approval gating, sending | Message wording |
| Incident impact on tasks with explicit links | Re-plan proposals, match explanations |

### 6.4 Playbooks
TypeScript data files in `playbooks/` validated by a Zod `PlaybookSchema` at build/test time: questions (with
conditions on prior answers), base tasks, risk categories, default requirement candidates, close-out steps.
The interview's first round is playbook-driven (deterministic); AI adds follow-ups.

---

## 7. Marketplace matching (deterministic)
Hard filters: `verification_status = verified`, category match, event city ∈ service_area, no blackout overlapping
the needed window, capacity range covers expected attendance (venues/catering).
Score (0–100): budget fit 40, capacity fit 20, rating 20 (Bayesian average), response history 10, completed bookings 10.
Ties broken by name. Weights live in `marketplace/rules.ts` and are unit-tested.

---

## 8. Integrations & mock mode
| Integration | Env switch | Mock behaviour | Real (when configured) |
|---|---|---|---|
| AI | `AI_PROVIDER=mock\|gemini` | playbook-derived fixtures | Gemini structured output |
| Email | `EMAIL_PROVIDER=mock\|resend` | records `sent`, provider `mock`, `is_mock=true`; never `delivered` | Resend send API |
| Weather | `WEATHER_PROVIDER=mock\|open-meteo` | fixed forecast fixture labelled mock | Open-Meteo forecast (stretch) |
| Places | `PLACES_PROVIDER=mock\|none\|google` | seeded venue candidates | Google Places (stretch, discovery only) |
| WhatsApp | not in MVP | — | stretch |

A real integration selected without its key fails at startup env validation (fail fast), rather than silently using mocks.
The UI shows a "Mock" badge for `is_mock` rows and a global banner when any integration is mocked.

## 9. Environment variables
See `.env.example`. Server-only: `SUPABASE_SECRET_KEY`, `GEMINI_API_KEY`, `RESEND_API_KEY`, `GOOGLE_PLACES_API_KEY`.
Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_URL`.
(Projects still on legacy Supabase keys put the anon key in `…PUBLISHABLE_KEY` and service-role key in `SUPABASE_SECRET_KEY`.)

Validation (`src/lib/env.server.ts`, Zod, at first import):
- `AI_PROVIDER=gemini` requires `GEMINI_API_KEY` **and** `GEMINI_MODEL`; `EMAIL_PROVIDER=resend` requires `RESEND_API_KEY`
  and `EMAIL_FROM`; `PLACES_PROVIDER=google` requires `GOOGLE_PLACES_API_KEY`. Missing → readable startup error, never a silent mock fallback.
- `env.client.ts` reads only the four `NEXT_PUBLIC_*` names. A unit test fails if any non-`NEXT_PUBLIC_` name appears in it.
- `.env.example` contains names and non-secret local defaults only (local Supabase URL, `mock` switches).

## 10. API boundaries (route handlers)
All bodies validated with schemas from `src/modules/*/schemas.ts`. Auth: U = user, E:o = event owner/organizer, P = provider member, A = admin, Pub = public.

| Method & path | Auth | Purpose |
|---|---|---|
| POST /api/events | U | create event (creator becomes owner) |
| GET/PATCH /api/events/:id | E (read: any member) | read / update profile; status transitions |
| POST /api/events/:id/interview/next | E:o | get next questions (playbook + AI) |
| PUT /api/events/:id/interview/answers | E:o | save answers |
| POST /api/events/:id/plan | E:o | run plan pipeline → suggestions |
| POST /api/suggestions/:id/decision | E:o | accept/reject suggestion (accept materialises tasks/requirements) |
| POST/PATCH /api/tasks[/:id] | E:o | create/update task |
| POST/DELETE /api/tasks/:id/dependencies | E:o | add/remove dependency (cycle-checked) |
| POST/PATCH /api/events/:id/requirements[/:rid] | E:o | manage requirements, record evidence |
| POST /api/public/events/:slug/register | Pub | apply/register (rate-limited RPC) |
| PATCH /api/applications/:id | E:o | review decision |
| POST /api/attendees/:id/transition | E:o | accept/waitlist/confirm/check-in/withdraw |
| POST /api/events/:id/communications | E:o | create draft (optionally AI-drafted) |
| POST /api/communications/:id/request-approval | E:o | draft → awaiting_approval (creates approval) |
| POST /api/approvals/:id/decision | E:o | approve/reject |
| POST /api/approvals/:id/execute | E:o | execute approved action (idempotent) |
| GET /api/marketplace/providers | U | search + ranked matches for an event |
| POST/PATCH /api/providers[/:id] | U / P | onboard / edit provider; submit for verification |
| POST /api/admin/providers/:id/verification | A | verify / reject / suspend |
| POST /api/events/:id/service-requests | E:o | create RFQ, invite providers |
| POST /api/service-requests/:id/quotes | P | submit quote |
| POST /api/quotes/:id/accept | E:o | creates approval; execution runs `accept_quote()` → booking pending |
| POST /api/bookings/:id/confirm \| decline \| complete \| cancel | P / E:o | booking transitions |
| POST /api/bookings/:id/reviews | E:o / P | leave review |
| POST /api/events/:id/incidents | E:o | report/simulate incident |
| POST /api/incidents/:id/replan | E:o | run replan pipeline |
| GET /api/events/:id/audit | E:o | audit trail |

### 10.1 Shared Zod schemas
Schemas live in `src/modules/<m>/schemas.ts` and are imported by route handlers (input parsing), services,
client forms (same validation in the browser), and AI pipelines (model output). They contain no server-only imports.

**Common primitives** (`src/lib/schemas/common.ts`): `Uuid`, `IsoDateTime` (UTC, `z.iso.datetime()`), `IanaTimezone`,
`Email` (trimmed, lower-cased), `Money { amount: number ≥ 0, currency: ISO-4217 3 letters }`, `NonEmptyText(max)`,
`Pagination { limit ≤ 100, cursor? }`, `ApiError { code, message, details? }`.

**Status enums are the single source of truth in TypeScript** (`EventStatus`, `TaskStatus`, `ParticipationStatus`,
`ReviewStatus`, `EligibilityStatus`, `DeliveryStatus`, `ApprovalStatus`, `ApprovalActionType`, `ProviderVerificationStatus`,
`ServiceRequestStatus`, `QuoteStatus`, `BookingStatus`, `IncidentStatus`, `RequirementConfidence`, `RequirementStatus`).
Migrations repeat the values in CHECK constraints; a DB test asserts both lists match.

**`ApprovalActionType`** = `send_communication | accept_quote | cancel_booking | apply_replan`. Each has a payload schema
(discriminated union on `action_type`) that is validated at request time *and* at execution time.

**Request schemas (examples):**
| Schema | Fields / rules |
|---|---|
| `CreateEventInput` | name, eventType (`university_hackathon` for MVP), venueType, city, country, timezone, startsAt < endsAt, capacity int > 0, budget: Money? |
| `UpdateEventInput` | partial of the above + optional `status` (validated by `canTransition`) |
| `InterviewAnswersInput` | `answers: Record<questionKey, string \| number \| boolean \| string[]>` (keys checked against playbook/`custom.*`) |
| `TaskInput` / `TaskPatch` | title, description?, priority, dueAt?, ownerUserId?, ownerLabel?, status? |
| `AddDependencyInput` | dependsOnTaskId |
| `RequirementInput` / `EvidenceInput` | title, category, confidence (≠ verified_source unless sourceId), sourceId?; kind, value |
| `PublicRegistrationInput` | fullName, email, phone?, answers (validated against the event's organizer-defined form), consent: literal(true) |
| `ApplicationDecisionInput` | reviewStatus, decisionReason (required for declined/needs_info) |
| `AttendeeTransitionInput` | to: ParticipationStatus |
| `CommunicationDraftInput` | channel, audience (attendee ids or status filter), templateKey?, subject, body, aiDraft?: boolean |
| `ApprovalDecisionInput` | decision: `approve \| reject`, note? |
| `ProviderInput` | name, category, description, serviceArea[], capacity range, price range: Money |
| `ServiceRequestInput` | category, requirements, budgetMax: Money, neededFrom < neededTo, invitedProviderIds[] |
| `QuoteInput` | amount: Money, terms, validUntil (future) |
| `ReviewInput` | rating int 1–5, body ≤ 2000 |
| `IncidentInput` | kind, severity, description, sourceUrl?, isSimulated |

**AI output schemas** (`src/modules/ai/schemas.ts`): `InterviewQuestionsOutput`, `PlanOutput` (tasks with `tempId`, `dependsOn: tempId[]`,
requirements with `claimedConfidence`, `sourceIds[]`), `ReplanOutput`, `MessageDraftOutput`, `MatchExplanationOutput`.
All have bounded array lengths and string lengths to cap cost and abuse.

**Response mapping:** services return domain objects; route handlers map `AppError` codes to HTTP:
`unauthenticated` 401, `forbidden` 403, `not_found` 404, `validation_failed` 400, `invalid_transition` 409,
`conflict`/`capacity_full` 409, `rate_limited` 429, `ai_unavailable` 503.

## 11. Out of scope (MVP)
Payments; autonomous booking; claiming permits filed/approved; direct government portal filing; WhatsApp;
calendar sync; vector search; multiple event types beyond university hackathon.
Official starting points (Dubai DET, DDA) are seeded as `knowledge_sources` with `last_verified_at = null`
until a team member checks them — they are **not** verified by this document.

## 12. Reconciliation with the existing repository (2026-10-21)
What exists in addition to the Phase 1 docs (created by a `create-next-app`-style scaffold that did not finish):

| Found | Effect on architecture |
|---|---|
| `package.json` with Next 16.4.2, React 19.3, Zod 4.6.7, Vitest 5.0.5, Tailwind 4.3.3, Prettier, Testing Library, jsdom; scripts `dev/build/start/lint/typecheck/format/format:check/test/test:watch/verify` | Adopted as-is. `npm run verify` becomes the pre-merge gate. `test:db`, `test:e2e`, `db:types`, `test:ai-live` are still missing. |
| Missing deps: `@supabase/supabase-js`, `@supabase/ssr`, `@google/genai`, `@playwright/test`, `supabase` (CLI) | Added in P0/P1/P3 as planned. Each is already justified in §2.1. |
| `node_modules` incomplete: package dirs without `package.json`, no `.bin`, no lockfile | **Resolved:** clean `npm install` produced `package-lock.json`; `npm ci` reproduces it (445 packages). |
| `src/app/` holds only `favicon.ico`; no `layout.tsx`/`page.tsx`; `public/` empty | **Resolved:** root layout, landing, shell, error/not-found pages (§13). `public/` still empty (no assets needed). |
| `next.config.ts`: `cacheComponents`, `partialPrefetching`, Tailwind via Turbopack loader | **Resolved:** all three kept, see §2.5. |
| `AGENTS.md` (Next.js-generated agent rules) | Kept; bundled docs now present and were read. |
| No Prettier config, no `vitest.config.ts`, no `postcss.config.*`, no `src/app/globals.css` | **Resolved:** `.prettierrc.json`, `.prettierignore` (Markdown excluded, hand-formatted tables), `vitest.config.mts`, `vitest.setup.ts`, `globals.css`. No PostCSS config needed. |
| `npm audit`: 5 high (`braces` via `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob`) | Dev-only lint tooling, not shipped. The suggested `audit fix --force` downgrades to `eslint-config-next@14` (breaking), so it was not applied. Recheck when Next publishes a fix. |
| Git repo root is `HALA_EVENTS/` (parent), not `HalaEvents/`; no commits | Paths in docs are relative to `HalaEvents/`. Decide before first commit whether to move `.git` into `HalaEvents/` or keep the parent as root. |

## 13. Design system (built 2026-10-21)

### 13.1 Tokens (`src/app/globals.css`)
- **Raw values** live as CSS variables on `:root` and are redefined under `prefers-color-scheme: dark`. Tailwind reads them
  via `@theme inline`, so components use semantic utilities (`bg-surface`, `text-ink-muted`, `border-line`) and never need
  `dark:` color variants. There is no manual theme toggle yet; dark mode follows the OS.
- **Palette:** warm sand neutrals (`canvas #faf8f5`, `surface`, `surface-muted`, `line`, `line-strong`), ink text (`ink`, `ink-muted`),
  deep teal **primary** (`#0f5c5a`) for actions and focus, copper **accent** for eyebrows and "demo" labels, plus status pairs
  `success|warning|danger|info` each with a `-soft` background. Each fill color has an `-ink` partner for text on it.
- **Contrast is tested, not assumed:** `tests/unit/design/contrast.test.ts` parses the tokens and asserts WCAG ratios for every
  pair the UI uses, in both themes: body text ≥ 7:1, muted text/badges/alerts ≥ 4.5:1, input borders and focus ring ≥ 3:1.
- **Typography:** system font stack (includes Noto Sans Arabic for future RTL). No `next/font` download, so builds and the demo
  work offline. Scale: Tailwind defaults; page titles `text-2xl semibold tracking-tight`, landing display `4xl–5xl`.
- **Radii:** `sm 6px` (focus), `md 10px` (buttons, inputs), `lg 14px` (cards, tables), `xl 20px` (dialogs, hero panels), `full` (badges).
- **Shadows:** `xs` (resting controls), `sm` (hover), `md` (raised cards, menus), `lg` (dialogs, hero illustration). They stay subtle; borders do most of the separation.
- **Spacing/layout:** 4px Tailwind scale; content max-width `6xl` (shell, landing), `4xl–5xl` (status, design reference);
  gutters `px-4 sm:px-6 lg:px-8`; shell = 16rem sidebar at `lg`, collapsible top menu below.

### 13.2 Motion
`animate-fade-in` (200ms), `animate-rise` (280ms, 6px translate) and `animate-shimmer` (skeletons). Each uses one soft
ease-out curve, and only on entrance (pages, empty states, dialogs, menus) or hover feedback. Animations are applied with
`motion-safe:`, and a global `prefers-reduced-motion: reduce` rule removes all animation and transition time.

### 13.3 Accessibility rules
- One global `:focus-visible` outline (2px `--ring`, 2px offset); a "Skip to content" link targets `#main` on every page.
- Navigation uses `<nav aria-label>` and `aria-current="page"`. The mobile menu button has `aria-expanded`/`aria-controls`, and Escape and navigation close it.
- **Dialogs** use the native `<dialog>` + `showModal()`, which gives focus containment, Escape, an inert background and focus restoration with no
  dependency. `ConfirmDialog` is an `alertdialog`, focuses **Cancel** first, and blocks both buttons while pending. It is a UI safeguard
  only; the server approval gate (§5.4) remains mandatory.
- `FormField` wires label, `aria-describedby` (hint + error) and `aria-invalid`. `Alert tone="danger"` uses `role="alert"`, others `role="status"`.
- Tables have a caption and a focusable, labelled scroll region. Status is never shown by color alone: badges always carry text.

### 13.4 Components (`src/components/ui/`)
`Button` / `ButtonLink` (primary, secondary, ghost, danger; sm/md/lg; `loading` → spinner + `aria-busy`; defaults to `type="button"`),
`Input` / `Textarea` / `Select`, `FormField`, `Card` (+ Header/Title/Description/Body/Footer), `Badge` (+ `MockBadge` for `is_mock`
rows, `DemoBadge` for sample content), `Dialog`, `ConfirmDialog`, `Table` (+ THead/TBody/TR/TH/TD), `Spinner`, `Skeleton`, `EmptyState`,
`Alert`, `PageHeader`, `Icon` (inline SVG path; no icon library). `cn()` joins classes (no clsx/tailwind-merge). Dialogs are client
components and are imported directly, not through the barrel. Live reference: `/design-system` (sample content, labelled).

### 13.5 Pages and honesty rules
| Route | Purpose |
|---|---|
| `/` | Public landing: value proposition for organizers and providers, how it works, principles. The product illustration is labelled "Illustration — not live data". No metrics, testimonials or customer logos. |
| `/app`, `/app/{events,marketplace,tasks,attendees,messages,compliance,settings}` | Authenticated shell **preview**. Every section is a labelled placeholder ("Placeholder · planned for P_n") that lists what the module will do. A persistent banner says auth and the database are not connected, and lists mocked integrations. |
| `/sign-in` | Placeholder with **no form**: no credentials collected, no fake auth. |
| `/status`, `/api/health` | Dev health: env validity, integration modes, Supabase variables set/not set. Names and booleans only, never values; details hidden when `NODE_ENV=production`. `/api/health` returns 503 when the env is invalid and sends `Cache-Control: no-store`. |
| `/design-system` | Internal component reference; all content labelled sample. |
| `not-found.tsx` (root + `/app`), `error.tsx` (root + `/app`), `global-error.tsx`, `/app/loading.tsx` | Error and loading states. Error UI shows only the digest, never server messages, and states "No action was taken on your behalf". |

`tests/unit/shell/links.test.ts` fails if any nav item or internal `href` literal under `src/` does not resolve to a real page or route.
The shell is intentionally reachable without auth in this phase. P1 adds `src/proxy.ts` and server-side `requireUser()` to `/app/**`.

## 14. Authentication, authorization & database (implemented 2026-10-21)

### 14.1 Authentication flow (Supabase Auth, `@supabase/ssr`)
| Step | Implementation |
|---|---|
| Sign-up | `/sign-up` → `signUpAction` → `supabase.auth.signUp` with `emailRedirectTo = NEXT_PUBLIC_APP_URL/auth/confirm?next=/onboarding` → `/sign-up/check-email`. The same page appears whether or not the email already exists (no enumeration). Password: 8–72 chars, letters + digits (matches `supabase/config.toml`). No custom password storage. |
| Email verification | `enable_confirmations = true`. `supabase/templates/confirmation.html` links to `/auth/confirm?token_hash=…&type=email`, and the route calls `verifyOtp` server-side. The PKCE `?code=` link is also accepted (`exchangeCodeForSession`). Failures go to `/auth/error?reason=…`, which shows only fixed messages and never echoes the query. Hosted projects must set the same template and redirect URLs in the dashboard. |
| Sign-in | `/sign-in` → `signInAction` → `signInWithPassword`. Wrong password and unknown user produce the same message. `email_not_confirmed` offers "send a new link" (`resend`, generic response). |
| Sign-out | POST-only server action (`signOutAction`, `scope: local`) → `/sign-in?signed_out=1`. |
| Session | `src/proxy.ts` refreshes the cookie on every matched request and redirects visitors without a session from `/app/**`, `/onboarding` and `/account-status` to `/sign-in?next=…`. |
| Identity | `getSessionUser()` (`src/lib/auth/session.ts`) uses `supabase.auth.getClaims()`, which verifies the JWT, never `getSession()` cookie contents. It is wrapped in `react.cache` per request and calls `connection()` so it can't be prerendered. Services take the user id **only** from it; RPCs use `auth.uid()` and have no user-id parameter. |
| Redirect safety | `safeNextPath()` accepts only same-origin relative paths (rejects `//`, `/\`, schemes, control characters, over 512 chars). Email links use `NEXT_PUBLIC_APP_URL`, never the Host header. |
| Profile completion | `/onboarding` → `completeOnboardingAction` → RPC `complete_onboarding(name, phone, locale, roles[])`, which sets the profile, `onboarded_at` and roles atomically. |
| Gates | `requireMember()` (profiles service) enforces session, then `account_status = active` (else `/account-status`), then onboarding done (else `/onboarding`). Applied by `MemberGate` around all `/app` pages and called again by pages that read data. |
| Not configured | Without `NEXT_PUBLIC_SUPABASE_URL`/`…PUBLISHABLE_KEY`, auth pages say so, `/app/**` still redirects to sign-in, and `/api/health` reports `degraded` (503). Nothing simulates a login. |

### 14.2 Roles, moderation and verification (three separate concepts)
| Concept | Storage | Who can change it |
|---|---|---|
| **Account roles** `organizer`, `venue_provider`, `service_provider` (multiple allowed) | `user_roles (user_id, role)` | The member, for themselves (RLS + CHECK). They gate which actions are offered and grant no authority over others. |
| **Platform administrator** | `platform_admins` | Only DB owner SQL (see `supabase/seed.sql`). No API role has any write privilege, and `platform_admin` is rejected by the `user_roles` CHECK. |
| **Account moderation** `active / suspended / deactivated` | `profiles.account_status` (+ `status_reason`) | Only admins via `set_account_status()` (reason required, never on themselves). Non-active accounts fail `is_active_account()` and every write policy and RPC requires it. |
| **Provider verification** `draft → submitted → verified / rejected` (rejected → submitted by owner) | `providers.verification_status` (+ note, `verified_at/by`) | Owner: `submit_provider_for_verification()` (needs a contact email). Admin: `set_provider_verification()`. An admin can't verify a provider they belong to. *(Migration 0004 moved `suspended` out of verification into moderation.)* |
| **Listing moderation** `active / hidden / suspended` | `providers.moderation_status` (+ reason) | Admins only: `set_provider_moderation()` (reason required). Independent of verification and of the owner's `is_listed` pause (§15.2). |
| **Event roles** `owner / organizer / viewer` | `event_members` | Creator becomes owner automatically (trigger). The owner manages non-owner rows; the owner row is untouchable via the API. |
| **Provider roles** `owner / staff` | `provider_members` | Created by `create_provider()`. Invites are P9. |

An active account never implies a verified business: providers start as `draft` no matter the owner's account status.

### 14.3 Migrations (`supabase/migrations/`, applied in filename order)
| File | Contents |
|---|---|
| `20261021000001_accounts.sql` | Default-privilege lockdown; `profiles`, `platform_admins`, `user_roles`, `audit_log`; helpers `is_platform_admin()`, `is_active_account()`, `has_account_role()`; `handle_new_user` trigger (ignores user metadata); generic `audit_row_change()` trigger; RPCs `complete_onboarding`, `set_account_status`. |
| `20261021000002_providers.sql` | `providers` (public marketplace fields), `provider_private` (legal name, licence, contact; members and admins only), `provider_members` (one owner); `is_provider_member()`; RPCs `create_provider`, `submit_provider_for_verification`, `set_provider_verification`. |
| `20261021000003_events.sql` | `events` (CHECKs: time order, capacity 1–100000, slug format; trigger: valid IANA timezone, immutable owner, lifecycle transitions), `event_members` (one owner); `is_event_member()`; owner-membership trigger; audit-trail visibility for event managers. |

All tables have UUID or composite primary keys, FKs to `auth.users` / parents, `timestamptz` timestamps, an `updated_at`
trigger where rows are edited, CHECK-constrained statuses, partial unique indexes for single owners, and indexes on
membership and lookup columns. Audited: account-status changes, admin grants, role changes, provider create/delete,
verification changes, provider and event membership changes, and event create/delete/status.

### 14.4 Row-level security and privileges
- RLS is enabled on every table (test-enforced). `anon` has **no** table privileges and can execute **no** public function (test-enforced).
- **Column-level grants** decide what members may edit: `profiles(display_name, phone, locale)`, editable provider marketplace fields,
  `provider_private` contact fields, and editable event fields including `status` (transitions checked by trigger). Not editable through the API:
  `account_status`, `onboarded_at`, `verification_*`, `verified_*`, `kind`, `created_by`, `owner_id`, `event_type`. New events can't be inserted with a status.
- **Read scope:** own profile only (admins all); verified providers to any member, unverified only to their members and admins; `provider_private`
  and `provider_members` to members and admins only; events and rosters to event members (and admins); audit rows to admins, plus event owners and organizers for their events.
- **Lesson recorded:** `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE … FROM public` does **not** remove Postgres's global
  "PUBLIC may execute" default. The first test run found every RPC executable by `anon`. Fixed with a global revoke in 0001 plus an
  explicit `revoke execute on all functions in schema public from public, anon` at the end of every migration. Keep that line in new migrations.
- All `SECURITY DEFINER` functions pin `search_path = ''` (test-enforced) and only answer questions about `auth.uid()` or check admin rights first.

### 14.5 Cache Components and auth
Session reads happen only inside `<Suspense>` and after `connection()`. A build without Supabase variables initially
**prerendered "not configured" into static `/sign-up` HTML**; `connection()` in `getSessionUser()` and the auth pages fixed it.
All session-dependent routes now build as partial prerender (◐). Never wrap session-dependent code in `"use cache"`.

### 14.6 How this was tested — and what was NOT verified
- **Local DB tests (`npm run test:db`)** run the real migration files on **PGlite** (Postgres 17 compiled to WASM) on top of
  `tests/db/supabase-shim.sql`, which recreates Supabase's API roles, `auth.users`, `auth.uid()/jwt()` (from `request.jwt.claims`, as PostgREST sets it)
  and Supabase's default privileges. Tests switch to `anon` / `authenticated` per transaction, exactly like PostgREST.
- **Differences from real Supabase:** no GoTrue (sign-up, email, tokens), no PostgREST HTTP layer, no Supabase-managed extensions or
  `storage` schema, a simplified `auth.users`, and migrations run as a superuser rather than the platform's `postgres` role.
- **Not verified:** a live Supabase project, real sign-up/confirmation emails, `getClaims()` against real JWKS, cookie refresh in a
  browser, and `supabase db reset` / `db lint` (needs Docker, whose socket is not accessible to this user). Run these when a project or Docker is available (`docs/IMPLEMENTATION_PLAN.md` P1).

### 14.7 Granting the first admin
Run as the DB owner (SQL editor or `psql`): `insert into public.platform_admins (user_id, note) select id, 'initial admin' from auth.users where email = '…';`
There is intentionally no UI or API for this.

## 15. Provider marketplace (implemented 2026-10-21)

### 15.1 Module ownership
| Module | Tables / RPCs | Code |
|---|---|---|
| profiles (providers) | `providers` (+ 0004 columns), `provider_private`, `venue_profiles`, `provider_services`, `provider_documents`; `create_provider`, `submit_provider_for_verification`, `set_provider_verification`, `set_provider_moderation`, `review_provider_document` | `src/modules/profiles/providers-{repo,service,actions}.ts`, `labels.ts` |
| marketplace | `event_shortlists`; `search_providers()` (SECURITY INVOKER, so RLS applies) | `src/modules/marketplace/*` |
| bookings (requests & quotes) | `service_requests`, `service_request_invites`, `service_request_messages`, `quotes`; `create_service_request`, `invite_providers`, `set_service_request_status`, `decline_service_request`, `post_request_message`, `save_quote`, `withdraw_quote`, `decline_quote` | `src/modules/bookings/*` |
| events (minimal P2 slice) | `events` (create/list/detail only) | `src/modules/events/{repo,service,actions}.ts` |

### 15.2 Listings
- **Business profile** (`providers`): kind (venue/service), category (venue, catering, AV, security, photography, decor, transport, cleaning, other),
  description, city + service area, **pricing model** (per person/hour/day/event or price on request) + **indicative** range
  (CHECK: "price on request" never carries a price), guest capacity range, capabilities/facilities, website (https only),
  an **availability statement** (free text, always labelled "as stated by the provider — not a live calendar"), and the owner's `is_listed` pause.
- **Venues** add `venue_profiles`: setting, seated/standing capacity, address, area, access conditions, accessibility and suitability
  (both CHECK-constrained vocabularies; a trigger refuses venue details on non-venue providers).
- **Services** (`provider_services`): flexible packages per category with their own pricing, quantity range and inclusions; inactive ones are owner-only.
- **Credentials** (`provider_documents`): kind, title, reference number, issuer, expiry; admin review `submitted → accepted | rejected`
  (reason required to reject). Any owner edit resets the review. Visible to the provider's members and admins only. **No file upload yet**:
  Supabase Storage needs a live project, so only metadata is recorded.
- **Marketplace visibility = verified ∧ moderation active ∧ listed by owner** (`provider_is_public()`). Organizers can still see providers
  they invited after a listing is hidden, so received quotes stay readable.
- **Demo data**: `supabase/seed.sql` adds 8 fictional providers (`is_demo = true`, names start with "Demo", "Demo listing" badge, no members).
  `provider_can_receive_requests()` requires at least one member, so demo listings can be browsed and shortlisted but never sent a request.

### 15.3 Directory and shortlists
- `/app/marketplace`: text search (LIKE wildcards escaped), category (matches the provider's category **or** an active service's),
  city/service area, guests (inside the capacity range when stated), budget (hides providers whose indicative minimum exceeds it;
  "price on request" stays). Deterministic order (real listings first, then name, then id). 12 per page.
- `/app/marketplace/[id]`: details, venue section, services, verification date, demo/moderation labels, "shortlist for event", "request a quote".
- **Shortlists** (`event_shortlists`) are event-scoped: event members read; owner/organizers add and remove; only publicly listed providers can be added.

### 15.4 Service requests, questions and quotes — state machines
| Entity | States | Transitions (who) |
|---|---|---|
| Service request | `open`, `closed`, `cancelled` | open → closed / cancelled; closed → open / cancelled (event owner/organizer) |
| Invite (per provider) | `invited`, `declined` | invited → declined (provider member; not while a quote is submitted) |
| Quote | `draft`, `submitted`, `withdrawn`, `declined` (+ derived `expired`) | Provider: draft → draft/submitted/withdrawn; submitted → submitted (revision +1) / withdrawn; withdrawn → draft/submitted. Organizer: submitted → declined. Nothing leaves `declined`. **No `accepted` state**: accepting and booking are P10 (approval + provider confirmation). |

- Requests carry the event's **dates, expected attendance, requirements, budget, response deadline** plus a snapshot of event name, city and timezone
  for invited providers, who have no access to the organizer's `events` row. A request goes to 1–10 providers that can receive requests.
- Provider submissions need the request `open`, the invite not declined, and `valid_until` in the future. Expiry is derived, never stored.
- **Questions** are one thread per (request, provider): the organizer side and that provider only. No posting on cancelled requests.
- Times are entered as wall-clock times in the event's timezone (`zonedDateTime()`) and stored as UTC.
- All transitions live in `src/modules/bookings/rules.ts` **and** SQL functions; DB tests compare every (from, to, actor) pair.

### 15.5 Authorization (server + RLS)
| Data | Who can read | Who can write |
|---|---|---|
| Request | event owner/organizers; members of invited providers | RPCs only (managers) |
| Invites | managers: all invites of their request; a provider: **only its own invite row** | RPCs only |
| Messages | managers; that thread's provider | `post_request_message` (side verified) |
| Quotes | the quoting provider's members (incl. drafts); event owner/organizers see **non-draft** quotes of their request (the authorized comparison view). Viewers and other providers see none. | RPCs only |
| Credentials, private contact | provider members, admins | owner (credentials: metadata only; review by admins) |

Services re-check every operation from the verified session before calling the database: event manager for organizer actions,
provider membership for provider actions, owner for listing edits, `isAdmin` for admin pages (non-admins get a 404). Bound action
arguments are validated as UUIDs.

### 15.6 UI routes
| Route | Who | Purpose |
|---|---|---|
| `/app/marketplace`, `/app/marketplace/[id]` | members | directory with filters, provider detail, shortlist, start a request |
| `/app/events`, `/app/events/new`, `/app/events/[id]` | members / organizers | minimal events (create, list, detail with shortlist and requests). Interview and plan are P2 |
| `/app/requests/new?event=&provider=`, `/app/requests/[id]` | event owner/organizers | create a request; compare quotes; decline quotes; close/reopen/cancel; reply to questions |
| `/app/provider`, `/app/provider/new`, `/app/provider/[id]` | providers | listings, profile, venue details, services, credentials, submit for verification, pause |
| `/app/provider/requests`, `/app/provider/requests/[requestId]/[providerId]` | provider members | inbox; ask questions, decline, draft/submit/revise/withdraw quotes |
| `/app/admin/providers`, `/app/admin/providers/[id]` | platform admins | review queue (filters), verify/reject, moderate, review credentials |

Navigation shows "My business"/"Quote requests" only to provider roles and "Provider review" only to admins (convenience only; pages authorize).
Consequential buttons (cancel request, decline quote/request, withdraw, delete) ask for confirmation. Forms keep input on validation errors and show
a focused error summary (`ActionForm`).

### 15.7 Tests and limits
- **DB (PGlite):** `tests/db/marketplace.test.ts` (26 tests) covers seed labelling, directory visibility and filters, wildcard escaping, pause/hide,
  service and venue ownership, credential privacy and review reset, shortlist permissions, request creation rules, read isolation between providers,
  thread isolation, quote privacy (drafts, other providers, viewers), revisions, every invalid transition, closed/cancelled behaviour, suspended
  organizers, and TS↔SQL transition parity. One mutation check: weakening the quote read policy fails 3 tests.
- **Unit:** authorization in actions/services with an in-memory Supabase double (`tests/unit/marketplace/authorization.test.ts`), rules and labels,
  timezone conversion, and **server-page render smoke tests** (`pages.test.tsx`).
- **Not verified:** none of these pages have run against a real Supabase/PostgREST. Embedded selects (e.g. `providers (name, …)`) and RPC
  argument mapping are untested against the real API, and no browser test has been run. Concurrency (two organizers acting at once) is protected by
  `select … for update` in the RPCs but not tested (PGlite is single-connection).
