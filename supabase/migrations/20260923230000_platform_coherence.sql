-- Platform coherence: SLA defaults for every workspace, a label palette,
-- quote validity, and plan ↔ ticket status sync.

-- Quotes can carry a validity date. The status enum already includes 'expired'.
alter table public.quotes
  add column if not exists valid_until date;

-- ---------------------------------------------------------------------------
-- SLA policies. The original seed only covered the bootstrap workspace, so
-- every workspace created afterwards had no deadlines and every badge read
-- "none".
-- ---------------------------------------------------------------------------
insert into public.sla_policies (workspace_id, priority, first_response_minutes, resolution_minutes)
select w.id, v.priority::public.ticket_priority, v.first_response, v.resolution
from public.workspaces w
cross join (
  values
    ('urgent', 60, 480),
    ('high', 240, 2880),
    ('medium', 1440, 10080),
    ('low', 4320, 43200)
) as v(priority, first_response, resolution)
where not exists (
  select 1 from public.sla_policies s
  where s.workspace_id = w.id
    and s.priority = v.priority::public.ticket_priority
);

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

  insert into public.sla_policies (workspace_id, priority, first_response_minutes, resolution_minutes)
  values
    (ws.id, 'urgent', 60, 480),
    (ws.id, 'high', 240, 2880),
    (ws.id, 'medium', 1440, 10080),
    (ws.id, 'low', 4320, 43200);

  return ws;
end;
$$;

-- Logo is part of the client-facing brand. The previous signature had no
-- argument for it, so the settings field could not persist.
drop function if exists public.update_workspace(uuid, text, text, text, text, text);

create or replace function public.update_workspace(
  _workspace_id uuid,
  _name text default null,
  _support_email text default null,
  _website text default null,
  _brand_color text default null,
  _invoice_prefix text default null,
  _logo_url text default null
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
    invoice_prefix = coalesce(nullif(trim(_invoice_prefix), ''), invoice_prefix),
    logo_url = case when _logo_url is null then logo_url else nullif(trim(_logo_url), '') end
  where id = _workspace_id
  returning * into ws;

  if ws.id is null then
    raise exception 'Not found';
  end if;
  return ws;
end;
$$;

revoke all on function public.update_workspace(uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.update_workspace(uuid, text, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Workspace label palette. Tickets still store labels as text[]; this table
-- is the governed list (name, colour, description) the UI suggests from.
-- ---------------------------------------------------------------------------
create table if not exists public.workspace_labels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  color text not null default '#64748b',
  description text,
  created_at timestamptz not null default now(),
  constraint workspace_labels_name_key unique (workspace_id, name)
);

grant select, insert, update, delete on public.workspace_labels to authenticated;
grant all on public.workspace_labels to service_role;
alter table public.workspace_labels enable row level security;

create policy "ws_boundary" on public.workspace_labels as restrictive to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())))
  with check (workspace_id in (select public.user_workspace_ids(auth.uid())));
create policy "labels_select" on public.workspace_labels for select to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())));
create policy "labels_admin_all" on public.workspace_labels for all to authenticated
  using (public.is_workspace_admin(workspace_id, auth.uid()))
  with check (public.is_workspace_admin(workspace_id, auth.uid()));

-- ---------------------------------------------------------------------------
-- Plan task ↔ ticket. Completing either side completes the other. A merged
-- pull request completes the task (and therefore the ticket). Project
-- progress falls back to plan tasks when a project has no milestones.
-- ---------------------------------------------------------------------------
create or replace function public.recompute_project_progress(_project_id uuid)
returns void language sql security definer set search_path = public
as $$
  update public.projects p
  set progress = coalesce((
    select case
      when exists (select 1 from public.milestones m where m.project_id = p.id) then (
        select round(100.0 * count(*) filter (where m.status = 'done') / nullif(count(*), 0))
        from public.milestones m
        where m.project_id = p.id
      )
      else (
        select round(100.0 * count(*) filter (where t.status = 'done') / nullif(count(*), 0))
        from public.plan_tasks t
        join public.plans pl on pl.id = t.plan_id
        where pl.project_id = p.id
      )
    end
  ), 0)
  where p.id = _project_id;
$$;

create or replace function public.plan_task_before_write()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if new.pr_status = 'merged' and new.status is distinct from 'done' then
    new.status := 'done';
    new.completed_at := coalesce(new.completed_at, now());
  end if;
  if new.status = 'done' and new.completed_at is null then
    new.completed_at := now();
  end if;
  return new;
end $$;

drop trigger if exists plan_task_before_write on public.plan_tasks;
create trigger plan_task_before_write
  before insert or update on public.plan_tasks
  for each row execute function public.plan_task_before_write();

create or replace function public.sync_plan_task_to_ticket()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  updated_id uuid;
  reporter uuid;
  ws uuid;
  ticket_title text;
begin
  if current_setting('cf.sync_from_ticket', true) = '1' then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status = 'done' and old.status is not distinct from 'done' then
    return new;
  end if;

  if new.status = 'done' and new.ticket_id is not null then
    update public.tickets
    set status = 'done'
    where id = new.ticket_id
      and status not in ('done', 'wont_fix')
    returning id, reporter_id, workspace_id, title
    into updated_id, reporter, ws, ticket_title;

    if updated_id is not null and reporter is not null and reporter is distinct from auth.uid() then
      insert into public.notifications (user_id, workspace_id, kind, title, body, link)
      values (
        reporter,
        ws,
        'ticket_update',
        'Shipped: ' || left(ticket_title, 140),
        'A planned task linked to this ticket is done.',
        '/app/tickets/' || updated_id::text
      );
    end if;
  end if;

  return new;
end $$;

drop trigger if exists sync_plan_task_to_ticket on public.plan_tasks;
create trigger sync_plan_task_to_ticket
  after insert or update of status, pr_status on public.plan_tasks
  for each row execute function public.sync_plan_task_to_ticket();

create or replace function public.sync_ticket_to_plan_tasks()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.status in ('done', 'wont_fix')
     and old.status is distinct from new.status then
    perform set_config('cf.sync_from_ticket', '1', true);
    update public.plan_tasks
    set status = 'done',
        completed_at = coalesce(completed_at, now())
    where ticket_id = new.id
      and status is distinct from 'done';
    perform set_config('cf.sync_from_ticket', '', true);
  end if;
  return new;
end $$;

drop trigger if exists sync_ticket_to_plan_tasks on public.tickets;
create trigger sync_ticket_to_plan_tasks
  after update of status on public.tickets
  for each row execute function public.sync_ticket_to_plan_tasks();

create or replace function public.recompute_progress_from_plan_task()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  pid uuid;
begin
  select project_id into pid
  from public.plans
  where id = coalesce(new.plan_id, old.plan_id);
  if pid is not null then
    perform public.recompute_project_progress(pid);
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists recompute_progress_from_plan_task on public.plan_tasks;
create trigger recompute_progress_from_plan_task
  after insert or update of status or delete on public.plan_tasks
  for each row execute function public.recompute_progress_from_plan_task();
