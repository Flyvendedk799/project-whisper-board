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

## One-off: repairing the migration tracker

**Read this before the next `supabase db push`.**

On 2026-08-29 Lovable re-issued the whole schema as four migrations
(`20260829202708`, `20260829202747`, `20260829202840`, `20260829203030`). They were a
verbatim copy of `20260829090000`–`20260829090013` — same DDL, comments stripped, plus
the explicit `GRANT`s that have since been folded into the originals. With both copies
in the repo, a fresh `supabase db reset` failed at `create table public.workspaces`.

The four duplicates have been deleted. The live database is unaffected — it has the
schema exactly once — but its `supabase_migrations.schema_migrations` table still lists
the deleted versions, and probably does _not_ list the fourteen that remain. Left alone,
the next push would try to apply all fourteen to a database that already has every
object.

Check first:

```sh
supabase migration list     # compare Local and Remote columns
```

If Remote lists the four deleted versions and not the fourteen, reconcile:

```sh
supabase migration repair --status reverted \
  20260829202708 20260829202747 20260829202840 20260829203030

supabase migration repair --status applied \
  20260829090000 20260829090001 20260829090002 20260829090003 20260829090004 \
  20260829090005 20260829090006 20260829090007 20260829090008 20260829090009 \
  20260829090010 20260829090011 20260829090012 20260829090013

supabase migration list     # Local and Remote should now agree
```

`20260907090000_scope_storage_reads.sql` is genuinely new and has not been applied
anywhere — it should push normally once the tracker agrees.

If `migration list` shows something else, stop and look rather than running the repair:
the commands above assume the state described here.
