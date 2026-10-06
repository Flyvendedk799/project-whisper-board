-- Clients should see plans for projects they belong to by default.
-- Admins can hide a plan from clients with plans.clients_can_view = false.
-- Create/update/delete stay admin-only (existing write policies unchanged).

alter table public.plans
  add column if not exists clients_can_view boolean not null default true;

comment on column public.plans.clients_can_view is
  'When true (default), project-member clients can read this plan. Admins always can. Set false to hide from clients.';

-- SECURITY DEFINER so policy evaluation can read plans without recursing RLS.
create or replace function public.can_view_plan(_plan_id uuid, _user_id uuid)
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
      and (
        public.is_workspace_admin(p.workspace_id, _user_id)
        or (
          p.clients_can_view
          and p.project_id is not null
          and exists (
            select 1
            from public.project_members pm
            where pm.project_id = p.project_id
              and pm.user_id = _user_id
          )
          and exists (
            select 1
            from public.workspace_members wm
            where wm.workspace_id = p.workspace_id
              and wm.user_id = _user_id
          )
        )
      )
  );
$$;

revoke execute on function public.can_view_plan(uuid, uuid) from public, anon;
grant execute on function public.can_view_plan(uuid, uuid) to authenticated;

-- plans -----------------------------------------------------------------
drop policy if exists "workspace_read_plans" on public.plans;
create policy "workspace_read_plans" on public.plans
  for select using (public.can_view_plan(id, auth.uid()));

-- plan_sections ---------------------------------------------------------
drop policy if exists "workspace_read_sections" on public.plan_sections;
create policy "workspace_read_sections" on public.plan_sections
  for select using (public.can_view_plan(plan_id, auth.uid()));

-- plan_tasks ------------------------------------------------------------
drop policy if exists "workspace_read_tasks" on public.plan_tasks;
create policy "workspace_read_tasks" on public.plan_tasks
  for select using (public.can_view_plan(plan_id, auth.uid()));

-- plan_events -----------------------------------------------------------
drop policy if exists "workspace_read_events" on public.plan_events;
create policy "workspace_read_events" on public.plan_events
  for select using (public.can_view_plan(plan_id, auth.uid()));

-- plan_task_comments ----------------------------------------------------
drop policy if exists "workspace_read_comments" on public.plan_task_comments;
create policy "workspace_read_comments" on public.plan_task_comments
  for select using (
    exists (
      select 1
      from public.plan_tasks t
      where t.id = plan_task_comments.task_id
        and public.can_view_plan(t.plan_id, auth.uid())
    )
  );

-- plan_task_steps -------------------------------------------------------
drop policy if exists "workspace_read_steps" on public.plan_task_steps;
create policy "workspace_read_steps" on public.plan_task_steps
  for select using (public.can_view_plan(plan_id, auth.uid()));

-- plan_task_attachments -------------------------------------------------
drop policy if exists "workspace_read_plan_attachments" on public.plan_task_attachments;
create policy "workspace_read_plan_attachments" on public.plan_task_attachments
  for select using (public.can_view_plan(plan_id, auth.uid()));

-- plan_task_features ----------------------------------------------------
drop policy if exists "workspace_read_features" on public.plan_task_features;
create policy "workspace_read_features" on public.plan_task_features
  for select using (public.can_view_plan(plan_id, auth.uid()));

-- plan_task_questions ---------------------------------------------------
drop policy if exists "workspace_read_questions" on public.plan_task_questions;
create policy "workspace_read_questions" on public.plan_task_questions
  for select using (public.can_view_plan(plan_id, auth.uid()));

-- plan_patches ----------------------------------------------------------
drop policy if exists plan_patches_workspace_read on public.plan_patches;
create policy plan_patches_workspace_read on public.plan_patches
  for select to authenticated
  using (public.can_view_plan(plan_id, auth.uid()));

-- Storage: plan-attachments bucket must follow the same visibility rule.
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
          and public.can_view_plan(a.plan_id, auth.uid())
      )
    )
  );
