grant execute on function public.has_role(uuid, app_role) to authenticated;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_project_member(uuid, uuid) to authenticated;

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

grant select, insert, update, delete on public.workspaces to authenticated;
grant all on public.workspaces to service_role;
grant select, insert, update, delete on public.workspace_members to authenticated;
grant all on public.workspace_members to service_role;

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

alter table public.user_roles drop constraint user_roles_user_id_role_key;
alter table public.user_roles add constraint user_roles_user_workspace_role_key
  unique (user_id, workspace_id, role);

alter table public.workspaces enable row level security;
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

revoke execute on function public.user_workspace_ids(uuid) from public, anon;
revoke execute on function public.is_workspace_admin(uuid, uuid) from public, anon;
grant execute on function public.user_workspace_ids(uuid) to authenticated;
grant execute on function public.is_workspace_admin(uuid, uuid) to authenticated;

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

insert into public.workspace_members (workspace_id, user_id, role)
select '00000000-0000-0000-0000-000000000001', user_id, role
from public.user_roles
on conflict (workspace_id, user_id) do nothing;

insert into public.workspace_members (workspace_id, user_id, role)
select '00000000-0000-0000-0000-000000000001', p.id, 'client'
from public.profiles p
on conflict (workspace_id, user_id) do nothing;

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

alter table public.tickets add column ticket_number int not null default 0;

create or replace function public.assign_ticket_number()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  if coalesce(new.ticket_number, 0) > 0 then
    return new;
  end if;
  update public.workspaces
     set ticket_seq = ticket_seq + 1
   where id = new.workspace_id
  returning ticket_seq into n;
  new.ticket_number := n;
  return new;
end $$;
revoke execute on function public.assign_ticket_number() from public, anon, authenticated;

with numbered as (
  select id, row_number() over (partition by workspace_id order by created_at, id) as n
  from public.tickets
)
update public.tickets t set ticket_number = numbered.n
from numbered where numbered.id = t.id;

update public.workspaces w
set ticket_seq = greatest(w.ticket_seq, coalesce(
  (select max(ticket_number) from public.tickets t where t.workspace_id = w.id), 0));

alter table public.tickets add constraint tickets_workspace_number_key
  unique (workspace_id, ticket_number);

create trigger assign_ticket_number before insert on public.tickets
  for each row execute function public.assign_ticket_number();

alter table public.ticket_events
  add column field text,
  add column old_value text,
  add column new_value text;

create index idx_ticket_events_ticket on public.ticket_events(ticket_id, created_at desc);

create or replace function public.log_ticket_event()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_events (ticket_id, actor_id, kind, data)
    values (new.id, coalesce(actor, new.reporter_id), 'created',
            jsonb_build_object('title', new.title, 'type', new.type, 'priority', new.priority));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.ticket_events (ticket_id, actor_id, kind, field, old_value, new_value)
    values (new.id, actor, 'status_changed', 'status', old.status::text, new.status::text);
  end if;
  if new.priority is distinct from old.priority then
    insert into public.ticket_events (ticket_id, actor_id, kind, field, old_value, new_value)
    values (new.id, actor, 'priority_changed', 'priority', old.priority::text, new.priority::text);
  end if;
  if new.type is distinct from old.type then
    insert into public.ticket_events (ticket_id, actor_id, kind, field, old_value, new_value)
    values (new.id, actor, 'type_changed', 'type', old.type::text, new.type::text);
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.ticket_events (ticket_id, actor_id, kind, field, old_value, new_value)
    values (new.id, actor,
            case when new.assignee_id is null then 'unassigned' else 'assigned' end,
            'assignee_id', old.assignee_id::text, new.assignee_id::text);
  end if;
  if new.due_date is distinct from old.due_date then
    insert into public.ticket_events (ticket_id, actor_id, kind, field, old_value, new_value)
    values (new.id, actor, 'due_date_changed', 'due_date', old.due_date::text, new.due_date::text);
  end if;
  if new.eta_date is distinct from old.eta_date then
    insert into public.ticket_events (ticket_id, actor_id, kind, field, old_value, new_value)
    values (new.id, actor, 'eta_changed', 'eta_date', old.eta_date::text, new.eta_date::text);
  end if;
  if new.estimate_hours is distinct from old.estimate_hours then
    insert into public.ticket_events (ticket_id, actor_id, kind, field, old_value, new_value)
    values (new.id, actor, 'estimate_changed', 'estimate_hours',
            old.estimate_hours::text, new.estimate_hours::text);
  end if;
  return new;
end $$;
revoke execute on function public.log_ticket_event() from public, anon, authenticated;

create trigger log_ticket_event after insert or update on public.tickets
  for each row execute function public.log_ticket_event();

create or replace function public.log_comment_event()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.ticket_events (ticket_id, actor_id, kind, data)
  values (new.ticket_id, new.author_id,
          case when new.is_internal then 'internal_note' else 'commented' end,
          jsonb_build_object('comment_id', new.id));
  return new;
end $$;
revoke execute on function public.log_comment_event() from public, anon, authenticated;

create trigger log_comment_event after insert on public.ticket_comments
  for each row execute function public.log_comment_event();

create or replace function public.log_attachment_event()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.ticket_events (ticket_id, actor_id, kind, data)
  values (new.ticket_id, new.uploader_id, 'attached',
          jsonb_build_object('attachment_id', new.id, 'file_name', new.file_name,
                             'is_recording', new.is_recording));
  return new;
end $$;
revoke execute on function public.log_attachment_event() from public, anon, authenticated;

create trigger log_attachment_event after insert on public.ticket_attachments
  for each row execute function public.log_attachment_event();