-- Plans have two layers.
--
--   Client layer: what the client sees on a plan shared with them. Per section a
--   short plain-language (Danish) summary, plus progress counted from its tasks.
--   Clients read it through plan_client_overview() and may write the summary
--   through set_section_client_summary().
--
--   Agency layer: everything else (tasks, steps, features, questions, comments,
--   activity, attachments, patches). Workspace admins and the AI agents working
--   as them. Clients no longer read or write it directly.
--
-- Until now can_view_plan() / can_edit_plan() opened the whole plan to any
-- project client. RLS cannot hide columns, so the agency layer is closed to
-- clients table by table, and the client layer is served by narrow
-- SECURITY DEFINER functions instead.

alter table public.plan_sections
  add column if not exists client_summary text;

comment on column public.plan_sections.client_summary is
  'Client layer: a short plain-language summary (Danish) of this section, shown to clients of a client-view plan. Everything else on the section is the agency layer.';

-- Agency layer access: workspace admins only. -----------------------------

create or replace function public.can_view_plan_work(_plan_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.plans p
    where p.id = _plan_id
      and public.is_workspace_admin(p.workspace_id, _user_id)
  );
$$;

create or replace function public.can_edit_plan_work(_plan_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_plan_work(_plan_id, _user_id);
$$;

revoke execute on function public.can_view_plan_work(uuid, uuid) from public, anon;
revoke execute on function public.can_edit_plan_work(uuid, uuid) from public, anon;
grant execute on function public.can_view_plan_work(uuid, uuid) to authenticated;
grant execute on function public.can_edit_plan_work(uuid, uuid) to authenticated;

-- plans: clients still read the row (so a shared plan is listed), but only the
-- agency changes it. The client layer is written through the RPC below.
drop policy if exists "workspace_admin_update_plans" on public.plans;
create policy "workspace_admin_update_plans" on public.plans
  for update using (public.can_edit_plan_work(id, auth.uid()))
  with check (public.can_edit_plan_work(id, auth.uid()));

drop policy if exists "workspace_admin_delete_plans" on public.plans;
create policy "workspace_admin_delete_plans" on public.plans
  for delete using (public.can_edit_plan_work(id, auth.uid()));

-- plan_sections -------------------------------------------------------------
drop policy if exists "workspace_read_sections" on public.plan_sections;
create policy "workspace_read_sections" on public.plan_sections
  for select using (public.can_view_plan_work(plan_id, auth.uid()));

drop policy if exists "workspace_admin_write_sections" on public.plan_sections;
create policy "workspace_admin_write_sections" on public.plan_sections
  for insert with check (public.can_edit_plan_work(plan_id, auth.uid()));

drop policy if exists "workspace_admin_update_sections" on public.plan_sections;
create policy "workspace_admin_update_sections" on public.plan_sections
  for update using (public.can_edit_plan_work(plan_id, auth.uid()))
  with check (public.can_edit_plan_work(plan_id, auth.uid()));

drop policy if exists "workspace_admin_delete_sections" on public.plan_sections;
create policy "workspace_admin_delete_sections" on public.plan_sections
  for delete using (public.can_edit_plan_work(plan_id, auth.uid()));

-- plan_tasks ----------------------------------------------------------------
drop policy if exists "workspace_read_tasks" on public.plan_tasks;
create policy "workspace_read_tasks" on public.plan_tasks
  for select using (public.can_view_plan_work(plan_id, auth.uid()));

drop policy if exists "workspace_admin_write_tasks" on public.plan_tasks;
create policy "workspace_admin_write_tasks" on public.plan_tasks
  for insert with check (public.can_edit_plan_work(plan_id, auth.uid()));

drop policy if exists "workspace_admin_update_tasks" on public.plan_tasks;
create policy "workspace_admin_update_tasks" on public.plan_tasks
  for update using (public.can_edit_plan_work(plan_id, auth.uid()))
  with check (public.can_edit_plan_work(plan_id, auth.uid()));

drop policy if exists "workspace_admin_delete_tasks" on public.plan_tasks;
create policy "workspace_admin_delete_tasks" on public.plan_tasks
  for delete using (public.can_edit_plan_work(plan_id, auth.uid()));

-- plan_task_steps -----------------------------------------------------------
drop policy if exists "workspace_read_steps" on public.plan_task_steps;
create policy "workspace_read_steps" on public.plan_task_steps
  for select using (public.can_view_plan_work(plan_id, auth.uid()));

drop policy if exists "workspace_admin_insert_steps" on public.plan_task_steps;
create policy "workspace_admin_insert_steps" on public.plan_task_steps
  for insert with check (
    exists (
      select 1 from public.plan_tasks t
      where t.id = plan_task_steps.task_id
        and public.can_edit_plan_work(t.plan_id, auth.uid())
    )
  );

drop policy if exists "workspace_admin_update_steps" on public.plan_task_steps;
create policy "workspace_admin_update_steps" on public.plan_task_steps
  for update using (public.can_edit_plan_work(plan_id, auth.uid()))
  with check (public.can_edit_plan_work(plan_id, auth.uid()));

drop policy if exists "workspace_admin_delete_steps" on public.plan_task_steps;
create policy "workspace_admin_delete_steps" on public.plan_task_steps
  for delete using (public.can_edit_plan_work(plan_id, auth.uid()));

-- plan_task_features --------------------------------------------------------
drop policy if exists "workspace_read_features" on public.plan_task_features;
create policy "workspace_read_features" on public.plan_task_features
  for select using (public.can_view_plan_work(plan_id, auth.uid()));

drop policy if exists "workspace_admin_insert_features" on public.plan_task_features;
create policy "workspace_admin_insert_features" on public.plan_task_features
  for insert with check (
    exists (
      select 1 from public.plan_tasks t
      where t.id = plan_task_features.task_id
        and public.can_edit_plan_work(t.plan_id, auth.uid())
    )
  );

drop policy if exists "workspace_admin_update_features" on public.plan_task_features;
create policy "workspace_admin_update_features" on public.plan_task_features
  for update using (public.can_edit_plan_work(plan_id, auth.uid()))
  with check (public.can_edit_plan_work(plan_id, auth.uid()));

drop policy if exists "workspace_admin_delete_features" on public.plan_task_features;
create policy "workspace_admin_delete_features" on public.plan_task_features
  for delete using (public.can_edit_plan_work(plan_id, auth.uid()));

-- plan_task_questions -------------------------------------------------------
drop policy if exists "workspace_read_questions" on public.plan_task_questions;
create policy "workspace_read_questions" on public.plan_task_questions
  for select using (public.can_view_plan_work(plan_id, auth.uid()));

drop policy if exists "workspace_member_insert_questions" on public.plan_task_questions;
create policy "workspace_member_insert_questions" on public.plan_task_questions
  for insert with check (
    asked_by_user_id = auth.uid()
    and exists (
      select 1 from public.plan_tasks t
      where t.id = plan_task_questions.task_id
        and public.can_edit_plan_work(t.plan_id, auth.uid())
    )
  );

drop policy if exists "workspace_member_update_questions" on public.plan_task_questions;
create policy "workspace_member_update_questions" on public.plan_task_questions
  for update using (public.can_edit_plan_work(plan_id, auth.uid()))
  with check (public.can_edit_plan_work(plan_id, auth.uid()));

drop policy if exists "asker_or_admin_delete_questions" on public.plan_task_questions;
create policy "asker_or_admin_delete_questions" on public.plan_task_questions
  for delete using (
    asked_by_user_id = auth.uid() or public.can_edit_plan_work(plan_id, auth.uid())
  );

-- plan_task_comments --------------------------------------------------------
drop policy if exists "workspace_read_comments" on public.plan_task_comments;
create policy "workspace_read_comments" on public.plan_task_comments
  for select using (
    exists (
      select 1 from public.plan_tasks t
      where t.id = plan_task_comments.task_id
        and public.can_view_plan_work(t.plan_id, auth.uid())
    )
  );

drop policy if exists "workspace_admin_write_comments" on public.plan_task_comments;
create policy "workspace_admin_write_comments" on public.plan_task_comments
  for insert with check (
    exists (
      select 1 from public.plan_tasks t
      where t.id = plan_task_comments.task_id
        and public.can_edit_plan_work(t.plan_id, auth.uid())
    )
  );

-- plan_events ---------------------------------------------------------------
drop policy if exists "workspace_read_events" on public.plan_events;
create policy "workspace_read_events" on public.plan_events
  for select using (public.can_view_plan_work(plan_id, auth.uid()));

drop policy if exists "workspace_member_insert_events" on public.plan_events;
create policy "workspace_member_insert_events" on public.plan_events
  for insert with check (
    actor_id = auth.uid() and public.can_edit_plan_work(plan_id, auth.uid())
  );

-- plan_task_attachments -----------------------------------------------------
drop policy if exists "workspace_read_plan_attachments" on public.plan_task_attachments;
create policy "workspace_read_plan_attachments" on public.plan_task_attachments
  for select using (public.can_view_plan_work(plan_id, auth.uid()));

drop policy if exists "workspace_member_insert_plan_attachments" on public.plan_task_attachments;
create policy "workspace_member_insert_plan_attachments" on public.plan_task_attachments
  for insert with check (
    uploader_id = auth.uid()
    and public.can_edit_plan_work(plan_id, auth.uid())
    and (
      task_id is null
      or exists (
        select 1 from public.plan_tasks t
        where t.id = plan_task_attachments.task_id
          and t.plan_id = plan_task_attachments.plan_id
      )
    )
  );

drop policy if exists "uploader_or_admin_update_plan_attachments" on public.plan_task_attachments;
create policy "uploader_or_admin_update_plan_attachments" on public.plan_task_attachments
  for update using (
    uploader_id = auth.uid() or public.can_edit_plan_work(plan_id, auth.uid())
  )
  with check (
    uploader_id = auth.uid() or public.can_edit_plan_work(plan_id, auth.uid())
  );

drop policy if exists "uploader_or_admin_delete_plan_attachments" on public.plan_task_attachments;
create policy "uploader_or_admin_delete_plan_attachments" on public.plan_task_attachments
  for delete using (
    uploader_id = auth.uid() or public.can_edit_plan_work(plan_id, auth.uid())
  );

-- plan_patches --------------------------------------------------------------
drop policy if exists plan_patches_workspace_read on public.plan_patches;
create policy plan_patches_workspace_read on public.plan_patches
  for select to authenticated
  using (public.can_view_plan_work(plan_id, auth.uid()));

drop policy if exists plan_patches_admin_insert on public.plan_patches;
create policy plan_patches_admin_insert on public.plan_patches
  for insert to authenticated
  with check (public.can_edit_plan_work(plan_id, auth.uid()));

drop policy if exists plan_patches_admin_update on public.plan_patches;
create policy plan_patches_admin_update on public.plan_patches
  for update to authenticated
  using (public.can_edit_plan_work(plan_id, auth.uid()))
  with check (public.can_edit_plan_work(plan_id, auth.uid()));

drop policy if exists plan_patches_admin_delete on public.plan_patches;
create policy plan_patches_admin_delete on public.plan_patches
  for delete to authenticated
  using (public.can_edit_plan_work(plan_id, auth.uid()));

-- Storage: the plan-attachments bucket follows the agency layer. -----------
drop policy if exists "plan_attachments_read_own_or_workspace" on storage.objects;
create policy "plan_attachments_read_own_or_workspace" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'plan-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1
        from public.plan_task_attachments a
        where a.storage_bucket = storage.objects.bucket_id
          and a.storage_path = storage.objects.name
          and public.can_view_plan_work(a.plan_id, auth.uid())
      )
    )
  );

