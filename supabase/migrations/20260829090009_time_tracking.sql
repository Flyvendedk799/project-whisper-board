-- Time tracking.
--
-- Hours logged against a ticket are what turn "we did some work" into a line on
-- an invoice, so entries carry the project, the rate and eventually the invoice
-- they were billed on.

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

alter table public.time_entries enable row level security;
create index idx_time_entries_project on public.time_entries(project_id, started_at desc);
create index idx_time_entries_ticket on public.time_entries(ticket_id);
create index idx_time_entries_unbilled on public.time_entries(project_id)
  where billable and invoice_id is null and ended_at is not null;

-- One running timer per person, enforced here rather than in a race-prone
-- application check. A second start surfaces as a unique violation, which the
-- error mapper turns into "You already have a timer running".
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
