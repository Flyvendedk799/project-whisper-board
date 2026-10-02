-- Questions, feature lists, tags, colours, section intent, working branch, AI settings.
--
--  * plan_task_questions   a question on a task, asked by a person or an agent. A
--                          *blocking* question that is open holds the task in
--                          "blocked"; answering the last one puts the task back where
--                          it was. A non-blocking question only asks for an answer.
--  * plan_task_features    the requirements a task must meet ("must be able to block
--                          questions"). Written by people after the brief; steps are the
--                          how, features are the what, and a step may point at a feature.
--  * colours               tasks and sections.
--  * tags                  sections (tasks keep using `labels`, which the UI now calls tags).
--  * section intent        goals and intentions beside the description.
--  * plans.github_work_*   where the work happens: a new branch, an existing one, or the
--                          base branch itself.
--  * user_ai_settings      per-person switches for the AI that works in the background.

-- ---------------------------------------------------------------------------
-- Colours, tags, section intent, working branch, AI notes
-- ---------------------------------------------------------------------------
alter table public.plan_tasks
  add column if not exists color text
    check (color is null or color ~ '^(var\(--[a-z0-9-]+\)|#[0-9a-fA-F]{3,8})$'),
  add column if not exists blocked_from public.plan_task_status,
  add column if not exists ai_context text,
  add column if not exists ai_context_at timestamptz,
  add column if not exists ai_assessed_at timestamptz,
  add column if not exists ai_assessment jsonb;

alter table public.plan_sections
  add column if not exists goals text,
  add column if not exists intentions text,
  add column if not exists tags text[] not null default '{}';

-- Sections already had a free-form colour; hold it to the same shape.
alter table public.plan_sections drop constraint if exists plan_sections_color_shape;
alter table public.plan_sections
  add constraint plan_sections_color_shape
  check (color is null or color ~ '^(var\(--[a-z0-9-]+\)|#[0-9a-fA-F]{3,8})$') not valid;

alter table public.plans
  add column if not exists github_work_mode text
    check (github_work_mode is null or github_work_mode in ('base', 'existing', 'new')),
  add column if not exists github_work_branch text;

create index if not exists idx_plan_tasks_labels on public.plan_tasks using gin (labels);
create index if not exists idx_plan_sections_tags on public.plan_sections using gin (tags);

-- A task only remembers where a blocking question took it from while it is blocked.
create or replace function public.plan_task_forget_block()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if new.status <> 'blocked' then
    new.blocked_from := null;
  end if;
  return new;
end $$;

drop trigger if exists plan_task_forget_block on public.plan_tasks;
create trigger plan_task_forget_block
  before update on public.plan_tasks
  for each row execute function public.plan_task_forget_block();

-- ---------------------------------------------------------------------------
-- Features
-- ---------------------------------------------------------------------------
create table if not exists public.plan_task_features (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.plan_tasks(id) on delete cascade,
  plan_id     uuid not null references public.plans(id) on delete cascade,
  text        text not null check (char_length(btrim(text)) between 1 and 500),
  met         boolean not null default false,
  source      text not null default 'human' check (source in ('human', 'agent', 'ai')),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_plan_task_features_task on public.plan_task_features(task_id, position);
create index if not exists idx_plan_task_features_plan on public.plan_task_features(plan_id);
alter table public.plan_task_features enable row level security;

drop trigger if exists plan_task_features_inherit on public.plan_task_features;
create trigger plan_task_features_inherit
  before insert on public.plan_task_features
  for each row execute function public.plan_child_inherit_plan();

drop trigger if exists plan_task_features_updated_at on public.plan_task_features;
create trigger plan_task_features_updated_at
  before update on public.plan_task_features
  for each row execute function public.plan_touch_updated_at();

create policy "workspace_read_features" on public.plan_task_features
  for select using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_task_features.plan_id and wm.user_id = auth.uid()
    )
  );
create policy "workspace_admin_insert_features" on public.plan_task_features
  for insert with check (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      join public.plan_tasks t on t.plan_id = p.id
      where t.id = plan_task_features.task_id and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );
create policy "workspace_admin_update_features" on public.plan_task_features
  for update using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_task_features.plan_id and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );
create policy "workspace_admin_delete_features" on public.plan_task_features
  for delete using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_task_features.plan_id and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );

-- A step can say which feature it delivers, and who wrote it.
alter table public.plan_task_steps
  add column if not exists feature_id uuid references public.plan_task_features(id) on delete set null,
  add column if not exists source text not null default 'human'
    check (source in ('human', 'agent', 'ai'));
create index if not exists idx_plan_task_steps_feature
  on public.plan_task_steps(feature_id) where feature_id is not null;

