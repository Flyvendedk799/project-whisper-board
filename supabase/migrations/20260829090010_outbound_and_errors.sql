-- The outbox, and somewhere for errors to land.
--
-- Both tables exist so the app is fully functional with no third-party keys
-- configured. Email that cannot be sent is still composed, addressed and
-- recorded, and readable in the app; errors that have nowhere to be reported
-- are still captured with a fingerprint you can group by. Adding RESEND_API_KEY
-- or SENTRY_DSN changes where these rows go, not whether they exist.

create type public.outbound_status as enum ('queued', 'sent', 'skipped', 'failed');

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.workspaces(id) on delete cascade,
  channel text not null default 'email',
  template text not null,
  to_address text not null,
  to_user_id uuid references auth.users(id) on delete set null,
  subject text,
  body_text text,
  body_html text,
  status outbound_status not null default 'queued',
  provider text,
  provider_message_id text,
  error text,
  related_type text,
  related_id uuid,
  scheduled_for timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.outbound_messages enable row level security;
create index idx_outbound_created on public.outbound_messages(workspace_id, created_at desc);
create index idx_outbound_status on public.outbound_messages(status, scheduled_for)
  where status = 'queued';

create policy "ws_boundary" on public.outbound_messages as restrictive to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())))
  with check (workspace_id in (select public.user_workspace_ids(auth.uid())));
create policy "outbound_admin_select" on public.outbound_messages for select to authenticated
  using (public.is_admin(auth.uid()));
create policy "outbound_own_select" on public.outbound_messages for select to authenticated
  using (to_user_id = auth.uid());

create table public.app_errors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  fingerprint text not null,
  message text not null,
  stack text,
  severity text not null default 'error' check (severity in ('warning', 'error', 'fatal')),
  side text not null default 'server' check (side in ('client', 'server')),
  url text,
  release text,
  context jsonb,
  occurred_at timestamptz not null default now()
);

alter table public.app_errors enable row level security;
create index idx_app_errors_fingerprint on public.app_errors(fingerprint, occurred_at desc);
create index idx_app_errors_recent on public.app_errors(occurred_at desc);

create policy "errors_admin_select" on public.app_errors for select to authenticated
  using (public.is_admin(auth.uid()));
