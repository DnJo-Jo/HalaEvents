# HalaEvents

HalaEvents is an approval-driven event planning and operations platform. It takes an organizer from an idea to a coordinated event: event profile, adaptive interview, rule-based plan, attendee applications, approved communications, provider quotes and bookings, disruption recovery, and post-event reviews.

The first supported event type is the university hackathon (Dubai/UAE context first). Conference and workshop playbooks are also included.

> **Status:** work in progress. Features are tested on a local PGlite database, not a live Supabase project. No real email has been sent and no real provider has confirmed a booking; unavailable integrations run in clearly labelled mock mode.

## Principles

- **The organizer stays in control.** HalaEvents recommends and prepares; it never sends, books, pays or files on its own. Consequential actions go through an approval gate and are written to an audit log.
- **AI through one gateway, optional.** Plans can be a *template plan* from the deterministic playbook engine (`src/modules/planning/engine.ts`, playbooks in `/playbooks`) or a *custom draft* written through the AI gateway (`src/lib/ai/`, Cloudflare Workers AI first). Custom drafts are validated by the same rules, budget and dates stay in code, and nothing becomes a task until the organizer accepts it.
- **Server-side authorization plus row-level security** on every protected operation. Capacity and booking consistency are enforced in PostgreSQL.

## Tech stack

- Next.js (App Router) with TypeScript (strict), React 19
- Supabase (PostgreSQL, Auth, RLS)
- Zod for validation, Tailwind CSS for styling
- Vitest, Testing Library and PGlite for tests

## Getting started

Requirements: Node.js 24, npm, and Docker (only for a local Supabase stack).

```bash
npm install
cp .env.example .env.local   # then fill in your values
npm run dev
```

Open http://localhost:3000.

### Environment variables

See `.env.example` for the full list. The essentials:

| Variable                               | Purpose                                              |
| -------------------------------------- | ---------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`                  | Base URL used in auth email links                    |
| `NEXT_PUBLIC_SUPABASE_URL`             | Supabase project URL                                 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Public (publishable) key; RLS protects the data     |
| `EMAIL_PROVIDER`                       | `mock` (default) or `resend`                         |
| `WEATHER_PROVIDER`, `PLACES_PROVIDER`  | `mock` by default                                    |
| `AI_PROVIDER`                          | `none` (default) or `cloudflare` for custom drafts   |
| `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `AI_PLAN_MODEL` | Server-only; required when `AI_PROVIDER=cloudflare` |

Never commit `.env.local` or any real keys. Only `NEXT_PUBLIC_*` variables may be read in client code.

### Local database

```bash
npm run db:start             # start local Supabase (needs Docker)
npm run db:reset -- --yes    # apply migrations and seed data
npm run db:types             # regenerate TypeScript types
```

## Scripts

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Start the dev server                                 |
| `npm run build`     | Production build                                     |
| `npm run lint`      | ESLint                                               |
| `npm run typecheck` | TypeScript check                                     |
| `npm test`          | All tests (unit and database)                        |
| `npm run test:unit` | Unit and component tests                             |
| `npm run test:db`   | Migration and RLS tests on PGlite (no Docker needed) |
| `npm run verify`    | Full pre-merge gate: lint, typecheck, format, test, build |

## Project structure

```
src/
  app/          Next.js routes and API route handlers (thin)
  components/   UI components
  lib/          Shared utilities, DB client, integrations
  modules/      Domain code: attendees, bookings, comms, compliance, events,
                marketplace, notifications, planning, profiles, recovery,
                reviews, tasks, auth
  playbooks/    Playbook loading and validation
playbooks/      Event-type playbooks (JSON)
supabase/       Migrations, seed data, config
tests/          Unit and database tests
docs/           Implementation plan and session handoff notes
```

Each domain module follows the same layout: `schemas.ts` (Zod), `rules.ts` (pure logic), `repo.ts` (DB access) and `service.ts` (authorization and orchestration).

## Documentation

- `event.md`: product spec, architecture and security decisions
- `docs/IMPLEMENTATION_PLAN.md`: phases and acceptance criteria
- `PROGRESS.md`: what is done and in progress
- `CLAUDE.md`: project rules for contributors and coding agents
