-- Product tenancy: create a workspace + founder membership as one atomic RPC.
-- Public signup no longer auto-joins the seeded Consflow workspace unless
-- raw_user_meta_data.workspace_id is set (invite flow).

create or replace function public.create_workspace(
  _name text,
  _slug text default null
)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  ws public.workspaces;
  base_slug text;
  final_slug text;
  n int := 0;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  if _name is null or length(trim(_name)) < 1 then
    raise exception 'Workspace name is required';
  end if;

  base_slug := coalesce(
    nullif(lower(regexp_replace(trim(coalesce(_slug, _name)), '[^a-z0-9]+', '-', 'g')), ''),
    'workspace'
  );
  base_slug := trim(both '-' from base_slug);
  if length(base_slug) < 2 then
    base_slug := 'workspace';
  end if;
  final_slug := left(base_slug, 48);

  while exists (select 1 from public.workspaces where slug = final_slug) loop
    n := n + 1;
    final_slug := left(base_slug, 40) || '-' || n::text;
  end loop;

  insert into public.workspaces (slug, name)
  values (final_slug, trim(_name))
  returning * into ws;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws.id, uid, 'admin')
  on conflict (workspace_id, user_id) do update set role = 'admin';

  insert into public.user_roles (user_id, workspace_id, role)
  values (uid, ws.id, 'admin')
  on conflict (user_id, workspace_id, role) do nothing;

  return ws;
end;
$$;

revoke all on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;

create or replace function public.update_workspace(
  _workspace_id uuid,
  _name text default null,
  _support_email text default null,
  _website text default null,
  _brand_color text default null,
  _invoice_prefix text default null
)
returns public.workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  ws public.workspaces;
begin
  if not public.is_workspace_admin(_workspace_id, auth.uid()) then
    raise exception 'Forbidden';
  end if;

  update public.workspaces
  set
    name = coalesce(nullif(trim(_name), ''), name),
    support_email = case when _support_email is null then support_email else nullif(trim(_support_email), '') end,
    website = case when _website is null then website else nullif(trim(_website), '') end,
    brand_color = case when _brand_color is null then brand_color else nullif(trim(_brand_color), '') end,
    invoice_prefix = coalesce(nullif(trim(_invoice_prefix), ''), invoice_prefix)
  where id = _workspace_id
  returning * into ws;

  if ws.id is null then
    raise exception 'Not found';
  end if;
  return ws;
end;
$$;

revoke all on function public.update_workspace(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.update_workspace(uuid, text, text, text, text, text) to authenticated;

-- Invite / join: only attach when metadata carries a workspace_id.
-- Founders create via create_workspace(); they must not land in Consflow.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  ws uuid := nullif(new.raw_user_meta_data->>'workspace_id', '')::uuid;
  invite_role text := coalesce(nullif(new.raw_user_meta_data->>'invite_role', ''), 'client');
  role_to_set app_role;
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

  if ws is null then
    return new;
  end if;

  if invite_role = 'client_admin' then
    role_to_set := 'client_admin';
  elsif invite_role = 'admin' then
    role_to_set := 'admin';
  else
    role_to_set := 'client';
  end if;

  insert into public.user_roles (user_id, workspace_id, role)
  values (new.id, ws, role_to_set)
  on conflict do nothing;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, new.id, role_to_set)
  on conflict (workspace_id, user_id) do nothing;

  return new;
end $$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
