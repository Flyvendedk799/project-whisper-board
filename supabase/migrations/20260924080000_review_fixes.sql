-- Review fixes: last-admin changes and client merges run in one transaction.

create or replace function public.set_workspace_member_role(
  _workspace_id uuid,
  _user_id uuid,
  _role public.app_role
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_role public.app_role;
  admin_count int;
begin
  if not public.is_workspace_admin(_workspace_id, auth.uid()) then
    raise exception 'Forbidden';
  end if;

  perform 1
  from public.workspace_members
  where workspace_id = _workspace_id
  for update;

  select role into current_role
  from public.workspace_members
  where workspace_id = _workspace_id
    and user_id = _user_id;
  if current_role is null then
    raise exception 'That person is not in this workspace';
  end if;

  select count(*) into admin_count
  from public.workspace_members
  where workspace_id = _workspace_id
    and role = 'admin';
  if current_role = 'admin' and _role <> 'admin' and admin_count <= 1 then
    raise exception 'This workspace needs at least one admin';
  end if;

  update public.workspace_members
  set role = _role
  where workspace_id = _workspace_id
    and user_id = _user_id;

  update public.project_members
  set role = _role::text
  where workspace_id = _workspace_id
    and user_id = _user_id;

  delete from public.user_roles
  where user_id = _user_id
    and workspace_id = _workspace_id;
  insert into public.user_roles (user_id, workspace_id, role)
  values (_user_id, _workspace_id, _role);
end;
$$;

create or replace function public.remove_workspace_member(
  _workspace_id uuid,
  _user_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  current_role public.app_role;
  admin_count int;
begin
  if not public.is_workspace_admin(_workspace_id, auth.uid()) then
    raise exception 'Forbidden';
  end if;
  if _user_id = auth.uid() then
    raise exception 'You can''t remove yourself';
  end if;

  perform 1
  from public.workspace_members
  where workspace_id = _workspace_id
  for update;

  select role into current_role
  from public.workspace_members
  where workspace_id = _workspace_id
    and user_id = _user_id;
  if current_role is null then
    raise exception 'That person is not in this workspace';
  end if;

  select count(*) into admin_count
  from public.workspace_members
  where workspace_id = _workspace_id
    and role = 'admin';
  if current_role = 'admin' and admin_count <= 1 then
    raise exception 'This workspace needs at least one admin';
  end if;

  delete from public.project_members
  where workspace_id = _workspace_id
    and user_id = _user_id;
  delete from public.user_roles
  where workspace_id = _workspace_id
    and user_id = _user_id;
  delete from public.workspace_members
  where workspace_id = _workspace_id
    and user_id = _user_id;
end;
$$;

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

  -- Block project inserts for the rest of this transaction so a project
  -- attached between the reassignment and the delete cannot be orphaned.
  lock table public.projects in share row exclusive mode;

  perform 1 from public.organizations where id in (_from_id, _to_id) for update;

  update public.projects
  set organization_id = _to_id
  where organization_id = _from_id;

  delete from public.organizations where id = _from_id;
end;
$$;

grant execute on function public.set_workspace_member_role(uuid, uuid, public.app_role) to authenticated;
grant execute on function public.remove_workspace_member(uuid, uuid) to authenticated;
grant execute on function public.merge_organizations(uuid, uuid) to authenticated;
