-- Capture context.
--
-- The difference between "the checkout is broken" and a bug you can act on is
-- the surrounding detail: what page, what browser, what was in the console. A
-- client should never have to know to include any of it.

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
  console_log jsonb,      -- [{level, ts, message}], capped client-side
  network_errors jsonb,   -- [{url, status, method, ts}], capped client-side
  app_version text,
  extra jsonb,
  created_at timestamptz not null default now()
);

-- RLS decides which rows; a table grant decides whether the role may reach
-- the table at all. Supabase grants these by default for new tables in
-- `public`, but leaning on that makes the schema unreproducible anywhere
-- else — which is why the local harness had to grant by hand.
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

-- Attachments grow the shape the annotator and recorder need. `is_recording`
-- stays so nothing that reads it today breaks.
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
