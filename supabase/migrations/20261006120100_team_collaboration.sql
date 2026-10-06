-- Team collaboration: who you can see, what they look like, and who is still
-- only invited.
--
-- 1. Profiles are readable by the people you share a workspace with (and by
--    yourself), not by every signed-in account on the instance. Before this
--    `profiles_select_all` let any user of any workspace read every name,
--    email and company on the server.
-- 2. A profile's owner may change their name, photo and company, but no longer
--    their `email`: notification emails are sent to that column, so it follows
--    auth.users instead (see sync_profile_from_auth below).
-- 3. Photos: a public `avatars` bucket where each person writes only under
--    their own id. OAuth sign-ups (Google sends `picture`, most providers send
--    `avatar_url`) get their provider photo without uploading anything.
-- 4. workspace_people(): one call for member lists and pickers, including
--    whether an invited person has signed in yet ("pending").
-- 5. notifications.actor_id: who caused a notification, so the inbox can show
--    their face.

-- ---------------------------------------------------------------------------
-- 1. Profile visibility
-- ---------------------------------------------------------------------------
create or replace function public.shares_workspace(_other uuid, _viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select _other = _viewer
    or exists (
      select 1
      from public.workspace_members mine
      join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
      where mine.user_id = _viewer
        and theirs.user_id = _other
    )
$$;

revoke execute on function public.shares_workspace(uuid, uuid) from public, anon;
grant execute on function public.shares_workspace(uuid, uuid) to authenticated;

drop policy if exists "profiles_select_all" on public.profiles;
drop policy if exists "profiles_select_shared_workspace" on public.profiles;
create policy "profiles_select_shared_workspace" on public.profiles
  for select to authenticated
  using (public.shares_workspace(id, auth.uid()));

-- ---------------------------------------------------------------------------
-- 2. What a person may change about themselves
-- ---------------------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;
grant update (full_name, avatar_url, company) on public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Photos
-- ---------------------------------------------------------------------------
-- Provider photo on sign-up. Same as the previous handle_new_user
-- (20260921220000_create_workspace.sql) except for the avatar fallback.
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
      nullif(new.raw_user_meta_data->>'full_name', ''),
      nullif(new.raw_user_meta_data->>'name', ''),
      split_part(new.email, '@', 1)
    ),
    new.email,
    coalesce(
      nullif(new.raw_user_meta_data->>'avatar_url', ''),
      nullif(new.raw_user_meta_data->>'picture', '')
    )
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

-- An account that links a provider later (or whose email changes) keeps its
-- profile in step: a photo only fills an empty one, never replaces an upload.
create or replace function public.sync_profile_from_auth()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  provider_photo text := coalesce(
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    nullif(new.raw_user_meta_data->>'picture', '')
  );
  email_changed boolean := new.email is not null and new.email is distinct from old.email;
begin
  update public.profiles p
  set
    avatar_url = coalesce(p.avatar_url, provider_photo),
    email = case when email_changed then new.email else p.email end
  where p.id = new.id
    and ((p.avatar_url is null and provider_photo is not null) or email_changed);
  return new;
end $$;

revoke execute on function public.sync_profile_from_auth() from public, anon, authenticated;

drop trigger if exists on_auth_user_updated_sync_profile on auth.users;
create trigger on_auth_user_updated_sync_profile
  after update of raw_user_meta_data, email on auth.users
  for each row execute function public.sync_profile_from_auth();

-- Everyone who already signed up with a provider photo.
update public.profiles p
set avatar_url = coalesce(
  nullif(u.raw_user_meta_data->>'avatar_url', ''),
  nullif(u.raw_user_meta_data->>'picture', '')
)
from auth.users u
where u.id = p.id
  and p.avatar_url is null
  and coalesce(
    nullif(u.raw_user_meta_data->>'avatar_url', ''),
    nullif(u.raw_user_meta_data->>'picture', '')
  ) is not null;

-- Uploaded photos. Public so an <img> can show them without signing a URL per
-- face; nothing else lives in this bucket.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit'
  ) then
    execute $q$update storage.buckets set file_size_limit = 2097152 where id = 'avatars'$q$;
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types'
  ) then
    execute $q$update storage.buckets
      set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
      where id = 'avatars'$q$;
  end if;
end $$;

drop policy if exists "avatars_read" on storage.objects;
drop policy if exists "avatars_insert_own" on storage.objects;
drop policy if exists "avatars_update_own" on storage.objects;
drop policy if exists "avatars_delete_own" on storage.objects;

create policy "avatars_read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars');
create policy "avatars_insert_own" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars_update_own" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- 4. The people in a workspace
-- ---------------------------------------------------------------------------
-- Members only. Everyone sees names, photos, emails, roles and whether someone
-- is still pending; only admins and client leads see invite and sign-in times.
create or replace function public.workspace_people(_workspace_id uuid)
returns table (
  user_id uuid,
  role public.app_role,
  full_name text,
  avatar_url text,
  email text,
  joined_at timestamptz,
  invited_at timestamptz,
  last_sign_in_at timestamptz,
  pending boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  viewer_role public.app_role;
begin
  select wm.role into viewer_role
  from public.workspace_members wm
  where wm.workspace_id = _workspace_id
    and wm.user_id = auth.uid();
  if viewer_role is null then
    return;
  end if;

  return query
  select
    wm.user_id,
    wm.role,
    p.full_name,
    p.avatar_url,
    coalesce(p.email, u.email)::text,
    wm.created_at,
    case when viewer_role in ('admin', 'client_admin') then u.invited_at end,
    case when viewer_role in ('admin', 'client_admin') then u.last_sign_in_at end,
    (u.id is not null and u.last_sign_in_at is null)
  from public.workspace_members wm
  left join public.profiles p on p.id = wm.user_id
  left join auth.users u on u.id = wm.user_id
  where wm.workspace_id = _workspace_id
  order by (u.id is not null and u.last_sign_in_at is null), lower(coalesce(p.full_name, p.email, ''));
end;
$$;

revoke execute on function public.workspace_people(uuid) from public, anon;
grant execute on function public.workspace_people(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Who caused a notification
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists actor_id uuid references public.profiles(id) on delete set null;

create index if not exists idx_notifications_user_created
  on public.notifications (user_id, created_at desc);

notify pgrst, 'reload schema';
