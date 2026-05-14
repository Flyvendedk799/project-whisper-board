
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  is_first boolean;
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email, new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;

  select not exists (select 1 from public.user_roles where role = 'admin') into is_first;

  if is_first then
    insert into public.user_roles (user_id, role) values (new.id, 'admin') on conflict do nothing;
  else
    insert into public.user_roles (user_id, role) values (new.id, 'client') on conflict do nothing;
  end if;
  return new;
end; $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
