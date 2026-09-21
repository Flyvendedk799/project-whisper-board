-- Add human assignment and ticket linking to plan_tasks
alter table public.plan_tasks
  add column assigned_user_id uuid references public.profiles(id) on delete set null,
  add column ticket_id uuid references public.tickets(id) on delete set null;

create index idx_plan_tasks_assigned_user on public.plan_tasks(assigned_user_id);
create index idx_plan_tasks_ticket on public.plan_tasks(ticket_id);

-- Create plan followers for notifications/invites
create table if not exists public.plan_followers (
  plan_id uuid not null references public.plans(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (plan_id, user_id)
);

create index idx_plan_followers_user on public.plan_followers(user_id);
alter table public.plan_followers enable row level security;
