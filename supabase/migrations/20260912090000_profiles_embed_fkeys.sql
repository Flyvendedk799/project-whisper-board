-- Point the person-reference foreign keys at public.profiles instead of auth.users.
--
-- Every one of these columns is read back through an embed on `profiles` —
-- `reporter:profiles!tickets_reporter_id_fkey(...)`, `author:profiles(...)`,
-- `user:profiles(...)` and so on. PostgREST resolves an embed from a foreign key
-- between the two tables, and there was none: the columns referenced
-- `auth.users`, so every one of those selects failed with
--
--   PGRST200  Could not find a relationship between 'tickets' and 'profiles'
--             in the schema cache
--
-- which surfaced as a 400 on the admin dashboard, the ticket list, the comment
-- thread, the activity feed, the member list and the timer. Only an admin saw it,
-- because a client's dashboard never runs those queries.
--
-- The constraint NAMES are kept, because two of the embeds name them explicitly
-- as disambiguation hints (tickets has two references to the same person table,
-- so it has to say which one it means).
--
-- Delete behaviour is preserved exactly rather than improved. `profiles.id`
-- already references `auth.users(id) on delete cascade` and a row exists for
-- every account, so profiles is one-to-one with auth.users and disappears with
-- it. That makes "cascade from profiles" and "cascade from auth.users" the same
-- event, and likewise for the no-action columns: deleting an account was blocked
-- by these constraints before and is blocked by them now. Whether a person with
-- tickets should be deletable at all is a product question, and this migration
-- deliberately does not answer it.

do $$
declare
  ref record;
begin
  for ref in
    select *
    from (
      values
        -- table,            column,        constraint name,                     on delete
        ('tickets',          'reporter_id', 'tickets_reporter_id_fkey',          'no action'),
        ('tickets',          'assignee_id', 'tickets_assignee_id_fkey',          'no action'),
        ('ticket_events',    'actor_id',    'ticket_events_actor_id_fkey',       'no action'),
        ('project_updates',  'author_id',   'project_updates_author_id_fkey',    'no action'),
        ('ticket_comments',  'author_id',   'ticket_comments_author_id_fkey',    'cascade'),
        ('project_members',  'user_id',     'project_members_user_id_fkey',      'cascade'),
        ('time_entries',     'user_id',     'time_entries_user_id_fkey',         'cascade')
    ) as t(table_name, column_name, constraint_name, on_delete)
  loop
    -- Skip anything already pointing at profiles, so the migration is safe to
    -- re-run and a fresh database built from these files lands in one state.
    if exists (
      select 1
      from pg_constraint c
      where c.conname = ref.constraint_name
        and c.conrelid = format('public.%I', ref.table_name)::regclass
        and c.confrelid = 'public.profiles'::regclass
    ) then
      continue;
    end if;

    execute format(
      'alter table public.%I drop constraint if exists %I',
      ref.table_name, ref.constraint_name
    );
    execute format(
      'alter table public.%I add constraint %I foreign key (%I)
         references public.profiles(id) on delete %s',
      ref.table_name, ref.constraint_name, ref.column_name, ref.on_delete
    );
  end loop;
end $$;

-- PostgREST caches the relationship graph at boot; without this the embeds keep
-- failing until something else happens to restart it.
notify pgrst, 'reload schema';
