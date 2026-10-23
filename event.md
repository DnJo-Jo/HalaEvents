# HalaEvents — Product Specification & Architecture

> Status: **documented, not implemented, not tested.** Architecture agreed in Phase 1 (2026-10-21);
> reconciled with the partial Phase 0 scaffold on the same day (§12). Application foundation and design
> system built and verified 2026-10-21 (§13). Auth, profiles/roles, provider profiles, events schema,
> RLS and audit implemented 2026-10-21 (§14) and tested on a **local PGlite database, not a live Supabase project**.
> Provider marketplace (listings, directory, shortlists, service requests, questions, quotes) implemented 2026-10-21 (§15),
> tested the same way. No booking exists yet: a quote is never a booking.
> Adaptive interview, deterministic playbook round (P2), implemented 2026-10-22 (§16), tested the same way.
> Plan proposals (P3) implemented 2026-10-22 (§17). **Updated 2026-10-23: no external AI is used anywhere.** The plan is built by the
> deterministic playbook engine (§17.0); the former Gemini/Groq/xAI adapters, follow-up suggestions and AI task revision were removed.
> Event workspace (edit/status, tasks + dependencies, plan acceptance, progress, timeline, in-app notifications, §18) and the
> compliance workflow (curated source registry, review states, evidence, simulated official submissions, §19) implemented
> 2026-10-22, tested the same way (PGlite + unit/render tests, no live Supabase).
> Attendees (§20), approval-gated communications with a mock/Resend email transport (§21) and bookings (§22) implemented
> 2026-10-22, tested the same way. **No real email has been sent and no real provider has confirmed a booking.**
> Crisis recovery for a **simulated** venue cancellation (P8, §23) and post-event reviews (P10, §24) implemented 2026-10-22, tested the same
> way (PGlite + unit tests). Since 2026-10-23 the recovery proposal is built by rules from the impact snapshot and the playbook (§23), not by a model.
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
| Planning | Deterministic playbook engine (`src/modules/planning/engine.ts`, §17.0). No external AI service and no AI SDK (ESLint forbids importing one). |
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
    input-hash.ts              # stable sha256 of canonical inputs (plan/recovery dedupe)
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
  university-hackathon.json    # versioned curated playbook data (questions, tasks, risks, topics)
src/playbooks/
  index.ts                     # playbookFor(eventType); parses every JSON playbook at import
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
> `provider_members`, `events`, `event_members`, marketplace tables (§15), `interview_answers` (§16), AI tables (§17), `tasks`, `task_dependencies`, `notifications` (§18), `knowledge_sources`, `compliance_*`, `official_submissions` (§19), `attendees` (§20), `communications`, `communication_deliveries`, `approvals` (§21), `bookings` (§22). There is no `applications` table: application review is a column on `attendees`. Their exact columns and rules are in §14–16 and `supabase/migrations/`;
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
*Implemented (§18) with two additions:* `todo → done` (small tasks) and `cancelled → todo` (restore).
`blocked` is **derived**, not stored: a task is blocked if any dependency is not `done`/`cancelled`.
Cannot move to `done` while blocked. Overdue = `due_at < now()` and status ∉ {done, cancelled}.

**Compliance check (implemented instead of event requirements, §19)** — see §19.2 for the ten states and their rules.

**Event requirement (original design, superseded by §19)** confidence ∈ {verified_source, conditional, recommended} (set by rules/human, never by AI to `verified_source`).
status: `open → in_progress → satisfied | not_applicable`; `satisfied|not_applicable → open`.

*Implemented differently (2026-10-22):* attendees (§20.2), communication delivery and approvals (§21.2–21.3) and bookings (§22.2)
follow the state models in those sections; the blocks below are the original design.

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
*Implemented (§20):* anon may execute exactly `register_attendee` and `public_event_by_slug` (pinned by `tests/db/schema.test.ts`).
Because every migration ends with `revoke … from public, anon`, each later migration re-grants these two after its revoke.

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

## 6. AI orchestration (superseded 2026-10-23)

> **Superseded.** HalaEvents no longer calls any external AI. The provider adapter described here was removed; planning is the
> deterministic playbook engine (§17.0). This section is kept as project history only. The sketch below is not implemented.

