-- Realtime.
--
-- The ticket page has subscribed to postgres_changes since it was written, but
-- no table was ever added to the supabase_realtime publication, so the
-- subscription has never fired. `replica identity full` is what makes the old
-- row available to filters on UPDATE.

alter table public.tickets replica identity full;
alter table public.ticket_comments replica identity full;
alter table public.ticket_events replica identity full;
alter table public.notifications replica identity full;
alter table public.project_updates replica identity full;

do $$
declare
  t text;
  tables text[] := array[
    'tickets','ticket_comments','ticket_events','notifications','project_updates'
  ];
begin
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
