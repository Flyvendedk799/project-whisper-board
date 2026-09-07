-- Workspace boundary.
--
-- Consflow runs as a single agency today, but every domain row needs to know
-- which agency it belongs to so a second one can be onboarded without a
-- rewrite. Two decisions keep this migration cheap and safe:
--
--   1. `workspace_id` carries a DEFAULT pointing at the seeded workspace, so no
--      existing INSERT anywhere in the app has to change.
--   2. The boundary is added with RESTRICTIVE policies, which AND with every
--      policy already on the table. None of the 47 existing policies are
--      touched, and none of them can accidentally widen the boundary.
--
-- The backfill and the handle_new_user() rewrite live in this same migration on
-- purpose: a workspace member row that is missing makes every table read as
-- empty with no error, which is indistinguishable from data loss.

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  logo_url text,
  brand_color text,
  support_email text,
  website text,
  invoice_prefix text not null default 'INV',
  invoice_seq int not null default 0,
  ticket_seq int not null default 0,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.workspaces (id, slug, name)
values ('00000000-0000-0000-0000-000000000001', 'default', 'Consflow');

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null default 'client',
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index idx_workspace_members_user on public.workspace_members(user_id);

-- Add the column everywhere, with the default that makes this backwards
-- compatible. `profiles` is deliberately excluded: a person is global and may
-- one day belong to more than one workspace.
do $$
declare
  t text;
  tables text[] := array[
    'organizations','projects','project_members','tickets','ticket_comments',
    'ticket_attachments','ticket_events','milestones','meetings',
    'meeting_action_items','project_updates','notifications','quotes',
    'quote_line_items','invoices','ai_summaries','user_roles'
  ];
begin
  foreach t in array tables loop
    execute format(
      'alter table public.%I add column workspace_id uuid not null
         default ''00000000-0000-0000-0000-000000000001''
         references public.workspaces(id) on delete cascade', t);
    execute format('create index idx_%s_workspace on public.%I(workspace_id)', t, t);
  end loop;
end $$;

-- A person can hold different roles in different workspaces.
alter table public.user_roles drop constraint user_roles_user_id_role_key;
alter table public.user_roles add constraint user_roles_user_workspace_role_key
  unique (user_id, workspace_id, role);

-- RLS decides which rows; a table grant decides whether the role may reach
-- the table at all. Supabase grants these by default for new tables in
-- `public`, but leaning on that makes the schema unreproducible anywhere
-- else — which is why the local harness had to grant by hand.
grant select, insert, update, delete on public.workspaces to authenticated;
grant all on public.workspaces to service_role;
alter table public.workspaces enable row level security;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant all on public.workspace_members to service_role;
alter table public.workspace_members enable row level security;

create or replace function public.user_workspace_ids(_user_id uuid)
returns setof uuid language sql stable security definer set search_path = public
as $$ select workspace_id from public.workspace_members where user_id = _user_id $$;

create or replace function public.is_workspace_admin(_workspace_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = _workspace_id and user_id = _user_id and role = 'admin'
  )
$$;

-- Called from the restrictive policies below, so `authenticated` must keep
-- EXECUTE (see 20260829090000_fix_policy_helper_grants.sql).
revoke execute on function public.user_workspace_ids(uuid) from public, anon;
revoke execute on function public.is_workspace_admin(uuid, uuid) from public, anon;
grant execute on function public.user_workspace_ids(uuid) to authenticated;
grant execute on function public.is_workspace_admin(uuid, uuid) to authenticated;

-- The boundary itself.
do $$
declare
  t text;
  tables text[] := array[
    'organizations','projects','project_members','tickets','ticket_comments',
    'ticket_attachments','ticket_events','milestones','meetings',
    'meeting_action_items','project_updates','notifications','quotes',
    'quote_line_items','invoices','ai_summaries','user_roles'
  ];
begin
  foreach t in array tables loop
    execute format($f$
      create policy "ws_boundary" on public.%I as restrictive to authenticated
        using (workspace_id in (select public.user_workspace_ids(auth.uid())))
        with check (workspace_id in (select public.user_workspace_ids(auth.uid())))
    $f$, t);
  end loop;
end $$;

create policy "workspaces_member_select" on public.workspaces for select to authenticated
  using (id in (select public.user_workspace_ids(auth.uid())));
create policy "workspaces_admin_update" on public.workspaces for update to authenticated
  using (public.is_workspace_admin(id, auth.uid()))
  with check (public.is_workspace_admin(id, auth.uid()));

create policy "ws_members_select_own_workspace" on public.workspace_members for select to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())));
create policy "ws_members_admin_all" on public.workspace_members for all to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()))
  with check (public.is_workspace_admin(workspace_id, auth.uid()));

