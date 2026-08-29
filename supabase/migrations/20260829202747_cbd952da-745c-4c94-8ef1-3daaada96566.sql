create or replace function public.recompute_project_progress(_project_id uuid)
returns void language sql security definer set search_path = public
as $$
  update public.projects p
  set progress = coalesce((
    select round(100.0 * count(*) filter (where m.status = 'done') / nullif(count(*), 0))
    from public.milestones m
    where m.project_id = p.id
  ), 0)
  where p.id = _project_id;
$$;
revoke execute on function public.recompute_project_progress(uuid) from public, anon, authenticated;

create or replace function public.on_milestone_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.recompute_project_progress(coalesce(new.project_id, old.project_id));

  if tg_op = 'UPDATE' and new.status = 'done' and old.status is distinct from 'done' then
    update public.milestones set completed_at = coalesce(new.completed_at, now())
    where id = new.id and completed_at is null;

    insert into public.project_updates (project_id, kind, title, body, data)
    values (new.project_id, 'milestone_done', new.title,
            'Milestone completed.', jsonb_build_object('milestone_id', new.id));
  end if;

  return coalesce(new, old);
end $$;
revoke execute on function public.on_milestone_change() from public, anon, authenticated;

create trigger on_milestone_change after insert or update or delete on public.milestones
  for each row execute function public.on_milestone_change();

update public.projects p
set progress = coalesce((
  select round(100.0 * count(*) filter (where m.status = 'done') / nullif(count(*), 0))
  from public.milestones m where m.project_id = p.id
), 0);

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

alter table public.tickets add column search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored;

create index idx_tickets_search on public.tickets using gin (search_tsv);

create index idx_tickets_queue on public.tickets(workspace_id, status, created_at desc);
create index idx_tickets_assignee on public.tickets(assignee_id)
  where assignee_id is not null;
create index idx_tickets_project_status on public.tickets(project_id, status);
create index idx_tickets_updated on public.tickets(workspace_id, updated_at desc);

create table public.ticket_capture_context (
  ticket_id uuid primary key references public.tickets(id) on delete cascade,
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.workspaces(id) on delete cascade,
  url text,
  page_title text,
  referrer text,
  user_agent text,
  browser text,
  browser_version text,
  os text,
  device_type text,
  viewport_w int,
  viewport_h int,
  screen_w int,
  screen_h int,
  dpr numeric,
  timezone text,
  locale text,
  online boolean,
  console_log jsonb,
  network_errors jsonb,
  app_version text,
  extra jsonb,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.ticket_capture_context to authenticated;
grant all on public.ticket_capture_context to service_role;

alter table public.ticket_capture_context enable row level security;
create index idx_capture_context_workspace on public.ticket_capture_context(workspace_id);

create policy "ws_boundary" on public.ticket_capture_context as restrictive to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())))
  with check (workspace_id in (select public.user_workspace_ids(auth.uid())));

create policy "capture_admin_all" on public.ticket_capture_context for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "capture_member_select" on public.ticket_capture_context for select to authenticated
  using (exists (select 1 from public.tickets t
                 where t.id = ticket_capture_context.ticket_id
                   and public.is_project_member(t.project_id, auth.uid())));
create policy "capture_member_insert" on public.ticket_capture_context for insert to authenticated
  with check (exists (select 1 from public.tickets t
                      where t.id = ticket_capture_context.ticket_id
                        and public.is_project_member(t.project_id, auth.uid())));

create trigger ws_inherit before insert on public.ticket_capture_context
  for each row execute function public.inherit_workspace('tickets', 'ticket_id');

alter table public.ticket_attachments
  add column kind text not null default 'file'
    check (kind in ('file', 'image', 'screenshot', 'recording', 'annotated', 'thumbnail')),
  add column annotations jsonb,
  add column source_attachment_id uuid references public.ticket_attachments(id) on delete set null,
  add column width int,
  add column height int,
  add column duration_ms int,
  add column has_audio boolean,
  add column thumbnail_path text,
  add column checksum text;

update public.ticket_attachments
set kind = case
  when is_recording then 'recording'
  when mime_type like 'image/%' then 'image'
  else 'file'
end;

create index idx_attachments_kind on public.ticket_attachments(ticket_id, kind);