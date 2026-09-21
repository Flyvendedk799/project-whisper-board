-- ============================================================
-- AI Planner — schema
-- Seven tables for multi-agent planning boards.
-- ============================================================

-- 1. API keys for agent / external access  ────────────────────
--
-- Agents authenticate via Bearer token. The token itself is shown
-- once at creation time; we store only a SHA-256 hash plus a
-- short prefix for the admin to recognise the key in a list.

create table if not exists public.api_keys (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,
  key_hash      text not null,
  key_prefix    text not null,
  scopes        text[] not null default '{planner}',
  last_used_at  timestamptz,
  expires_at    timestamptz,
  revoked_at    timestamptz,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now()
);

create index idx_api_keys_workspace on public.api_keys(workspace_id);
create unique index idx_api_keys_prefix on public.api_keys(key_prefix);
alter table public.api_keys enable row level security;

comment on table public.api_keys is
  'Workspace-scoped Bearer tokens for programmatic / agent access.';

-- 2. Plans (top-level container)  ─────────────────────────────

create type public.plan_status as enum (
  'draft', 'active', 'paused', 'completed', 'archived'
);

create table if not exists public.plans (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  project_id    uuid references public.projects(id) on delete set null,
  title         text not null,
  description   text,
  status        public.plan_status not null default 'draft',
  github_repo   text,
  github_base   text default 'main',
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index idx_plans_workspace on public.plans(workspace_id);
create index idx_plans_project  on public.plans(project_id);
alter table public.plans enable row level security;

-- 3. Sections (columns on the board)  ─────────────────────────

create table if not exists public.plan_sections (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.plans(id) on delete cascade,
  title         text not null,
  description   text,
  position      integer not null default 0,
  color         text,
  created_at    timestamptz not null default now()
);

create index idx_plan_sections_plan on public.plan_sections(plan_id);
alter table public.plan_sections enable row level security;

-- 4. Registered agents  ───────────────────────────────────────
-- Placed before tasks so the FK from tasks→agents resolves.

create table if not exists public.plan_agents (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  name            text not null,
  provider        text not null,
  model           text,
  capabilities    text[] not null default '{}',
  api_key_id      uuid references public.api_keys(id) on delete set null,
  is_active       boolean not null default true,
  last_seen_at    timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index idx_plan_agents_workspace on public.plan_agents(workspace_id);
alter table public.plan_agents enable row level security;

-- 5. Tasks (individual work items)  ───────────────────────────

create type public.plan_task_status as enum (
  'backlog', 'available', 'claimed', 'in_progress',
  'in_review', 'done', 'blocked'
);
create type public.plan_task_priority as enum (
  'low', 'medium', 'high', 'critical'
);
create type public.plan_task_complexity as enum (
  'trivial', 'small', 'medium', 'large', 'epic'
);

create table if not exists public.plan_tasks (
  id                  uuid primary key default gen_random_uuid(),
  section_id          uuid not null references public.plan_sections(id) on delete cascade,
  plan_id             uuid not null references public.plans(id) on delete cascade,
  title               text not null,
  description         text,
  status              public.plan_task_status not null default 'backlog',
  priority            public.plan_task_priority not null default 'medium',
  complexity          public.plan_task_complexity not null default 'medium',
  position            integer not null default 0,
  labels              text[] not null default '{}',
  -- Agent assignment
  assigned_agent_id   uuid references public.plan_agents(id) on delete set null,
  claimed_at          timestamptz,
  completed_at        timestamptz,
  -- GitHub integration
  branch_name         text,
  pr_number           integer,
  pr_url              text,
  pr_status           text,
  -- Dependencies
  depends_on          uuid[] not null default '{}',
  -- Hints for agent routing
  preferred_providers text[] not null default '{}',
  preferred_models    text[] not null default '{}',
  context_files       text[] not null default '{}',
  acceptance_criteria text,
  -- Effort tracking
  estimated_minutes   integer,
  actual_minutes      integer,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_plan_tasks_section on public.plan_tasks(section_id);
create index idx_plan_tasks_plan    on public.plan_tasks(plan_id);
create index idx_plan_tasks_agent   on public.plan_tasks(assigned_agent_id);
create index idx_plan_tasks_status  on public.plan_tasks(status);
alter table public.plan_tasks enable row level security;

-- 6. Audit log  ───────────────────────────────────────────────

create type public.plan_event_kind as enum (
  'task_created', 'task_updated', 'task_claimed', 'task_unclaimed',
  'task_started', 'task_completed', 'task_blocked', 'task_reviewed',
  'pr_opened', 'pr_merged', 'pr_closed',
  'section_created', 'section_updated',
  'plan_created', 'plan_activated', 'plan_completed',
  'agent_registered', 'agent_deactivated',
  'comment_added'
);

create table if not exists public.plan_events (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.plans(id) on delete cascade,
  task_id       uuid references public.plan_tasks(id) on delete cascade,
  agent_id      uuid references public.plan_agents(id) on delete set null,
  actor_id      uuid references public.profiles(id),
  kind          public.plan_event_kind not null,
  old_value     text,
  new_value     text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index idx_plan_events_plan  on public.plan_events(plan_id);
create index idx_plan_events_task  on public.plan_events(task_id);
create index idx_plan_events_agent on public.plan_events(agent_id);
alter table public.plan_events enable row level security;

-- 7. Task comments  ───────────────────────────────────────────

create table if not exists public.plan_task_comments (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.plan_tasks(id) on delete cascade,
  author_id     uuid references public.profiles(id),
  agent_id      uuid references public.plan_agents(id) on delete set null,
  body          text not null,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index idx_plan_task_comments_task on public.plan_task_comments(task_id);
alter table public.plan_task_comments enable row level security;


-- ============================================================
-- RLS policies
-- ============================================================

-- api_keys: workspace admins only
create policy "workspace_admin_api_keys" on public.api_keys
  for all using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = api_keys.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'admin'
    )
  );

-- plans: any workspace member can read; admins can mutate
create policy "workspace_read_plans" on public.plans
  for select using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = plans.workspace_id
        and wm.user_id = auth.uid()
    )
  );
create policy "workspace_admin_write_plans" on public.plans
  for insert with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = plans.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'admin'
    )
  );