create trigger touch_workspaces before update on public.workspaces
  for each row execute function public.touch_updated_at();

-- Child rows inherit the workspace of their parent, so application code never
-- sets workspace_id and can never set it wrong.
create or replace function public.inherit_workspace()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  parent_table text := tg_argv[0];
  parent_column text := tg_argv[1];
  parent_id uuid;
  ws uuid;
begin
  execute format('select ($1).%I', parent_column) into parent_id using new;
  if parent_id is null then
    return new;
  end if;
  execute format('select workspace_id from public.%I where id = $1', parent_table)
    into ws using parent_id;
  if ws is not null then
    new.workspace_id := ws;
  end if;
  return new;
end $$;
revoke execute on function public.inherit_workspace() from public, anon, authenticated;

create trigger ws_inherit before insert on public.projects
  for each row execute function public.inherit_workspace('organizations', 'organization_id');
create trigger ws_inherit before insert on public.project_members
  for each row execute function public.inherit_workspace('projects', 'project_id');
create trigger ws_inherit before insert on public.tickets
  for each row execute function public.inherit_workspace('projects', 'project_id');
create trigger ws_inherit before insert on public.ticket_comments
  for each row execute function public.inherit_workspace('tickets', 'ticket_id');
create trigger ws_inherit before insert on public.ticket_attachments
  for each row execute function public.inherit_workspace('tickets', 'ticket_id');
create trigger ws_inherit before insert on public.ticket_events
  for each row execute function public.inherit_workspace('tickets', 'ticket_id');
create trigger ws_inherit before insert on public.milestones
  for each row execute function public.inherit_workspace('projects', 'project_id');
create trigger ws_inherit before insert on public.meetings
  for each row execute function public.inherit_workspace('projects', 'project_id');
create trigger ws_inherit before insert on public.meeting_action_items
  for each row execute function public.inherit_workspace('meetings', 'meeting_id');
create trigger ws_inherit before insert on public.project_updates
  for each row execute function public.inherit_workspace('projects', 'project_id');
create trigger ws_inherit before insert on public.quotes
  for each row execute function public.inherit_workspace('projects', 'project_id');
create trigger ws_inherit before insert on public.quote_line_items
  for each row execute function public.inherit_workspace('quotes', 'quote_id');
create trigger ws_inherit before insert on public.invoices
  for each row execute function public.inherit_workspace('projects', 'project_id');

-- Backfill: every existing user becomes a member of the default workspace,
-- carrying the role they already hold. Without this the restrictive policies
-- above would hide every row from everyone.
insert into public.workspace_members (workspace_id, user_id, role)
select '00000000-0000-0000-0000-000000000001', user_id, role
from public.user_roles
on conflict (workspace_id, user_id) do nothing;

-- Anyone with a profile but no role still gets in, as a client.
insert into public.workspace_members (workspace_id, user_id, role)
select '00000000-0000-0000-0000-000000000001', p.id, 'client'
from public.profiles p
on conflict (workspace_id, user_id) do nothing;

-- "First user becomes admin" was global. Once workspaces exist that would mean
-- "first user ever", silently demoting the owner of every later workspace.
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

  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