### 6.1 Provider adapter (`src/lib/ai/types.ts`)
> Implemented differently (2026-10-22, §17.1): providers return raw text via `generate(ProviderRequest)`; the shared
> `generate()` in `src/lib/ai/client.ts` owns validation, repair and retries. The sketch below is the original design.
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
JSON data files in `playbooks/` (implemented as JSON in P3, §17.2) validated by a Zod `PlaybookSchema` at build/test time: questions (with
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
| Email | `EMAIL_PROVIDER=mock\|resend` | records `sent`, provider `mock`, `is_mock=true`; never `delivered` | Resend send API |
| Weather | `WEATHER_PROVIDER=mock\|open-meteo` | fixed forecast fixture labelled mock | Open-Meteo forecast (stretch) |
| Places | `PLACES_PROVIDER=mock\|none\|google` | seeded venue candidates | Google Places (stretch, discovery only) |
| WhatsApp | not in MVP | — | stretch |

A real integration selected without its key fails at startup env validation (fail fast), rather than silently using mocks.
The UI shows a "Mock" badge for `is_mock` rows and a global banner when any integration is mocked.

## 9. Environment variables
See `.env.example`. Server-only: `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `GOOGLE_PLACES_API_KEY`.
Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_NAME`, `NEXT_PUBLIC_APP_URL`.
(Projects still on legacy Supabase keys put the anon key in `…PUBLISHABLE_KEY` and service-role key in `SUPABASE_SECRET_KEY`.)

Validation (`src/lib/env.server.ts`, Zod, at first import):
- `EMAIL_PROVIDER=resend` requires `RESEND_API_KEY`
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
| Git repo root is `HALA_EVENTS/` (parent), not `HalaEvents/`; no commits | **Resolved (2026-10-22):** the repo is `HalaEvents/.git` with commits; the parent `.git` is empty and unused. Doc paths stay relative to `HalaEvents/`. |

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

## 16. Adaptive interview — deterministic round (implemented 2026-10-22)

### 16.1 Pieces
| Piece | File | Notes |
|---|---|---|
| `PlaybookSchema` | `src/modules/ai/playbook.ts` | Questions: `single_choice`, `multi_choice`, `boolean`, `number` (int range, unit), `text` (max length). Each has `key`, `text`, `why`, `required`, `when` (all must hold). |
| Playbook | `playbooks/university-hackathon.json` (19 questions; v2 since P3 added tasks/risks/topics) | Parsed by `src/playbooks/index.ts` at import, so an invalid playbook fails tests and the build. First written as `src/playbooks/university-hackathon.ts`; moved to JSON data in root `playbooks/` in P3 (§17.2). |
| Rules (pure) | `src/modules/events/interview-rules.ts` | `eventContext`, `conditionHolds`, `interviewState`, `parseAnswer`, `parseSubmission`, `formatAnswer`, `INTERVIEW_EDITABLE_STATUSES`. |
| Storage | `interview_answers` (migration `20261022000001_interview.sql`) | One row per (event, question key); `answer jsonb` (JSON `null` = skipped optional question); `source`, `playbook_id`, `playbook_version`, `answered_by`. |
| UI | `/app/events/[eventId]/interview` | Managers: "Next questions" (new, ≤ 5) + "Your answers" (editable) in one form. Viewers and locked events: read-only list. |

### 16.2 Rules
- **Conditions** reference event facts (`event.venue_type`, `event.capacity`, `event.duration_hours`) or **earlier** questions only
  (schema-enforced), using `equals`, `in`, `not_in`, `includes` (multi-choice), `gte`. An unanswered key never satisfies a condition;
  a skipped answer or unset venue type is `null` and does (e.g. `not_in ["online"]`).
- **Rounds:** the playbook is walked in order; a question applies only if its conditions hold given event facts and *applying* earlier
  answers. The next round is the first ≤ 5 applicable unanswered questions. Changing an answer hides its whole dependent chain.
- **Saving:** the form lists the keys it showed (`round`). The server validates every applicable listed answer with a Zod schema built
  from the question (allowed options, integer range, length, required). It ignores values for keys that weren't shown or don't apply, and
  refuses unknown keys. Answers whose question stopped applying are deleted in the same RPC call. `custom.*` keys are reserved for AI
  follow-ups (P3) and are never removed by the playbook logic.
- **Authorization:** the service checks owner/organizer and an editable event status (draft, planning, ready). `save_interview_answers()`
  (SECURITY DEFINER, `search_path = ''`) re-checks membership, active account and status under a row lock on the event. Every event member,
  viewers included, can read answers; there is no direct insert/update/delete grant. Answers are not audit-logged (not a consequential action;
  `answered_by`/`updated_at` record the last change).
- **Honesty:** the "why" texts are HalaEvents planning prompts, and the page says nothing in the interview is a legal or permit requirement.
  An answer like "venue confirmed in writing" is the organizer's statement; HalaEvents doesn't check it with the university.

### 16.3 Tests and limits
- Unit: `tests/unit/events/interview.test.ts` (schema validation, each operator, rounds, the school-students ⇒ age/consent case, overnight
  and online branches, stale chains, answer parsing, forged rounds). `tests/unit/events/interview-actions.test.tsx` (action authorization with
  the Supabase double; page renders for manager, viewer, non-member).
- DB (PGlite): `tests/db/interview.test.ts` (13 tests: save/upsert/remove, overlap, CHECKs, viewer/outsider/anon/suspended refusal, no direct
  writes, status lock, cascade). A mutation check (letting any member save) fails the viewer test.
- **Not verified:** a live Supabase/PostgREST (RPC argument mapping, `jsonb` round trip over HTTP), a browser walkthrough, and concurrent saves by
  two organizers (each save reads answers and then calls the RPC; a concurrent change can leave an answer that no longer applies. That answer is
  hidden on read and removed on the next save).
- **Not built:** editing event details/status, `/api/events/**` route handlers. (AI follow-up questions were added in P3, §17.)

## 17. Planning engine, plan proposals (engine since 2026-10-23; AI adapter 2026-10-22, removed)

### 17.0 Current architecture: the playbook engine (2026-10-23)
**Decision (user, 2026-10-23): no external AI API for the hackathon prototype** (no Gemini, Groq, xAI/Grok, Claude API or OpenRouter). The
single planning path is deterministic and offline. Sections 17.1, 17.3, 17.4 (model rows) and 17.6 below describe the removed adapter and are
kept as history.

- **Playbooks** are versioned JSON (`playbooks/*.json`, validated by `PlaybookSchema` at import): `university-hackathon` (v3), `conference` (v1),
  `workshop` (v1). Event types live in `EventType` (`events.event_type` CHECK, migration `20261023000003`). Besides questions, task templates,
  risks, compliance topics and provider categories, a playbook now holds the decision tables the engine reads: `summary`, `goals`, `requirements`,
  `assumptions` (`ifMissing`), `decisions`, `budgetLines` (`basis`, `adjustments` with multipliers), `schedule` blocks (from start/end, minutes) and
  per-task `adjustments` (conditions → priority, day shift, extra note). Text may use `{{question.key}}`, `{{event.capacity}}`, `{{event.name}}`,
  `{{event.dates}}`; unknown placeholders fail validation.
- **Engine** (`src/modules/planning/engine.ts`, pure): `buildPlan({ playbook, event, ctx, plan })` → `PlanOutput`. It
  applies every row whose conditions hold for the event facts and answers; fills text; adjusts task priority/timing; computes illustrative budget
  lines (event currency must equal the playbook's `referenceCurrency`, else no amounts); places schedule blocks in the event timezone (blocks that
  don't fit the event length are dropped); turns unanswered plan-critical items into assumptions, "missing information" and up to 5 follow-up
  questions; turns "not decided" answers into open decisions; adds a "Short lead time" risk (< 14 days) and a budget-overrun risk/decision.
  Tasks that wait for an unanswered question get `confidence: low` and an explanation.
- **Never**: invents vendor availability, quotes, bookings or official requirements; every amount is labelled "Illustrative allowance … not a quote";
  every plan states that nothing is confirmed. No network call exists in the planning path (tested with a `fetch` spy).
- **Validation and storage**: the engine's output is checked by `validatePlan` (dependency graph, evidence ids, dates, no URLs) and stored through
  the existing RPCs (`save_ai_plan` with `source = playbook`, no run; `set_ai_plan_overview`). The `ai_*` table names are historical. The plan stays a
  set of proposals; accepting into tasks (`accept_ai_plan`) and the review/approval workflow are unchanged. Identical inputs keep the saved plan
  (`input_hash` includes `ENGINE_VERSION`, playbook id/version, event facts and answers); changed inputs need an explicit "Regenerate plan".
- **Other former AI uses**: message drafts start from per-kind templates (`src/modules/comms/templates.ts`, checked by `draftErrors`); the venue-recovery
  proposal is `deterministicProposal()` + `validateProposal()` and a `playbook` run row (`ai_runs.provider = 'playbook'`) that the SQL requires; the
  interview no longer generates follow-up questions (earlier saved ones remain answerable and dismissible); AI task revision was removed.
- **Assumptions are editable** by changing the matching interview answer and pressing "Regenerate plan"; tasks are editable after they are accepted
  into the workspace (P4). There is no free-text editing of an assumption inside the plan yet.
- **Not covered**: mid-event schedule blocks beyond the opening/closing windows (blocks are anchored to the start or the end), non-AED budget amounts,
  more event types than the three above.
- Tests: `tests/unit/planning/{engine,rules,service}.test.tsx` (different types differ, answers change the plan, missing answers still plan, labels,
  dependency/schedule validity, no AI code/hosts/env/SDK in the source tree, no provider wording in the UI), `tests/db/ai.test.ts` (engine output is
  accepted by the real RPCs for all three playbooks).

### 17.1 Provider adapter: Gemini over REST, no SDK — REMOVED 2026-10-23 (history)
- **Decision (user, 2026-10-22): no vendor SDK.** `src/lib/ai/gemini.ts` calls the Google AI Studio REST endpoint
  `POST https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent` with plain `fetch`,
  `responseMimeType: application/json` and `responseJsonSchema` (from `z.toJSONSchema`, reduced to Gemini's supported keywords
  by `toGeminiSchema`; everything removed is still enforced by Zod). No new dependency.
- The API key goes in the `x-goog-api-key` header, never in the URL, logs or error messages. `GEMINI_MODEL` must match
  `^[a-z0-9][a-z0-9.-]{0,79}$` (it becomes part of the request path); checked by env validation and the adapter.
- ESLint enforces the boundary: importing `@google/genai`, `@google/generative-ai` or `@google-cloud/vertexai` fails lint anywhere,
  and the Gemini host may appear only in `src/lib/ai/gemini.ts`.
- HTTP mapping: 429 → `rate_limited` (with `retryDelay` when Google sends it; **never retried**), 404 → `model_unavailable`,
  401/403 → `not_configured`, 400 → `provider_error` (not retried), 5xx/network/timeout → retryable. `finishReason ≠ STOP`
  (truncation, safety) and blocked prompts are failures, never partial data.
- Providers return raw text only. `generate()` (`src/lib/ai/client.ts`) is the single entry point: per-attempt timeout (30 s),
  one transient retry with backoff, JSON parse (code fences stripped) → Zod → caller's business-rule `validate()`, and **one repair turn**
  quoting the validation errors. At most 3 provider calls per request. Data is returned only if it passed every check.
- Logging (`src/lib/ai/log.ts`): one JSON line per attempt with request id, pipeline, provider, model, attempt, outcome, latency
  and token counts. The log type has no field for prompts, answers, output or keys.
- `AI_PROVIDER=mock` (default) uses `src/lib/ai/mock.ts` with fixtures in `src/modules/ai/provider.ts`: the plan fixture returns
  the deterministic playbook plan, so the demo works offline. Everything it produces is stored with `is_mock = true` and shown with a
  Mock badge. A misconfigured Gemini fails env validation; there is no silent fallback to the mock.

### 17.2 Playbook data
`playbooks/university-hackathon.json` (v2): 19 questions, 18 task templates, 7 risk categories, 6 `requiredForPlan` items,
6 compliance topics (all labelled *not verified*), 5 provider categories. `PlaybookSchema` checks references and task-template
dependency cycles when `src/playbooks/index.ts` imports it.

### 17.3 Prompts — REMOVED 2026-10-23 (history)
- Sent: event type, city, country, timezone, first/last day, duration, venue type, expected attendance, budget, the organizer's
  interview answers, the applicable playbook items and the evidence id list. **Not sent:** event name, member, provider or attendee data.
- All variable content sits inside `<data>…</data>` as JSON, and the system prompt says it is data, never instructions.
- System rules: never claim permits, availability or bookings; no URLs; don't invent laws or authorities, state uncertainty instead.

### 17.4 Pipelines and deterministic rules (history: the `interview` and `revise_task` pipelines were removed; `plan` rules now live in `rules.ts` and are applied to the engine's output)
| Pipeline | Trigger | Output | Deterministic rules |
|---|---|---|---|
| `plan` | "Generate plan" / "Regenerate plan" on `/app/events/[id]/plan` | ≤ 40 task proposals + ≤ 8 assumptions | Needs every applicable `requiredForPlan` answer first (no model call otherwise). Unique temp ids, dependencies only on known ids, no self-dependency or cycle, evidence ids only from the supplied catalogue, no URLs, `date` deadlines real and not in the past or > 60 days after the event. Relative deadlines are resolved in the event timezone; pre-event tasks are clamped to the first day; past deadlines move to today; a task due before its dependency gets a warning. |
| `interview` | "Suggest follow-up questions" after all playbook questions are answered | ≤ 3 questions, keys `custom.*` | Drops reused keys, repeated or reworded-identical questions (answered, dismissed, playbook), URLs; single-choice with < 2 options becomes text; ≤ 15 live per event. Follow-ups are optional and never block the plan. |
| `revise_task` | Per-task "Revise" with an organizer note (5–300 chars) | one task + change summary | Must keep its temp id and still fit the plan (dependencies, cycles, evidence, dates). Only that task changes. |

- **Evidence:** the model can cite only ids HalaEvents supplied (`answer:<key>`, `playbook:task.*`, `playbook:risk.*`,
  `playbook:topic.*`). There is no URL field. Web sources arrive with verified knowledge sources in P5.
- **Duplicate requests:** each call has an `input_hash` (sha256 of the canonical inputs + provider + model + playbook version).
  An identical plan request reuses the saved plan; changed answers make the plan *stale* and need an explicit regenerate.
  An identical follow-up request isn't sent again.
- **Failure:** the run is recorded with its status (`rate_limited`, `timeout`, `invalid_output`, …) and the user sees a plain
  explanation. If no plan exists yet, the deterministic playbook plan is saved, labelled "Built from the playbook · no AI".
  An AI failure never replaces an existing plan.

### 17.5 Storage (migration `20261022000002_ai.sql`)
| Table | Purpose | Readers |
|---|---|---|
| `ai_runs` | One row per model request: pipeline, provider, model, input hash, status, attempts, latency, tokens, `is_mock` | event owner/organizers, admins |
| `ai_plans` | Plan header: `source` (`ai`/`playbook`), assumptions, `status` (`current`/`superseded`), one current plan per event | event members |
| `ai_suggestions` | Tasks (with `plan_id`) and follow-up questions (`custom.*`): `proposed` → `rejected`/`superseded` (`accepted` reserved for P4) | event members |

- No direct insert/update/delete for any API role. RPCs (SECURITY DEFINER, `search_path = ''`): `start_ai_run` (owner/organizer,
  active account, event draft/planning/ready; **single flight** per event+pipeline via a partial unique index; runs stuck for 3 min are
  closed as `abandoned`; **20 runs per user per hour** → SQLSTATE `53400` → `rate_limited`), `finish_ai_run` (caller's own running run only),
  `save_ai_plan` (supersedes the old plan and its open proposals in one transaction), `save_ai_followups`, `revise_ai_task`
  (supersede + insert revision + 1), `dismiss_ai_suggestion`. A run's output can be saved once, only by its creator, only if it succeeded.
- Audit: plan insert/supersede and every suggestion status change go to `audit_log` by trigger.
- **Nothing is written to tasks.** Accepting proposals into real tasks is P4.

### 17.6 Tests and limits (history; see 17.0 for the current tests)
- Unit: `tests/unit/ai/client.test.ts` (15: repair, retry limits, no quota retries, timeout, logging without content, mock),
  `gemini.test.ts` (5: key in header, model-name injection, error mapping, end-to-end repair), `rules.test.ts` (22),
  `service.test.tsx` (20: authorization before any model call, duplicate/stale handling, quota fallback, invalid output never saved,
  revision, follow-ups, page labels).
- DB (PGlite): `tests/db/ai.test.ts` (16: single flight, abandonment, run ownership, hourly cap, viewer/outsider/anon refusal, CHECKs,
  supersession, no direct writes, audit, revision, dismiss, follow-up limits, event lock, cascade).
- Live: `npm run test:ai-live` (`tests/live/gemini.live.test.ts`) makes one real plan request; skipped without `GEMINI_API_KEY`/`GEMINI_MODEL`,
  never part of `npm test`/`verify`.
- **Not verified:** no real Gemini call has been made (no key on the dev machine); the request shape follows Google's documented REST
  contract but `responseJsonSchema` acceptance of our reduced schema is unconfirmed. No live Supabase or browser walkthrough.
- **Known limitation:** the app calls the RPCs with the organizer's own session, so an organizer could call `start_ai_run` → `finish_ai_run`
  → `save_ai_plan` directly over PostgREST and store hand-written proposals labelled `source = ai`. They can only affect events they manage,
  and the proposals are still only proposals; moving run recording to a server-only key would close it (not planned for the MVP).

## 18. Event workspace (implemented 2026-10-22)

### 18.1 Pieces
| Piece | Where |
|---|---|
| Edit event details, change lifecycle status | `/app/events/[id]/edit`; status form on `/app/events/[id]` offers only `EVENT_TRANSITIONS[status]`. `updateEvent`/`changeEventStatus` in `events/service.ts` (manager, details editable until completed/archived/cancelled); the 0003 trigger re-checks transitions. |
| Workspace overview | `/app/events/[id]`: progress (done / non-cancelled tasks), overdue/blocked counts, open checks, concerns, unsaved rule results, due-soon list, status change, "Check deadlines and missing information", timeline. |
| Tasks | `/app/events/[id]/tasks`; module `src/modules/tasks/` (schemas, rules, repo, service, actions). Migration `20261022000003_workspace.sql`. `/app/tasks` lists events linking to their boards. |
| Plan → tasks | "Accept all proposed tasks into the workspace" on the plan page → `accept_ai_plan(plan, ids?)`: one transaction creates tasks from `proposed` suggestions, marks them `accepted`, and wires dependencies by plan item key (partial accepts wire up later). The only path from AI output to real tasks. |
| Timeline | `event_timeline(event, limit)`: SECURITY DEFINER read of `audit_log` for event members (viewers included), returning whitelisted fields only (title, from/to status, source, kind, role, owner changed, due change, simulated). `src/modules/events/timeline.ts` turns rows into sentences. |
| Notifications | `notifications` table + `/app/notifications` (nav item). §18.5. |

### 18.2 Task rules (deterministic; TS `tasks/rules.ts` = SQL, parity-tested pair by pair)
- Transitions: `todo → in_progress|done|cancelled`, `in_progress → todo|done|cancelled`, `done → in_progress`, `cancelled → todo`. New tasks start as `todo`.
- **Blocked** (derived): an open (`todo`/`in_progress`) task with at least one dependency that is neither `done` nor `cancelled`.
  A blocked task can't become `done` (service + trigger `task_blocked`). **Overdue**: open and `due_date` before today *in the event's
  timezone*. **Due soon**: open and due within 3 days.
- Dependencies: same event only, no self-dependency, **no cycles**. The insert trigger takes a row lock on the event and walks the
  graph with a recursive CTE, so concurrent inserts can't each add half a cycle. The UI only offers dependencies that keep the graph acyclic.
- Owners must be the event's owner or an organizer (`owner_user_id`); AI/playbook owners are kept as a *suggested role* (`owner_label`).
- Deadlines are calendar dates (`due_date date`) in the event's timezone, matching the plan's resolved dates.
- `origin`, `suggestion_id`, `plan_item_key` and `event_id` are immutable; API users can only insert `manual` tasks. Tasks are read-only once
  the event is completed, archived or cancelled (`event_locked`).
- Audit: insert/delete and changes of status, owner, deadline, priority, title; dependency insert/delete.

### 18.3 Authorization
Members (viewers included) read tasks, dependencies and the timeline. Owners/organizers with an active account write (column-level
grants + RLS + triggers). Service functions check the same first so users get readable errors (`src/lib/errors.ts` maps each rule prefix).

### 18.4 Progress
`progress()` = done ÷ (total − cancelled), plus overdue and blocked counts, all from stored rows; nothing is cached.

### 18.5 Notifications (in-app only)
- Kinds: `missing_information`, `compliance_concern`, `deadline_approaching`, `decision_required`, `compliance_status_changed`.
- `channel` is always `in_app` (CHECK). `delivery_status = delivered` means stored in the recipient's inbox; `read` (with `read_at`) when
  the recipient marks it. There is **no email, push or WhatsApp** delivery, and nothing claims otherwise.
- Created by: trigger on new plans (decision required), triggers on compliance checks (§19.5), and `refresh_event_notifications(event, missing)`
  which computes overdue/due-within-3-days tasks in SQL (to the task owner, else all managers) and takes missing-information labels computed by
  the app from the playbook. Dedupe keys make every reminder idempotent.
- **No scheduler:** reminders are refreshed when organizers change tasks, accept a plan or run compliance checks, and from the workspace button.
  A deadline that passes while nobody uses the app produces no notification until the next refresh. A cron job (Supabase scheduled function) is future work.
- Recipients read only their own rows; nobody can insert or edit notifications directly.

### 18.6 Tests and limits
- DB: `tests/db/workspace.test.ts` (12: RLS for every role, forged origin/status, transitions, blocked, self/cross-event/direct/indirect cycles,
  owner rule, event lock, plan acceptance incl. partial, timeline whitelist + outsider refusal, notification dedupe/recipients/read, TS↔SQL parity).
  Mutation check: removing the cycle check or the blocked check fails 2 tests.
- Unit: `tests/unit/tasks/rules.test.ts`, `tests/unit/events/timeline.test.ts`, `tests/unit/workspace/actions.test.tsx` (actions refuse before the DB; page renders).
- Not verified: live Supabase/PostgREST, a browser walkthrough, concurrent dependency inserts on a real multi-connection Postgres (PGlite is single-connection).

## 19. Compliance workflow (implemented 2026-10-22)

### 19.1 Model (migration `20261022000004_compliance.sql`, module `src/modules/compliance/`)
| Table | Purpose |
|---|---|
| `knowledge_sources` | Curated registry: `key`, `url` (https), `title`, `authority`, `jurisdiction`, `scope`, `source_type`, `summary` + `summary_kind` (none / search-result summary / page excerpt / team paraphrase), `retrieval_status` (not retrieved / retrieved / blocked / not found), `retrieved_at`, `retrieval_note`, `last_verified_at` + `verified_by` + `verification_note` (platform admin only). |
| `compliance_checks` | Event ID, `topic_key`, `category`, title, description, **reason** (why flagged, in plain language), `origin` (rule / organizer), `severity` (info / possible concern), `applicability`, **status** (§19.2), `status_reason`, `status_set_by` (null = only rules have set it), **reviewer**, **next action**, official channel (a source). |
| `compliance_references` | Check ↔ source, with a relevance note. |
| `compliance_evidence` | `note`, `document_reference`, `reference_number`, `link` (https), `submission_reference`, `official_response`; `is_simulated`; who/when. |
| `official_submissions` | **Simulated only** (`CHECK (is_simulated)`), reference `DEMO-XXXXXXXX`, authority, response summary. |
Audit history: triggers on checks (insert/delete; status, reviewer, applicability, next action), references, evidence, submissions, and source verification.

### 19.2 States and rules (TS `compliance/rules.ts` = SQL `compliance_transition_allowed`, parity-tested)
| State | Meaning | Entry rule |
|---|---|---|
| Not assessed | nobody looked yet | rules or start |
| Needs information | an answer/detail is missing | — |
| Conditional – needs confirmation | may apply depending on details | — |
| Source-supported finding | linked to an official source **a person verified** | needs a referenced source with `last_verified_at` |
| Under human review | the reviewer is checking | needs an assigned reviewer (owner/organizer) |
| Awaiting official response | a submission was recorded | needs a `submission_reference` evidence row or a simulated submission |
| Cleared based on recorded evidence | reviewer cleared it | only from Under review; only the **assigned reviewer or a platform admin**; needs **non-simulated** evidence and a reason |
| Action required | something must be done | reason required |
| Rejected / Closed | flag doesn't apply / no longer relevant | reason required (rejected: reviewer or admin only) |
Allowed moves: see `COMPLIANCE_TRANSITIONS`. Nothing reaches "Cleared" except through review. Status changes go through `set_compliance_status()` only.

### 19.3 Detection (deterministic, no AI)
`detectComplianceItems(playbook, answers)`: every playbook compliance topic whose conditions hold becomes a check; a topic whose conditions
depend on **unanswered** questions becomes "Needs information" with the missing questions in the reason. Explicit concern rules:
off-campus + open-public audience → permit check marked *possible concern*; minors with guardian consent undecided; minors overnight
without decided supervision (new check); photography without a consent decision. Reasons quote the triggering answers. Rules may only
produce `not_assessed`, `needs_information` or `conditional` (enforced by `sync_compliance_checks`), and re-running them never overwrites a
check a person has changed. **AI-assisted concern detection is not built**: nothing in compliance comes from a model.

### 19.4 Sources (checked 2026-10-22)
| Key | Source | What happened when checked |
|---|---|---|
| `det_event_permit` | DET — Apply for an event permit | HTTP 403 to automated fetches; summary from a web-search snippet (labelled so) |
| `det_epermits_register` | DET — Register on the ePermits portal | HTTP 403; search-snippet summary |
| `det_events_activations` | DET — Events and activations | HTTP 403; no summary |
| `det_ticketed_events` | DET — Issue event tickets | not fetched; search-snippet summary (registration may need a ticketed-event permit; applicability to a free hackathon unknown) |
| `dda_event_permit` | DDA — Event Permit (free-zone areas) | the report's URL returned **404**; the current URL came from web search and was not fetched; conflicting fee figures, so none recorded |
| `uae_gov_portal` | u.ae | fetched OK; general portal only |
**None is verified.** A platform admin marks a source verified (with a note on what was checked) on `/app/compliance`. No live search or
monitoring provider is configured; the UI says so and never claims to watch government announcements. Source text is data: it is not
sent to any model and is rendered as plain text.

### 19.5 Concern workflow and notifications
1. Rules flag a topic (reason + answers recorded; *possible concern* wording, never an accusation). 2. Missing details → "Needs information"
+ notification. 3. The check page explains why, the next action and the official channel (when curated; otherwise "ask the venue/authority").
4. A reviewer is assigned; only they (or a platform admin) clear or reject. 5. Submissions and official responses are tracked only as
evidence a person recorded, or as clearly labelled simulations. Nothing reports, blocks or penalizes a member.
Notifications (in-app): new *possible concern* → managers; new "needs information" check → managers; status change → managers except the
actor; review requested / reviewer assigned → the reviewer.

### 19.6 Simulated official application (demonstration)
"Simulate a submission (demo)" creates an `official_submissions` row (`DEMO-` reference, `is_simulated`) and simulated evidence saying
nothing was sent; "Record simulated response" adds a simulated `official_response`. Both carry a *Simulated · demo* badge and a warning that
HalaEvents has no connection to DET, DDA or any authority. Simulated evidence never satisfies "Cleared". A non-simulated submission row
cannot be stored (CHECK). Real applications are tracked by recording the organizer's own reference as `submission_reference` evidence.

### 19.7 Tests and limits
- DB: `tests/db/compliance.test.ts` (14: registry read/verify, rule sync + references, no overwrite of human decisions, invalid transitions,
  source-supported needs a verified source, reviewer/evidence/reason boundaries, admin decision, viewer/outsider refusal, custom keys, https links,
  no direct writes, simulated-only submissions, notifications, audit history, TS↔SQL parity). Mutation check: removing the reviewer-only and
  real-evidence rules fails 4 tests.
- Unit: `tests/unit/compliance/rules.test.ts` (detection cases, blockers, labels, inputs), `tests/unit/workspace/actions.test.tsx`.
- Bug found and fixed: the service returned 404 to platform admins acting as reviewers although the database allowed them.
- Not built: AI-assisted concern analysis; file uploads for evidence (Storage); requirement-level `verified_source` from the original §3 design
  (replaced by these states); a scheduler for deadline reminders. Not verified: live Supabase, browser walkthrough, the live content of any source page.

## 20. Attendees (implemented 2026-10-22)

### 20.1 Pieces
Migration `20261022000005_attendees.sql`; module `src/modules/attendees/`; pages `/app/events/[id]/attendees`, `/app/attendees`
(event list) and the public `/register/[slug]` (no account, outside `/app`). `events.requires_application` added.

### 20.2 Four separate states
| Column / table | Values | Changed by |
|---|---|---|
| `registration_status` | invited → registered; → withdrawn | public form, organizer (`add_attendee`, `withdraw_attendee`) |
| `review_status` (application) | not_required; pending → approved / rejected / needs_information; needs_information → pending / approved / rejected; approved / rejected → pending | organizer (`set_attendee_review`) |
| `participation_status` | pending → accepted / waitlisted / rejected; waitlisted → accepted / rejected / cancelled; accepted → confirmed / cancelled; confirmed → checked_in / cancelled; rejected → pending | organizer (`set_attendee_participation`), registration (auto accept/waitlist) |
| delivery (per message, §21) | simulated / accepted / failed (delivered / bounced reserved) | email transport only; **never changes the columns above** |
Transition tables are in `attendees/rules.ts` and SQL, parity-tested pair by pair.

### 20.3 Rules
- **Capacity:** places = accepted + confirmed + checked-in ≤ `events.capacity`. Checked in `register_attendee` and `set_attendee_participation`
  under a row lock on the event (`capacity_full`). Withdrawal frees the place; waitlisted people are promoted by an organizer (not automatically).
- **Registration:** without application review, the form gives a place while places remain, then waitlists. With review: pending/pending, and
  only approved applications can be accepted (`review_not_approved`). Invited/withdrawn people can't hold a place (CHECK + function).
- **Duplicates:** unique index on (event, lower-cased email) among non-withdrawn rows. The public form answers **the same message for every
  outcome** (new, duplicate, waitlisted), so it never reveals whether an email is registered; people learn their place from the acceptance /
  waitlist notice (§21). Organizer adds get a clear "already registered" error.
- **Minimal data:** name, email, optional phone, optional application note (only when review is on), consent timestamp (required on the form).
- **Public access:** `register_attendee` and `public_event_by_slug` (name, dates, timezone, city, venue type, review flag, places left; only while
  registration is open and the event is planning/ready) are the only anon functions. The form is rate limited per IP (10 / 10 min,
  in-memory per instance, `src/lib/rate-limit.ts`).
- **Privacy:** attendee rows are readable by event owner/organizers and admins only. Viewers see counts (`event_attendance_summary`).
- Audit: insert/delete and every change of the three status columns.

### 20.4 Tests
`tests/db/attendees.test.ts` (12: capacity 2 → accept, accept, waitlist; duplicates case-insensitive; consent/closed/invalid email; anon reads nothing;
invited → registered via form; capacity_full and promotion; participation table; invited can't hold a place; 20 registrations / 10 places; review
gate; viewer/outsider refusal; parity). Mutation check: removing the capacity check fails tests.

### 20.5 Limits
PGlite is single-connection, so the "20 at once" test is serialized: it checks the counting, not row locking under real concurrency. No attendee
self-service (confirm/withdraw links), no check-in QR, no import. Rate limiting is per server instance.

## 21. Communications and the approval gate (implemented 2026-10-22)

### 21.1 Pieces
Migration `20261022000006_communications.sql` (+ booking parts in 0011); module `src/modules/comms/`; email transports
`src/lib/integrations/email/{types,mock,resend,index}.ts`; page `/app/events/[id]/messages`, `/app/messages` (event list).

### 21.2 Drafts and AI
- Kinds: invitation, registration confirmation, acceptance, waitlist, reminder, venue update, schedule update, cancellation, recovery, thank-you.
- Recipients are an **audience** (invited, registered, accepted, waitlisted, confirmed, checked-in, everyone holding a place, one person) resolved
  in SQL (`communication_recipients`), never chosen by a model. Withdrawn people are always excluded.
- Placeholders `{{name}}`, `{{event_name}}`, `{{event_date}}`, `{{event_city}}` are filled per recipient in code (`personalize`).
- **Drafting** (until 2026-10-23 an AI pipeline; now `templateDraft()` in `comms/templates.ts`, no model): former description — input = event name/status, kind, audience label and the organizer's notes;
  **no attendee data**. Output is Zod-validated and checked (only known placeholders, no links, no "permit approved"/"venue confirmed" claims);
  one repair turn, then discarded. A valid result is saved as a **draft** (`drafted_by = ai`, `ai_run_id`, `is_mock_draft`). AI can't request
  approval or send. `start_ai_run` was extended so drafting works for live/completed/cancelled events (not archived).

### 21.3 Approvals (`approvals` table)
Fields: action type (`send_communication`, `request_booking`, `cancel_booking`), target, event, recipient summary, **exact payload** (built by
`approval_payload()` in SQL from the target: for messages subject, body, version, audience and the resolved recipient list) and its **sha256**,
requester, decider, decision time/note, executor, execution times, result, failure reason. Status: pending → approved / rejected / superseded;
approved → executing → executed / execution_failed (messages); booking approvals execute in one transaction.
- **Changed payload ⇒ fresh approval.** Editing a draft supersedes its open approval (`save_communication`). `decide_approval` and
  `claim_approval` rebuild the payload; any difference (text, or recipients because someone was accepted/withdrew) marks the approval
  superseded and nothing is approved or sent.
- One live approval per target; only event owner/organizers request, decide and execute; **self-approval is allowed** (open decision 4: single
  organizer teams) and recorded (requester and decider are both stored). Every status change is audited.

### 21.4 Sending (two-phase, §5.4)
1. `claim_approval`: approved → executing exactly once (a second call gets `already_executed`), only for the reviewed payload.
2. The server sends each recipient the approved text through the transport with idempotency key `approval:attendee`.
3. `finish_communication`: records one `communication_deliveries` row per approved recipient (results for anyone else are refused), sets the
   message to sent / partially failed / failed, and the approval to executed (or execution failed if every recipient failed).
An approval stuck in `executing` is shown as "needs a check" and never retried automatically. A failed message can be edited and re-approved.

### 21.5 Transports and delivery honesty
| Transport | When | What is recorded |
|---|---|---|
| mock (default, `EMAIL_PROVIDER=mock`) | always available | `simulated`, `is_simulated = true`; UI: "Simulated — not sent (mock)", page banner "Simulated sending" |
| Resend (`EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM` on a domain verified in Resend) | REST `POST https://api.resend.com/emails`, `fetch`, no SDK, Bearer key in a header, `Idempotency-Key` header | 2xx → `accepted` + provider id ("Accepted by the email provider — delivery not confirmed"); errors → `failed` with HTTP status and a sanitized message |
The database refuses `accepted` from the mock, `simulated` from Resend, and any `delivered`/`bounced` from the sender: those need provider
webhooks, which are **not implemented**. Delivery never changes attendee statuses. **Resend has not been called for real** (no key); its
adapter is tested with a fake `fetch` only.

### 21.6 Tests
`tests/db/communications.test.ts` (9: exact payload + hash, edit supersedes, recipient change before decision and after approval supersedes,
no recipients, viewer/outsider refusal, no direct writes, no send without approval, exactly-once claim, executor-only finish, mock vs real status
rules, unknown recipients refused, attendee status untouched, sent messages locked, audit). `tests/unit/comms/*` (rules, transports with fake fetch,
actions: unauthorized sending, superseded payload sends nothing, double execution, per-recipient failures, AI draft saved/invalid AI draft
discarded, page shows the exact payload). Mutation check: disabling the payload-hash comparison fails 4 tests.

## 22. Bookings (implemented 2026-10-22)

### 22.1 Pieces
Migration `20261022000007_bookings.sql`; `src/modules/bookings/booking-{rules,repo,service,actions}.ts`; pages `/app/events/[id]/bookings`,
`/app/provider/bookings` (provider nav "Bookings"), `/app/admin/bookings` (admin nav "Booking disputes"); "Propose booking" on submitted,
unexpired quotes on `/app/requests/[id]`. **No payments.**

### 22.2 States (from, to, actor; TS = SQL, parity-tested)
| From | To | Who |
|---|---|---|
| proposed | awaiting organizer approval | approval requested |
| proposed | cancelled | organizer |
| awaiting organizer approval | proposed / awaiting provider | approval rejected or superseded / approval executed |
| awaiting provider | confirmed / declined by provider | **provider member only** |
| awaiting provider | cancelled | organizer (withdraws the request) |
| confirmed | cancelled | **cancellation approval** (organizer) or provider (with reason) |
| confirmed | completed | organizer, only after the service period ends |
| confirmed / completed | disputed | organizer or provider, with reason |
| disputed | confirmed / completed / cancelled | platform admin, with reason |
"Proposed" and "awaiting organizer approval" cover the brief's *Proposed* / *Awaiting organizer decision*.

### 22.3 Rules
- A booking **snapshots** the quote (provider name, revision, amount, currency, inclusions, conditions) and the request's service period. Only
  submitted, unexpired quotes on non-cancelled requests from active providers can be proposed. The approval payload is that snapshot; if it
  changes after approval, execution is superseded.
- One live booking per quote and per service request (partial unique indexes).
- **Conflicts:** a *venue* provider can't confirm a booking that overlaps one of its confirmed/completed/disputed bookings (checked under a lock
  on the provider row). Service providers (catering, AV…) may serve several events at once, so no overlap rule applies to them. Nothing else
  about availability is known: a listing's availability statement is not checked.
- Confirmation is recorded only by `provider_booking_action` by a member of the booked provider (`confirmed_by`, `confirmed_at`; CHECK).
- Provider members get in-app notifications for requests and cancellations; organizers for provider decisions (new kind `booking_update`).
- RLS: event owner/organizers and the booked provider's members read; no direct writes. Audited.

### 22.4 Tests and limits
`tests/db/bookings.test.ts` (11: snapshot, nothing booked on proposal, one live per request, viewer refusal, approval gate, provider-only
confirmation, cancellation needs approval + reason, completion after the period, disputes resolved by admin only, venue overlap refused, caterer
double-booking allowed, withdrawn quote not bookable, changed booking after approval superseded, visibility, parity). Mutation checks: removing
the venue-overlap or the provider-membership check fails tests. Not built: provider calendars/blackouts, payments or deposits, reviews (P10),
automatic completion. Not verified: live Supabase, real provider accounts, browser walkthrough.

---

## 23. Crisis recovery — simulated venue cancellation (implemented 2026-10-22)

### 23.1 What it is and is not
An organizer (event owner or organizer) **simulates** a venue cancellation to practice recovery. `incidents.is_simulated` is a CHECK that can only
be `true`: this workflow can't record a real incident, and every screen says "Simulated". Simulating changes **nothing**: not the venue booking
(cancelling the real booking stays the approval-gated booking action of §22), not other bookings, not attendees, and no provider or attendee is
contacted. Pieces: migration `20261022000008_recovery.sql` (written by an interrupted session, reviewed and tested in the next), `src/modules/recovery/{schemas,rules,prompts,repo,service,actions}.ts`, pages
`/app/events/[id]/incidents` (list + "Simulate cancellation") and `/incidents/[incidentId]`, a "Crisis recovery" button on the event page, a
"Simulated recovery" badge on recovery drafts in `/messages`. Brief item → where:
| Brief | Implementation |
|---|---|
| 1 record disruption + timestamp | `incidents` row (`simulated_at`, `note`, audit insert) |
| 2–4 affected booking, tasks, services, compliance | `recovery_impact()` (SQL, deterministic, stored as `incidents.impact`) |
| 5 build the proposal | `generateRecovery` → `deterministicProposal()` (rules + playbook guidance), recorded as a `playbook` run (no model since 2026-10-23) |
| 6 validate | `validateProposal` (rules.ts); then `save_recovery_plan` repeats the id checks in SQL |
| 7 show original plan, affected items, changes, questions | incident page §1 (snapshot), §2 (options, timeline, unresolved questions, risks), §3 (changes) |
| 8 drafts | `recovery_inquiries` (provider) and a `communications` draft (`venue_update`, linked by `recovery_plan_id`) |
| 9 approvals | `approvals` gate: `apply_recovery` (selected changes), `send_provider_inquiry`, and the normal `send_communication` |
| 10 persist + audit | `execute_recovery_approval` (one transaction); audit triggers on every table |

### 23.2 Impact analysis (rules, not AI)
- **Affected tasks:** tasks of category `venue` plus every task that transitively depends on one (recursive CTE, depth ≤ 20, cancelled tasks excluded),
  with the reason `venue_task` / `depends_on_venue_work`. Only this event's tasks (tested with a task from another event).
- **Services:** the event's live bookings with non-venue providers. They are **never cancelled** by the workflow: each is flagged `reconfirm` and gets
  a templated reconfirmation inquiry (their own terms apply; `playbooks/…json` `recovery.reconfirm` supplies the questions).
- **Compliance:** non-closed, non-rejected, applicable checks in venue-dependent categories or with venue/access/fire/evacuation in the title,
  flagged `reassess` (a previously *cleared* check is listed with a note that it was cleared for the old venue).
- **Candidates:** verified, active, listed venues of suitable capacity and city, other than the cancelled one. `availability` is only
  `conflict_recorded` (a confirmed booking overlaps) or `unknown` — **never "available"**. A price appears only from a submitted, unexpired quote on this
  event's venue requests.

### 23.3 Idempotency
`simulate_venue_cancellation(event, booking, key, note)` locks the event row. Same key → same incident (`created=false`); same key for another booking →
`idempotency_conflict`; another key while the booking already has an active recovery → that incident; one active incident per booking
(partial unique index). The key is derived server-side as `sim:<bookingId>:<number of earlier incidents of that booking>`, so a double click or retry
is one incident and a later re-run after closing gets a fresh key. One proposal per AI run (`recovery_plans_one_per_run`); one open proposal per incident.

### 23.4 What the proposal may and may not do (a model no longer writes it; the same limits apply to the rules)
Output (`RecoveryProposal`, flat for Gemini's schema subset): summary, 1–3 options, recommended option, timeline, task due-date changes, new tasks, review notes,
provider inquiries, attendee update, unresolved questions, risks. **There is no field that cancels, rebooks or confirms anything** and
`recovery_changes.kind` is CHECKed to `reschedule_task | add_task | flag_review`. `validateProposal` rejects (and asks the model once to repair): ids outside the
snapshot, non-open or duplicate task changes, dates outside today…event start (event timezone), duplicate option keys or an unknown recommendation, candidate
venues outside the list, inquiries to the wrong party for their purpose, review notes about things outside the incident, links, unknown placeholders,
candidate venue names in the attendee update, **statements** that something is available/confirmed/secured/approved, that a provider agreed, that a permit carries
over, and **prices not present in the data**. Questions and hedged sentences ("please confirm whether…") are allowed. This is a best-effort pattern check, not
a proof; the guarantees that matter are structural (the model can't express a cancellation, flags are decided by code, nothing applies without approval).
A failed proposal stores nothing; there is **no fabricated fallback proposal** (the deterministic impact analysis stays usable).
Not enforced: that dependent tasks keep their order when moved (the prompt asks; the snapshot carries no dependency edges).

### 23.5 Approval flow
Propose → (nothing applied) → select changes (`set_recovery_selection`, supersedes any open approval) → `request_approval('apply_recovery')` (payload =
selected changes + the **current** state of each task/booking/check + proposal hash) → `decide_approval` → `execute_recovery_approval` (re-checks the payload;
if a task changed meanwhile the approval is `superseded` and nothing is applied) → applied changes `applied`, the rest `skipped`, plan `approved` /
`partially_approved`. Provider inquiries: own approvals; "executed" only records `sent_simulated` (nobody is contacted; the approval result says
`contacted:false`). Attendee update: the normal message approval; `sendApproved` forces the **mock transport** for any communication with `recovery_plan_id`,
and a trigger on `communication_deliveries` refuses any other transport for such messages. All drafts carry a `[SIMULATION]` label and a
"SIMULATED DEMO" prefix added in SQL. Rejecting or replacing a proposal withdraws its approvals and cancels its drafts. Resolving an incident needs an applied plan
and a note; dismissing needs a note.

### 23.6 Tests, mutation checks, limits
`tests/db/recovery.test.ts` (32), `tests/unit/recovery/rules.test.ts` (30), `tests/unit/recovery/service.test.tsx` (16). Mutation check (three mutations applied together: impact-membership check removed, payload re-check at execution removed, "skip unselected"
replaced by "apply unselected"): 7 DB tests failed; restored → 32 pass. Disabling `validateProposal` in the service failed the 2 invalid-proposal unit tests.
Not verified: a real Gemini response (the nested `RecoveryProposal` schema has never been sent to Google), live Supabase, concurrency (PGlite is single-connection), a browser walkthrough.
Not built: real incidents, replacement-venue booking from the incident page, dependency-order enforcement, the playbook's `riskCategories` in the prompt, notifications to the team.

---

## 24. Post-event reviews (implemented 2026-10-22)

### 24.1 Pieces
Migration `20261022000009_reviews.sql`; `src/modules/reviews/{schemas,rules,repo,service,actions}.ts`; `src/components/reviews/rating.tsx`; pages `/app/reviews` (nav "Reviews"),
`/app/admin/reviews` (admin nav "Review moderation"); a Reviews card on `/app/marketplace/[providerId]`.

### 24.2 Eligibility (one function, `review_check`, used by create and by the candidate list)
A review exists only through `create_review(booking, direction, rating, body)`:
- the booking must be **`completed`** (the organizer completes it after the service period; §22);
- `organizer_to_provider`: caller is an event **owner/organizer** of the booking's event (viewers can't); `provider_to_organizer`: caller is a **member of the booked provider** *and* the platform
  setting `provider_reviews_of_organizers` is on (default **off**; only a platform admin changes it, audited);
- active account; **no conflict of interest** (a reviewer can't be on both sides);
- **one review per booking and direction** (`unique (booking_id, direction)`): the team shares one slot, so a co-organizer can't add a second. Reviews can't be edited.
**Verified transaction:** there is no parameter, column or grant that lets a user assert it. Clients have no write access to `reviews`; every review references a booking that was
`completed` at submission, and the "Verified booking" badge is shown only for reviews whose booking is **still** `completed` when read (a booking later moved to `disputed` drops out of lists and averages).

### 24.3 Displayed ratings
`provider_rating_summary` / `provider_reviews` count **published** `organizer_to_provider` reviews of still-completed bookings. Hidden reviews, provider→organizer reviews and
reviews of re-disputed bookings are excluded. An empty history is `0 reviews, average null` and shown as "No reviews yet" (never "0.0"). A caller who may not see the provider
(not verified/active/listed and not a member/admin) gets **no rows**, which the UI shows as "not shown", not "0 reviews". Organizer ratings (`organizer_rating_summary`,
`organizer_reviews`) are visible to the organizer, platform admins and members of any provider only. The public list shows the reviewer's display name.

### 24.4 Responses, reports, disputes, moderation
- `respond_to_review`: the reviewed side (provider members for a review of a provider; event owner/organizers for a review of an organizer), once per review, immutable.
- `report_review(kind='report')`: anyone who is not on the reviewer side and can see the review; `kind='dispute'`: only the reviewed side. One of each per user (unique). Hidden reviews can't be reported by outsiders.
- Admins: `moderate_review` (hide/restore, reason ≥ 5 chars, audited), `resolve_review_report` (upheld/dismissed + reason, optionally hides the review). `/app/admin/reviews` lists open reports and the 30 latest reviews.
- Both sides and admins read every status of their own reviews (RLS); everyone else uses the functions.

### 24.5 Tests, mutation checks, limits
`tests/db/reviews.test.ts` (36), `tests/unit/reviews/{rules,service}.test.ts(x)` (16 + 13), nav test updated (two new items). Mutation checks, each applied alone and restored: removing the completion requirement (at least 6 tests failed), the provider-side conflict check (4 failed), the platform
policy (4 failed), or the `published` filter in the average (4 failed). Not built: editing or deleting a review, a review window, notifications about new reviews/responses, ratings in directory search/ranking,
provider ratings of organizers in the request flow, anonymous reviews. Not verified: live Supabase, browser walkthrough.


## 25. Integrations, security and reliability (phase 9, 2026-10-22)

**Provider interfaces** (`src/lib/integrations/`): email (existing), weather, places (venue discovery), official sources, calendar (interface only, no adapter, nothing calls it).
Every external-data result is `IntegrationResult<T>` with `Provenance` (provider, `isMock`, `retrievedAt`, optional `sourceUrl`, `providerIds`). Responses are Zod-validated, read through a timeout + 256 KB cap (`boundedJson`), redirects refused, errors reduced to a safe code/message (no URL, no body).

| Integration | Modes | State |
|---|---|---|
| AI | none | removed 2026-10-23: planning, drafts and recovery are rule-based (§17.0) |
| Email | `mock` / `resend` | adapter built (§21), **never called live** |
| Weather | `mock` / `open-meteo` | the one narrow live integration (no key); tested with a fake `fetch` only; **no UI uses it yet** |
| Places | `mock` / `none` / `google` | mock only; `google` returns an honest "not implemented" error, never mock data |
| Official sources | `mock` / none | mock fixture only; nothing monitors any portal |

Rules: discovery results carry `availability: "unknown"` (a lead, not availability); a forecast is planning context, not a weather warning (`FORECAST_DISCLAIMER`); a source snapshot is never evidence that a requirement is verified (§19).
Test mode (mock integrations): startup logs which ones are mocked (`src/instrumentation.ts`); a short banner tells users, and `/status` (admins) lists them.

**Security measures:** response headers + CSP in `next.config.ts` (CSP keeps `script-src 'unsafe-inline'`, see the comment there); Server Action body limit 256 kb; `poweredByHeader` off;
per-user AI burst limit (6/min, in-memory) in front of the SQL hourly cap (20/h); production start fails on an invalid environment (names only); `npm run db:reset` needs `--yes` and a local URL;
regression tests `tests/unit/security/static.test.ts` (no raw HTML, server-only modules, secret names, client/server imports, log call sites, headers).
**Reviewed, no change needed:** no file uploads exist; `next` redirects already go through `safeNextPath`; RLS/anon/SECURITY DEFINER pins are tested in `tests/db/schema.test.ts`; SQL is only via PostgREST/RPC parameters.
**Remaining limitations:** in-memory limiters reset on restart and are per instance; CSP allows inline scripts; no CSRF token beyond Next's Origin check for Server Actions; no live Supabase, so RLS is verified on PGlite only;
no dependency audit fix (5 dev-only findings); logs were checked by call-site, not by runtime sampling; this review is not a penetration test.
