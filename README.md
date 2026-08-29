# Consflow

A client portal and ticket platform for a software agency. Two sides, one app:

- **Admin workspace** — every ticket across every client in one triage queue, with search,
  saved views, keyboard navigation, SLA tracking and time logging.
- **Client portal** — clients report a bug by pointing at it (annotated screenshot, screen
  recording with narration, auto-captured browser context; AI drafts the ticket), follow their
  project from quote to milestones to invoice, and read a real activity timeline.

## Stack

| Layer        | Choice                                                                               |
| ------------ | ------------------------------------------------------------------------------------ |
| Framework    | TanStack Start (SSR) + React 19, file-based routing in `src/routes/`                 |
| Server state | TanStack Query v5 — all reads/writes defined in `src/data/`                          |
| Styling      | Tailwind CSS v4 (CSS-first tokens in `src/styles.css`) + shadcn/ui                   |
| Backend      | Supabase — Postgres, Auth, Storage, Realtime. Access control is RLS                  |
| Server logic | `createServerFn` handlers in `src/lib/*.functions.ts`, running on Cloudflare Workers |
| Tests        | Vitest (node + happy-dom projects), Playwright for smoke                             |
| Deploy       | Cloudflare Workers (`wrangler.jsonc` → `src/server.ts`)                              |

## Getting started

```sh
bun install
cp .env.example .env      # fill in your Supabase project values
bun run dev
```

> **Note on `bun.lock`.** It pins packages to a private registry mirror that is
> only reachable from the Lovable sandbox, so `bun install` fails elsewhere.
> CI therefore installs with `npm install --no-package-lock` from public npm.
> Regenerating the lockfile against a registry GitHub can reach would let CI use
> `bun install` too — left alone here so the existing Lovable pipeline keeps
> working.

```sh
bun run validate          # typecheck + lint + test — run this before pushing
bun run build
```

## Environment

Required — the app will not boot without these:

| Variable                                                     | Used by            | Notes                                                   |
| ------------------------------------------------------------ | ------------------ | ------------------------------------------------------- |
| `VITE_SUPABASE_URL` / `SUPABASE_URL`                         | client / server    | Supabase project URL                                    |
| `VITE_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_PUBLISHABLE_KEY` | client / server    | Anon key                                                |
| `VITE_SUPABASE_PROJECT_ID`                                   | `bun run db:types` | Project ref                                             |
| `SUPABASE_SERVICE_ROLE_KEY`                                  | server only        | Privileged server functions. Never expose to the client |
| `SITE_URL`                                                   | server             | Absolute origin used in invite and email links          |

Optional — **every one of these is optional by design.** Each is behind a provider adapter in
`src/lib/providers/`. With none of them set the app is fully functional: emails land in the
in-app Outbox instead of an inbox, invoices are settled with "Mark as paid", errors are
recorded in the `app_errors` table, and AI features hide themselves. Setting a key switches
the adapter with no code change.

| Variable                                     | Enables                                                 | Without it                                                                 |
| -------------------------------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`      | Ticket drafting, triage, summaries, screenshot analysis | AI affordances are hidden                                                  |
| `RESEND_API_KEY`, `EMAIL_FROM`               | Real transactional email                                | Messages are written to `outbound_messages` and shown in Settings → Outbox |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Card payment on invoices                                | Invoices are settled manually; the flow is otherwise identical             |
| `SENTRY_DSN`                                 | Error reporting to Sentry                               | Errors are written to `app_errors` and surfaced in Settings                |

## Architecture notes

**Data access is centralised.** `src/data/` holds every query and mutation as a
`queryOptions()` builder with a prefix-nested key factory, so invalidating `qk.ticket(id)`
covers its comments, events and attachments. ESLint blocks `supabase.from()` outside
`src/data/` and the server-function modules.

**Errors are mapped, never leaked.** `src/lib/errors.ts` translates Postgres and network
failures into sentences a client can read; only messages authored as an `AppError` are shown
verbatim. `useServerAction` wraps every mutation with pending state, invalidation, optimistic
rollback and error reporting.

**The database owns its invariants.** Audit rows (`ticket_events`), project progress, ticket
and invoice numbering, SLA due dates, first-response timestamps and "one running timer per
user" are all enforced by triggers and constraints rather than application code.

**Tenancy is a schema boundary.** Every domain table carries `workspace_id`, guarded by a
`RESTRICTIVE` RLS policy that ANDs with the existing per-table policies. The UI is
single-workspace today; onboarding a second agency does not require a rewrite.

## Database

Migrations live in `supabase/migrations/` and are ordered — later ones depend on
`workspace_id` existing.

```sh
supabase start
supabase db reset          # apply every migration to a fresh local database
bun run db:types           # regenerate src/integrations/supabase/types.ts
```

`supabase/tests/schema_assertions.sql` asserts 39 behaviours — workspace isolation in both
directions, progress arithmetic including divide-by-zero, first response ignoring internal
notes, reopen counting, part payments, timer uniqueness — and runs in CI whenever a
migration changes.

Where the Supabase CLI cannot reach a database (it goes through Docker), the same migrations
can be applied to a plain PostgreSQL instance:

```sh
supabase/tests/run-local.sh      # apply every migration, then assert
node scripts/gen-types-local.mjs # regenerate types from that database
```

## Testing

```sh
bun run test          # unit and component (vitest: node + happy-dom)
bun run e2e           # browser smoke (playwright)
bun run validate      # typecheck + lint + test
```

The unit suite covers the parts that are expensive to get wrong and cheap to test in
isolation: error mapping, query-key nesting, billing arithmetic, the annotation model, the
recorder state machine, quiet hours, and the provider adapters' behaviour with and without
keys. The browser suite is deliberately four specs — it exists to catch the app not booting,
not to re-test the above.
