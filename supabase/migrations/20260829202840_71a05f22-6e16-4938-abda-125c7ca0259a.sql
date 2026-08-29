create table public.saved_views (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  scope text not null default 'tickets',
  filters jsonb not null default '{}'::jsonb,
  icon text,
  is_shared boolean not null default false,
  position int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, scope, name)
);
grant select, insert, update, delete on public.saved_views to authenticated;
grant all on public.saved_views to service_role;
alter table public.saved_views enable row level security;
create policy "ws_boundary" on public.saved_views as restrictive to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())))
  with check (workspace_id in (select public.user_workspace_ids(auth.uid())));
create policy "views_own_all" on public.saved_views for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "views_shared_select" on public.saved_views for select to authenticated
  using (is_shared and workspace_id in (select public.user_workspace_ids(auth.uid())));
create trigger touch_saved_views before update on public.saved_views
  for each row execute function public.touch_updated_at();

create type public.ticket_relation_kind as enum
  ('duplicate_of', 'blocks', 'blocked_by', 'relates_to', 'parent_of');

create table public.ticket_relations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.workspaces(id) on delete cascade,
  from_ticket_id uuid not null references public.tickets(id) on delete cascade,
  to_ticket_id uuid not null references public.tickets(id) on delete cascade,
  kind ticket_relation_kind not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (from_ticket_id, to_ticket_id, kind),
  check (from_ticket_id <> to_ticket_id)
);
grant select, insert, update, delete on public.ticket_relations to authenticated;
grant all on public.ticket_relations to service_role;
alter table public.ticket_relations enable row level security;
create index idx_relations_from on public.ticket_relations(from_ticket_id);
create index idx_relations_to on public.ticket_relations(to_ticket_id);
create policy "ws_boundary" on public.ticket_relations as restrictive to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())))
  with check (workspace_id in (select public.user_workspace_ids(auth.uid())));
create policy "relations_admin_all" on public.ticket_relations for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "relations_member_select" on public.ticket_relations for select to authenticated
  using (exists (select 1 from public.tickets t
                 where t.id = ticket_relations.from_ticket_id
                   and public.is_project_member(t.project_id, auth.uid())));
create trigger ws_inherit before insert on public.ticket_relations
  for each row execute function public.inherit_workspace('tickets', 'from_ticket_id');

alter table public.tickets
  add column first_response_at timestamptz,
  add column resolved_at timestamptz,
  add column sla_due_at timestamptz,
  add column reopened_count int not null default 0,
  add column labels text[] not null default '{}';

create index idx_tickets_labels on public.tickets using gin (labels);
create index idx_tickets_sla on public.tickets(sla_due_at)
  where status not in ('done', 'wont_fix');

create table public.sla_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.workspaces(id) on delete cascade,
  priority ticket_priority not null,
  first_response_minutes int not null,
  resolution_minutes int not null,
  unique (workspace_id, priority)
);
grant select, insert, update, delete on public.sla_policies to authenticated;
grant all on public.sla_policies to service_role;
alter table public.sla_policies enable row level security;
create policy "ws_boundary" on public.sla_policies as restrictive to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())))
  with check (workspace_id in (select public.user_workspace_ids(auth.uid())));
create policy "sla_select" on public.sla_policies for select to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())));
create policy "sla_admin_all" on public.sla_policies for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

insert into public.sla_policies (priority, first_response_minutes, resolution_minutes)
values ('urgent', 60, 480),
       ('high', 240, 2880),
       ('medium', 1440, 10080),
       ('low', 4320, 43200);

create or replace function public.compute_sla_due()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  mins int;
begin
  select resolution_minutes into mins
  from public.sla_policies
  where workspace_id = new.workspace_id and priority = new.priority;

  if mins is not null then
    new.sla_due_at := new.created_at + make_interval(mins => mins);
  end if;
  return new;
end $$;
revoke execute on function public.compute_sla_due() from public, anon, authenticated;

create trigger compute_sla_due before insert on public.tickets
  for each row execute function public.compute_sla_due();
create trigger recompute_sla_due before update of priority on public.tickets
  for each row when (new.priority is distinct from old.priority)
  execute function public.compute_sla_due();

create or replace function public.track_ticket_resolution()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.status in ('done', 'wont_fix') and old.status not in ('done', 'wont_fix') then
    new.resolved_at := now();
  elsif new.status not in ('done', 'wont_fix') and old.status in ('done', 'wont_fix') then
    new.resolved_at := null;
    new.reopened_count := old.reopened_count + 1;
  end if;
  return new;
end $$;
revoke execute on function public.track_ticket_resolution() from public, anon, authenticated;

create trigger track_ticket_resolution before update of status on public.tickets
  for each row execute function public.track_ticket_resolution();

create or replace function public.track_first_response()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if new.is_internal then
    return new;
  end if;
  update public.tickets t
  set first_response_at = new.created_at
  where t.id = new.ticket_id
    and t.first_response_at is null
    and t.reporter_id is distinct from new.author_id;
  return new;
end $$;
revoke execute on function public.track_first_response() from public, anon, authenticated;

create trigger track_first_response after insert on public.ticket_comments
  for each row execute function public.track_first_response();

update public.tickets t
set sla_due_at = t.created_at + make_interval(mins => p.resolution_minutes)
from public.sla_policies p
where p.workspace_id = t.workspace_id and p.priority = t.priority;

update public.tickets t
set resolved_at = t.updated_at
where t.status in ('done', 'wont_fix') and t.resolved_at is null;

update public.tickets t
set first_response_at = c.first_at
from (
  select c.ticket_id, min(c.created_at) as first_at
  from public.ticket_comments c
  join public.tickets tk on tk.id = c.ticket_id
  where not c.is_internal and tk.reporter_id is distinct from c.author_id
  group by c.ticket_id
) c
where c.ticket_id = t.id and t.first_response_at is null;

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_minutes int generated always as (
    case
      when ended_at is null then null
      else greatest(1, (extract(epoch from (ended_at - started_at)) / 60)::int)
    end
  ) stored,
  note text,
  billable boolean not null default true,
  rate_cents bigint,
  invoice_id uuid references public.invoices(id) on delete set null,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at > started_at)
);

grant select, insert, update, delete on public.time_entries to authenticated;
grant all on public.time_entries to service_role;
alter table public.time_entries enable row level security;
create index idx_time_entries_project on public.time_entries(project_id, started_at desc);
create index idx_time_entries_ticket on public.time_entries(ticket_id);
create index idx_time_entries_unbilled on public.time_entries(project_id)
  where billable and invoice_id is null and ended_at is not null;

create unique index one_running_timer_per_user on public.time_entries(user_id)
  where ended_at is null;

create policy "ws_boundary" on public.time_entries as restrictive to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())))
  with check (workspace_id in (select public.user_workspace_ids(auth.uid())));
create policy "time_admin_all" on public.time_entries for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "time_own_all" on public.time_entries for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger ws_inherit before insert on public.time_entries
  for each row execute function public.inherit_workspace('projects', 'project_id');