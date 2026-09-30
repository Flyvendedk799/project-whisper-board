-- Client companies and the people who belong to them.
--
-- Until now a client login was only tied to a company indirectly, through the
-- projects they had been added to, so a freshly invited contact had no company
-- at all and the Clients page could only list people in one flat group. This
-- records the relationship directly. A person can belong to several companies
-- (an agency's freelancer working for two clients), and leaving a company never
-- removes their project access: that stays in project_members.

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_idx on public.organization_members (user_id);
create index organization_members_workspace_idx on public.organization_members (workspace_id);

-- The workspace always follows the company, so application code cannot get it wrong.
create trigger ws_inherit before insert on public.organization_members
  for each row execute function public.inherit_workspace('organizations', 'organization_id');

grant select, insert, update, delete on public.organization_members to authenticated;
grant all on public.organization_members to service_role;
alter table public.organization_members enable row level security;

create policy "ws_boundary" on public.organization_members as restrictive to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())))
  with check (workspace_id in (select public.user_workspace_ids(auth.uid())));

create policy "org_members_admin_all" on public.organization_members for all to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()))
  with check (public.is_workspace_admin(workspace_id, auth.uid()));

-- A policy on this table cannot select from this table without recursing, so
-- "which companies am I in" goes through a security-definer helper.
create or replace function public.user_organization_ids(_user_id uuid)
returns setof uuid language sql stable security definer set search_path = public
as $$ select organization_id from public.organization_members where user_id = _user_id $$;
revoke execute on function public.user_organization_ids(uuid) from public, anon;
grant execute on function public.user_organization_ids(uuid) to authenticated;

-- Clients can see who else is at their own company, and nothing more.
create policy "org_members_own_company_select" on public.organization_members
  for select to authenticated
  using (user_id = auth.uid() or organization_id in (select public.user_organization_ids(auth.uid())));

-- Backfill: anyone already on a project for a company belongs to that company.
insert into public.organization_members (organization_id, user_id, workspace_id)
select distinct p.organization_id, pm.user_id, p.workspace_id
from public.project_members pm
join public.projects p on p.id = pm.project_id
join public.workspace_members wm
  on wm.workspace_id = p.workspace_id and wm.user_id = pm.user_id
where p.organization_id is not null
  and wm.role in ('client', 'client_admin')
on conflict do nothing;

-- Merging two companies keeps the people of the one that goes away.
create or replace function public.merge_organizations(
  _from_id uuid,
  _to_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  from_ws uuid;
  to_ws uuid;
begin
  if _from_id = _to_id then
    raise exception 'Pick a different client';
  end if;

  select workspace_id into from_ws from public.organizations where id = _from_id;
  select workspace_id into to_ws from public.organizations where id = _to_id;
  if from_ws is null or to_ws is null or from_ws <> to_ws then
    raise exception 'Clients must belong to the same workspace';
  end if;
  if not public.is_workspace_admin(from_ws, auth.uid()) then
    raise exception 'Forbidden';
  end if;

  lock table public.projects in share row exclusive mode;

  perform 1 from public.organizations where id in (_from_id, _to_id) for update;

  update public.projects
  set organization_id = _to_id
  where organization_id = _from_id;

  insert into public.organization_members (organization_id, user_id, workspace_id)
  select _to_id, user_id, workspace_id
  from public.organization_members
  where organization_id = _from_id
  on conflict do nothing;

  delete from public.organizations where id = _from_id;
end;
$$;

grant execute on function public.merge_organizations(uuid, uuid) to authenticated;