create policy "workspace_admin_update_plans" on public.plans
  for update using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = plans.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'admin'
    )
  );
create policy "workspace_admin_delete_plans" on public.plans
  for delete using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = plans.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'admin'
    )
  );

-- sections: inherit via plan
create policy "workspace_read_sections" on public.plan_sections
  for select using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_sections.plan_id and wm.user_id = auth.uid()
    )
  );
create policy "workspace_admin_write_sections" on public.plan_sections
  for insert with check (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_sections.plan_id and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );
create policy "workspace_admin_update_sections" on public.plan_sections
  for update using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_sections.plan_id and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );
create policy "workspace_admin_delete_sections" on public.plan_sections
  for delete using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_sections.plan_id and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );

-- tasks: inherit via plan
create policy "workspace_read_tasks" on public.plan_tasks
  for select using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_tasks.plan_id and wm.user_id = auth.uid()
    )
  );
create policy "workspace_admin_write_tasks" on public.plan_tasks
  for insert with check (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_tasks.plan_id and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );
create policy "workspace_admin_update_tasks" on public.plan_tasks
  for update using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_tasks.plan_id and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );
create policy "workspace_admin_delete_tasks" on public.plan_tasks
  for delete using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_tasks.plan_id and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );

-- agents: workspace members can see; admins can mutate
create policy "workspace_read_agents" on public.plan_agents
  for select using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = plan_agents.workspace_id
        and wm.user_id = auth.uid()
    )
  );
create policy "workspace_admin_write_agents" on public.plan_agents
  for insert with check (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = plan_agents.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'admin'
    )
  );
create policy "workspace_admin_update_agents" on public.plan_agents
  for update using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = plan_agents.workspace_id
        and wm.user_id = auth.uid()
        and wm.role = 'admin'
    )
  );

-- events: read via plan membership
create policy "workspace_read_events" on public.plan_events
  for select using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_events.plan_id and wm.user_id = auth.uid()
    )
  );

-- comments: read via task → plan membership
create policy "workspace_read_comments" on public.plan_task_comments
  for select using (
    exists (
      select 1 from public.plan_tasks t
      join public.plans p on p.id = t.plan_id
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where t.id = plan_task_comments.task_id and wm.user_id = auth.uid()
    )
  );
create policy "workspace_admin_write_comments" on public.plan_task_comments
  for insert with check (
    exists (
      select 1 from public.plan_tasks t
      join public.plans p on p.id = t.plan_id
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where t.id = plan_task_comments.task_id and wm.user_id = auth.uid()
    )
  );


-- ============================================================
-- Triggers
-- ============================================================

create or replace function public.plan_touch_updated_at()
returns trigger as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$ language plpgsql;

create trigger trg_plans_updated_at
  before update on public.plans
  for each row execute function public.plan_touch_updated_at();

create trigger trg_plan_tasks_updated_at
  before update on public.plan_tasks
  for each row execute function public.plan_touch_updated_at();


-- ============================================================
-- Grants — service_role (for REST API + MCP server)
-- ============================================================

grant all on public.api_keys           to service_role;
grant all on public.plans              to service_role;
grant all on public.plan_sections      to service_role;
grant all on public.plan_tasks         to service_role;
grant all on public.plan_agents        to service_role;
grant all on public.plan_events        to service_role;
grant all on public.plan_task_comments to service_role;


-- ============================================================
-- Enable Realtime for agent activity feed
-- ============================================================

alter publication supabase_realtime add table public.plan_events;
alter publication supabase_realtime add table public.plan_tasks;