-- ---------------------------------------------------------------------------
-- Questions
-- ---------------------------------------------------------------------------
create table if not exists public.plan_task_questions (
  id                    uuid primary key default gen_random_uuid(),
  task_id               uuid not null references public.plan_tasks(id) on delete cascade,
  plan_id               uuid not null references public.plans(id) on delete cascade,
  body                  text not null check (char_length(btrim(body)) between 1 and 2000),
  blocking              boolean not null default false,
  status                text not null default 'open' check (status in ('open', 'answered', 'dismissed')),
  answer                text check (answer is null or char_length(answer) <= 5000),
  asked_by_user_id      uuid references public.profiles(id) on delete set null,
  asked_by_agent_id     uuid references public.plan_agents(id) on delete set null,
  answered_by_user_id   uuid references public.profiles(id) on delete set null,
  answered_by_agent_id  uuid references public.plan_agents(id) on delete set null,
  answered_at           timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_plan_task_questions_task on public.plan_task_questions(task_id, created_at);
create index if not exists idx_plan_task_questions_plan_open
  on public.plan_task_questions(plan_id) where status = 'open';
alter table public.plan_task_questions enable row level security;

drop trigger if exists plan_task_questions_inherit on public.plan_task_questions;
create trigger plan_task_questions_inherit
  before insert on public.plan_task_questions
  for each row execute function public.plan_child_inherit_plan();

drop trigger if exists plan_task_questions_updated_at on public.plan_task_questions;
create trigger plan_task_questions_updated_at
  before update on public.plan_task_questions
  for each row execute function public.plan_touch_updated_at();

-- Holds a task in "blocked" while a blocking question is open, and puts it back
-- where it was when the last one is answered or dismissed. Runs as the table
-- owner so it works the same for people (RLS) and for agents (service role).
create or replace function public.plan_sync_question_block()
returns trigger language plpgsql
security definer
set search_path = public
as $$
declare
  tid uuid := coalesce(new.task_id, old.task_id);
  open_blocking integer;
  current_status public.plan_task_status;
  previous_status public.plan_task_status;
begin
  select count(*) into open_blocking
  from public.plan_task_questions
  where task_id = tid and status = 'open' and blocking;

  select status, blocked_from into current_status, previous_status
  from public.plan_tasks where id = tid for update;
  if not found then
    return null;
  end if;

  if open_blocking > 0 and current_status not in ('blocked', 'done') then
    update public.plan_tasks
      set status = 'blocked', blocked_from = current_status
      where id = tid;
  elsif open_blocking = 0 and current_status = 'blocked' and previous_status is not null then
    update public.plan_tasks
      set status = previous_status, blocked_from = null
      where id = tid;
  end if;
  return null;
end $$;

drop trigger if exists plan_task_questions_block on public.plan_task_questions;
create trigger plan_task_questions_block
  after insert or update of status, blocking or delete on public.plan_task_questions
  for each row execute function public.plan_sync_question_block();

create policy "workspace_read_questions" on public.plan_task_questions
  for select using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_task_questions.plan_id and wm.user_id = auth.uid()
    )
  );
create policy "workspace_member_insert_questions" on public.plan_task_questions
  for insert with check (
    asked_by_user_id = auth.uid()
    and exists (
      select 1 from public.plan_tasks t
      join public.plans p on p.id = t.plan_id
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where t.id = plan_task_questions.task_id and wm.user_id = auth.uid()
    )
  );
create policy "workspace_member_update_questions" on public.plan_task_questions
  for update using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_task_questions.plan_id and wm.user_id = auth.uid()
    )
  );
create policy "asker_or_admin_delete_questions" on public.plan_task_questions
  for delete using (
    asked_by_user_id = auth.uid()
    or exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_task_questions.plan_id and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- Per-person AI switches
-- ---------------------------------------------------------------------------
create table if not exists public.user_ai_settings (
  user_id      uuid primary key references public.profiles(id) on delete cascade,
  auto_enrich  boolean not null default false,
  updated_at   timestamptz not null default now()
);
alter table public.user_ai_settings enable row level security;

create policy "own_ai_settings_select" on public.user_ai_settings
  for select using (user_id = auth.uid());
create policy "own_ai_settings_insert" on public.user_ai_settings
  for insert with check (user_id = auth.uid());
create policy "own_ai_settings_update" on public.user_ai_settings
  for update using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants and realtime
-- ---------------------------------------------------------------------------
grant all on public.plan_task_features  to service_role;
grant all on public.plan_task_questions to service_role;
grant all on public.user_ai_settings    to service_role;

do $$
declare
  t text;
begin
  foreach t in array array['plan_task_features', 'plan_task_questions']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