-- The client layer ----------------------------------------------------------

-- A plan as its clients see it: sections with their summary and progress, and
-- nothing from the agency layer (no task titles, steps, goals or intentions).
create or replace function public.plan_client_overview(_plan_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.can_view_plan(_plan_id, auth.uid()) then
    raise exception 'Forbidden';
  end if;

  select jsonb_build_object(
    'id', p.id,
    'title', p.title,
    'status', p.status,
    'project_id', p.project_id,
    'updated_at', p.updated_at,
    'sections', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', s.id,
          'title', s.title,
          'color', s.color,
          'position', s.position,
          'client_summary', s.client_summary,
          'task_count', (select count(*) from public.plan_tasks t where t.section_id = s.id),
          'done_task_count', (
            select count(*) from public.plan_tasks t
            where t.section_id = s.id and t.status = 'done'
          )
        )
        order by s.position, s.created_at
      )
      from public.plan_sections s
      where s.plan_id = p.id
    ), '[]'::jsonb)
  )
  into result
  from public.plans p
  where p.id = _plan_id;

  return result;
end;
$$;

-- Counts for plan lists, for people who can see the plan but not its tasks.
create or replace function public.plan_client_progress(_plan_ids uuid[])
returns table (plan_id uuid, section_count bigint, task_count bigint, done_task_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    (select count(*) from public.plan_sections s where s.plan_id = p.id),
    (select count(*) from public.plan_tasks t where t.plan_id = p.id),
    (select count(*) from public.plan_tasks t where t.plan_id = p.id and t.status = 'done')
  from public.plans p
  where p.id = any(_plan_ids)
    and public.can_view_plan(p.id, auth.uid());
$$;

-- Writes a section's client summary. Anyone who can edit the plan may, which is
-- the only part of a plan a client can change.
create or replace function public.set_section_client_summary(_section_id uuid, _summary text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_plan uuid;
  cleaned text := nullif(btrim(coalesce(_summary, '')), '');
begin
  select plan_id into target_plan from public.plan_sections where id = _section_id;
  if target_plan is null then
    raise exception 'Not found';
  end if;
  if not public.can_edit_plan(target_plan, auth.uid()) then
    raise exception 'Forbidden';
  end if;
  if cleaned is not null and char_length(cleaned) > 2000 then
    raise exception 'The summary is too long (max 2000 characters)';
  end if;

  update public.plan_sections set client_summary = cleaned where id = _section_id;
end;
$$;

revoke execute on function public.plan_client_overview(uuid) from public, anon;
revoke execute on function public.plan_client_progress(uuid[]) from public, anon;
revoke execute on function public.set_section_client_summary(uuid, text) from public, anon;
grant execute on function public.plan_client_overview(uuid) to authenticated;
grant execute on function public.plan_client_progress(uuid[]) to authenticated;
grant execute on function public.set_section_client_summary(uuid, text) to authenticated;

-- Client interaction ---------------------------------------------------------
-- What a client can do on the client layer: comment on a section or on the
-- whole plan, and approve a section. Anyone who can view the plan can; the
-- agency sees all of it. None of this touches the agency layer.

-- Policy checks run as the caller, who cannot read plan_sections any more, so
-- "does this section belong to this plan" is asked from a definer function.
create or replace function public.section_in_plan(_section_id uuid, _plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.plan_sections s
    where s.id = _section_id and s.plan_id = _plan_id
  );
$$;

revoke execute on function public.section_in_plan(uuid, uuid) from public, anon;
grant execute on function public.section_in_plan(uuid, uuid) to authenticated;

create table if not exists public.plan_section_comments (
  id         uuid primary key default gen_random_uuid(),
  plan_id    uuid not null references public.plans(id) on delete cascade,
  -- null: a comment on the plan as a whole
  section_id uuid references public.plan_sections(id) on delete cascade,
  author_id  uuid not null references public.profiles(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists idx_plan_section_comments_plan
  on public.plan_section_comments(plan_id, created_at);
alter table public.plan_section_comments enable row level security;

grant select, insert, delete on public.plan_section_comments to authenticated;
grant all on public.plan_section_comments to service_role;

drop policy if exists "client_layer_read_comments" on public.plan_section_comments;
create policy "client_layer_read_comments" on public.plan_section_comments
  for select using (public.can_view_plan(plan_id, auth.uid()));

drop policy if exists "client_layer_write_comments" on public.plan_section_comments;
create policy "client_layer_write_comments" on public.plan_section_comments
  for insert with check (
    author_id = auth.uid()
    and public.can_edit_plan(plan_id, auth.uid())
    and (section_id is null or public.section_in_plan(section_id, plan_id))
  );

drop policy if exists "client_layer_delete_comments" on public.plan_section_comments;
create policy "client_layer_delete_comments" on public.plan_section_comments
  for delete using (
    author_id = auth.uid() or public.can_edit_plan_work(plan_id, auth.uid())
  );

create table if not exists public.plan_section_approvals (
  section_id uuid not null references public.plan_sections(id) on delete cascade,
  plan_id    uuid not null references public.plans(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (section_id, user_id)
);
create index if not exists idx_plan_section_approvals_plan
  on public.plan_section_approvals(plan_id);
alter table public.plan_section_approvals enable row level security;

grant select, insert, delete on public.plan_section_approvals to authenticated;
grant all on public.plan_section_approvals to service_role;

drop policy if exists "client_layer_read_approvals" on public.plan_section_approvals;
create policy "client_layer_read_approvals" on public.plan_section_approvals
  for select using (public.can_view_plan(plan_id, auth.uid()));

drop policy if exists "client_layer_write_approvals" on public.plan_section_approvals;
create policy "client_layer_write_approvals" on public.plan_section_approvals
  for insert with check (
    user_id = auth.uid()
    and public.can_edit_plan(plan_id, auth.uid())
    and public.section_in_plan(section_id, plan_id)
  );

drop policy if exists "client_layer_delete_approvals" on public.plan_section_approvals;
create policy "client_layer_delete_approvals" on public.plan_section_approvals
  for delete using (user_id = auth.uid());
