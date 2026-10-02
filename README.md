# Boared

A client portal and ticket platform for a software agency. Two sides, one app:

- **Admin workspace** — every ticket across every client in one triage queue, with search,
  saved views, keyboard navigation, SLA tracking and time logging.
- **Client portal** — clients report a bug by pointing at it (annotated screenshot, screen
  recording with narration, auto-captured browser context), follow their project from quote to
  milestones to invoice, and read a real activity timeline. AI drafts are optional and hidden
  until a provider is configured.

## Stack

| Layer        | Choice                                                                               |
| ------------ | ------------------------------------------------------------------------------------ |
| Framework    | TanStack Start (SSR) + React 19, file-based routing in `src/routes/`                 |
| Server state | TanStack Query v5 — all reads/writes defined in `src/data/`                          |
| Styling      | Tailwind CSS v4 (CSS-first tokens in `src/styles.css`) + shadcn/ui                   |
| Backend      | Supabase — Postgres, Auth, Storage, Realtime. Access control is RLS                  |
| Server logic | `createServerFn` handlers in `src/lib/*.functions.ts`, running on Nitro (Node) |
| Tests        | Vitest (node + happy-dom projects), Playwright for smoke                             |
| Deploy       | Nitro `node-server` preset (`vite build` → `.output/`)                               |

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
| `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`      | Ticket drafting, triage, summaries, screenshot analysis | AI controls are hidden; nothing calls AI unless you click                  |
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

## The planner

Plans hold sections, sections hold tasks, and people and AI agents work the same board.

- **Questions.** Anyone, human or agent, can ask a question on a task; it shows up as needing an
  answer (task card, the plan header's "Needs you", the Questions tab). A _blocking_ question holds
  the task in `blocked` and releases it when the last one is answered or dismissed. The database
  trigger `plan_sync_question_block` does this, so it works the same for the UI and the agent API.
- **Feature lists and sub-steps.** A task has a brief, a feature list (what it must deliver) and
  sub-steps (how). A step can name the feature it delivers; the drawer shows features with no step.
- **Sections** carry a description, goals and intentions, a colour and tags. Tasks have a colour and
  tags (stored in `plan_tasks.labels`). Sections and tasks drag to reorder; ids copy with one click.
- **Working branch.** Next to the base branch a plan says where work happens: a new branch, an
  existing one, or the base branch itself. Repository and branch pickers are searchable.
- **AI.** The assistant (bottom-right button, and preset buttons on the plan and task) proposes
  actions that run in the browser as the signed-in person, so nothing gets more access than they
  have. _Audit plan_, _Add context_ (reads the plan's repository with the person's own GitHub
  token) and the optional background assessment in Settings use the same provider adapter as the
  rest of the app; with no provider configured they stay hidden. The background mode runs while a
  plan is open in the browser; there is no server-side scheduler.
- **Agents.** `/app/agents` documents the MCP server, the skill and the REST API. The tool catalog
  in `src/mcp/tool-catalog.ts` is the single source of truth, and a test fails if the MCP server,
  the catalog and `.agents/skills/ai-planner/SKILL.md` drift apart.
- **Markdown.** Export writes a readable GitHub-flavoured document; import reads it back (and still
  reads the older numbered-outline and heading formats).

## Database

Migrations live in `supabase/migrations/` and are ordered — later ones depend on
`workspace_id` existing.

```sh
supabase start
supabase db reset          # apply every migration to a fresh local database
bun run db:types           # regenerate src/integrations/supabase/types.ts
```

`supabase/tests/schema_assertions.sql` asserts 43 behaviours — workspace isolation in both
directions, progress arithmetic including divide-by-zero, first response ignoring internal
notes, reopen counting, part payments, timer uniqueness, storage reads scoped to project membership — and runs in CI whenever
a migration changes. See `supabase/README.md`, which also carries a one-off tracker
repair that must happen before the next `supabase db push`.

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

## Deploy (Nitro node-server)

Production builds use the Nitro `node-server` preset (see `vite.config.ts`).

```sh
npm install
npm run build          # writes `.output/`
node .output/server/index.mjs
```

Point your process manager (systemd, PM2, Docker, etc.) at `node .output/server/index.mjs`,
set the same env vars as local (at minimum `SUPABASE_*` and `SITE_URL`), and put a reverse
proxy in front for TLS. There is no Cloudflare Workers deploy path any more.
