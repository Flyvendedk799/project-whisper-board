# Database

Migrations in `migrations/` are ordered and additive. Later ones depend on
`workspace_id` existing, so the order is load-bearing — do not renumber.

```sh
supabase start
supabase db reset          # apply every migration to a fresh local database
bun run db:types           # regenerate src/integrations/supabase/types.ts
```

`tests/schema_assertions.sql` asserts 43 behaviours — workspace isolation in both
directions, progress arithmetic including divide-by-zero, first response ignoring
internal notes, reopen counting, part payments, timer uniqueness, storage reads scoped
to project membership — and runs in CI whenever a migration changes.

Where the Supabase CLI cannot reach a database (it goes through Docker), the same
migrations can be applied to a plain PostgreSQL instance:

```sh
tests/run-local.sh                 # apply everything, then assert
node ../scripts/gen-types-local.mjs
```

## Production migrations

Production is the Supabase stack on the VPS (container `supabase_db_yjathlhennhrcxtndjth`,
behind `boared.online`), not a supabase.com project, so `supabase db push` cannot reach it.
`.github/workflows/migrate.yml` applies migrations on merge instead: when a change under
`supabase/migrations/` lands on `main` it sends the folder over SSH to
`/usr/local/sbin/boared-migrate` (source: `scripts/vps/`), which

- refuses to run if the database has versions the repo does not (drift) or if a pending
  file is older than one already applied,
- takes a `pg_dump` to `/var/backups/boared-migrate/` (last 10 kept),
- applies each pending file in its own transaction together with its
  `supabase_migrations.schema_migrations` row, so a failing migration changes nothing.

Run it by hand from the Actions tab (workflow_dispatch). For optional manual approval, add
required reviewers to the `production` environment.

The CI key in `~administrator/.ssh/authorized_keys` is `restrict`ed with a forced command
(`boared-migrate-ssh`) that only accepts `check` or `apply`. Both scripts are root-owned
copies; a change under `scripts/vps/` is **not** deployed automatically, so reinstall by hand:

```sh
scp scripts/vps/boared-migrate scripts/vps/boared-migrate-ssh administrator@<vps>:/tmp/
ssh administrator@<vps> 'sudo install -o root -g root -m 0755 /tmp/boared-migrate /tmp/boared-migrate-ssh /usr/local/sbin/'
```

Manual check from a checkout:
`tar -c -C supabase/migrations . | ssh administrator@<vps> sudo /usr/local/sbin/boared-migrate check`.

The migration tracker is in sync with the repo (34 of 34 as of 2026-10-01), so the
repair that used to be documented here is no longer needed.

## Production auth URLs (invite and password emails)

Invitation, magic-link and password emails are sent by the Auth service (GoTrue), not by the
app. The link in them is GoTrue's own `…/auth/v1/verify` URL, built from **its**
`API_EXTERNAL_URL`, and after verifying it redirects to the app's `redirectTo` only if that URL
is on GoTrue's allow list; otherwise it falls back to GoTrue's `SITE_URL`. The Supabase CLI
defaults are `http://127.0.0.1:54321`, `http://127.0.0.1:3000` and `https://127.0.0.1:3000`,
so a stack started from a config without these settings mails links to 127.0.0.1.

The production stack must have (in the `config.toml` the VPS stack is started from):

```toml
[api]
external_url = "https://boared.online"

[auth]
site_url = "https://boared.online"
additional_redirect_urls = ["https://boared.online/**"]
```

or the equivalent environment for `supabase start`: `SUPABASE_API_EXTERNAL_URL`,
`SUPABASE_AUTH_SITE_URL`, `SUPABASE_AUTH_ADDITIONAL_REDIRECT_URLS` (comma-separated). A
plain docker-compose stack uses `API_EXTERNAL_URL`, `SITE_URL` and `ADDITIONAL_REDIRECT_URLS`.
Restart the stack (`supabase stop && supabase start`, data is kept) for them to apply. The
app itself should also get `SITE_URL=https://boared.online`; without it the app derives its
origin from the request (`x-forwarded-host` / `host`).
