-- Notification preferences.
--
-- Notifications are only useful if people can turn the noisy ones off, and only
-- safe to send by email if quiet hours are respected.

create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.workspaces(id) on delete cascade,
  -- { "comment": {"in_app": true, "email": true}, ... } keyed by notification_kind
  channels jsonb not null default jsonb_build_object(
    'mention',       jsonb_build_object('in_app', true, 'email', true),
    'comment',       jsonb_build_object('in_app', true, 'email', true),
    'ticket_update', jsonb_build_object('in_app', true, 'email', false),
    'milestone',     jsonb_build_object('in_app', true, 'email', true),
    'invoice',       jsonb_build_object('in_app', true, 'email', true),
    'meeting',       jsonb_build_object('in_app', true, 'email', true)
  ),
  digest_frequency text not null default 'daily'
    check (digest_frequency in ('off', 'daily', 'weekly')),
  quiet_hours_start int check (quiet_hours_start between 0 and 23),
  quiet_hours_end int check (quiet_hours_end between 0 and 23),
  timezone text not null default 'UTC',
  updated_at timestamptz not null default now()
);

-- RLS decides which rows; a table grant decides whether the role may reach
-- the table at all. Supabase grants these by default for new tables in
-- `public`, but leaning on that makes the schema unreproducible anywhere
-- else — which is why the local harness had to grant by hand.
grant select, insert, update, delete on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;
alter table public.notification_preferences enable row level security;
create policy "ws_boundary" on public.notification_preferences as restrictive to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())))
  with check (workspace_id in (select public.user_workspace_ids(auth.uid())));
create policy "prefs_own_all" on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger touch_notification_preferences before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

-- Everyone who already exists gets the defaults.
insert into public.notification_preferences (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

-- And everyone who arrives from now on.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  ws uuid := coalesce(
    nullif(new.raw_user_meta_data->>'workspace_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'
  );
  is_first boolean;
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.email,
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  select not exists (
    select 1 from public.workspace_members
    where workspace_id = ws and role = 'admin'
  ) into is_first;

  insert into public.user_roles (user_id, workspace_id, role)
  values (new.id, ws, (case when is_first then 'admin' else 'client' end)::app_role)
  on conflict do nothing;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, new.id, (case when is_first then 'admin' else 'client' end)::app_role)
  on conflict (workspace_id, user_id) do nothing;

  insert into public.notification_preferences (user_id, workspace_id)
  values (new.id, ws)
  on conflict (user_id) do nothing;

  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
