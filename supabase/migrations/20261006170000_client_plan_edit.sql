-- Clients who can see a plan can edit it at the same level as workspace admins.
-- Visibility from #35/#36 is unchanged: can_edit_plan mirrors can_view_plan.
-- Creating a new plan stays workspace-admin-only.

create or replace function public.can_edit_plan(_plan_id uuid, _user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.can_view_plan(_plan_id, _user_id);
$$;

comment on function public.can_edit_plan(uuid, uuid) is
  'True when the user may mutate the plan and its child rows. Same rule as can_view_plan.';

revoke execute on function public.can_edit_plan(uuid, uuid) from public, anon;
grant execute on function public.can_edit_plan(uuid, uuid) to authenticated;

-- plans: keep insert admin-only; open update/delete to editors --------------------
drop policy if exists "workspace_admin_update_plans" on public.plans;
create policy "workspace_admin_update_plans" on public.plans
  for update using (public.can_edit_plan(id, auth.uid()))
  with check (public.can_edit_plan(id, auth.uid()));

drop policy if exists "workspace_admin_delete_plans" on public.plans;
create policy "workspace_admin_delete_plans" on public.plans
  for delete using (public.can_edit_plan(id, auth.uid()));

-- plan_sections -----------------------------------------------------------------
drop policy if exists "workspace_admin_write_sections" on public.plan_sections;
create policy "workspace_admin_write_sections" on public.plan_sections
  for insert with check (public.can_edit_plan(plan_id, auth.uid()));

drop policy if exists "workspace_admin_update_sections" on public.plan_sections;
create policy "workspace_admin_update_sections" on public.plan_sections
  for update using (public.can_edit_plan(plan_id, auth.uid()))
  with check (public.can_edit_plan(plan_id, auth.uid()));

drop policy if exists "workspace_admin_delete_sections" on public.plan_sections;
create policy "workspace_admin_delete_sections" on public.plan_sections
  for delete using (public.can_edit_plan(plan_id, auth.uid()));

-- plan_tasks --------------------------------------------------------------------
drop policy if exists "workspace_admin_write_tasks" on public.plan_tasks;
create policy "workspace_admin_write_tasks" on public.plan_tasks
  for insert with check (public.can_edit_plan(plan_id, auth.uid()));

drop policy if exists "workspace_admin_update_tasks" on public.plan_tasks;
create policy "workspace_admin_update_tasks" on public.plan_tasks
  for update using (public.can_edit_plan(plan_id, auth.uid()))
  with check (public.can_edit_plan(plan_id, auth.uid()));

drop policy if exists "workspace_admin_delete_tasks" on public.plan_tasks;
create policy "workspace_admin_delete_tasks" on public.plan_tasks
  for delete using (public.can_edit_plan(plan_id, auth.uid()));

-- plan_task_steps ---------------------------------------------------------------
drop policy if exists "workspace_admin_insert_steps" on public.plan_task_steps;
create policy "workspace_admin_insert_steps" on public.plan_task_steps
  for insert with check (
    exists (
      select 1 from public.plan_tasks t
      where t.id = plan_task_steps.task_id
        and public.can_edit_plan(t.plan_id, auth.uid())
    )
  );

drop policy if exists "workspace_admin_update_steps" on public.plan_task_steps;
create policy "workspace_admin_update_steps" on public.plan_task_steps
  for update using (public.can_edit_plan(plan_id, auth.uid()))
  with check (public.can_edit_plan(plan_id, auth.uid()));

drop policy if exists "workspace_admin_delete_steps" on public.plan_task_steps;
create policy "workspace_admin_delete_steps" on public.plan_task_steps
  for delete using (public.can_edit_plan(plan_id, auth.uid()));

-- plan_task_features ------------------------------------------------------------
drop policy if exists "workspace_admin_insert_features" on public.plan_task_features;
create policy "workspace_admin_insert_features" on public.plan_task_features
  for insert with check (
    exists (
      select 1 from public.plan_tasks t
      where t.id = plan_task_features.task_id
        and public.can_edit_plan(t.plan_id, auth.uid())
    )
  );

drop policy if exists "workspace_admin_update_features" on public.plan_task_features;
create policy "workspace_admin_update_features" on public.plan_task_features
  for update using (public.can_edit_plan(plan_id, auth.uid()))
  with check (public.can_edit_plan(plan_id, auth.uid()));

drop policy if exists "workspace_admin_delete_features" on public.plan_task_features;
create policy "workspace_admin_delete_features" on public.plan_task_features
  for delete using (public.can_edit_plan(plan_id, auth.uid()));

-- plan_patches ------------------------------------------------------------------
drop policy if exists plan_patches_admin_insert on public.plan_patches;
create policy plan_patches_admin_insert on public.plan_patches
  for insert to authenticated
  with check (public.can_edit_plan(plan_id, auth.uid()));

drop policy if exists plan_patches_admin_update on public.plan_patches;
create policy plan_patches_admin_update on public.plan_patches
  for update to authenticated
  using (public.can_edit_plan(plan_id, auth.uid()))
  with check (public.can_edit_plan(plan_id, auth.uid()));

drop policy if exists plan_patches_admin_delete on public.plan_patches;
create policy plan_patches_admin_delete on public.plan_patches
  for delete to authenticated
  using (public.can_edit_plan(plan_id, auth.uid()));

-- attachments: editors match admin (uploader still can); insert needs edit access
drop policy if exists "workspace_member_insert_plan_attachments" on public.plan_task_attachments;
create policy "workspace_member_insert_plan_attachments" on public.plan_task_attachments
  for insert with check (
    uploader_id = auth.uid()
    and public.can_edit_plan(plan_id, auth.uid())
    and (
      plan_task_attachments.task_id is null
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
    uploader_id = auth.uid()
    or public.can_edit_plan(plan_id, auth.uid())
  )
  with check (
    uploader_id = auth.uid()
    or public.can_edit_plan(plan_id, auth.uid())
  );

drop policy if exists "uploader_or_admin_delete_plan_attachments" on public.plan_task_attachments;
create policy "uploader_or_admin_delete_plan_attachments" on public.plan_task_attachments
  for delete using (
    uploader_id = auth.uid()
    or public.can_edit_plan(plan_id, auth.uid())
  );

-- questions: insert/update already member-scoped; tighten + delete like edit ----
drop policy if exists "workspace_member_insert_questions" on public.plan_task_questions;
create policy "workspace_member_insert_questions" on public.plan_task_questions
  for insert with check (
    asked_by_user_id = auth.uid()
    and exists (
      select 1 from public.plan_tasks t
      where t.id = plan_task_questions.task_id
        and public.can_edit_plan(t.plan_id, auth.uid())
    )
  );

drop policy if exists "workspace_member_update_questions" on public.plan_task_questions;
create policy "workspace_member_update_questions" on public.plan_task_questions
  for update using (public.can_edit_plan(plan_id, auth.uid()))
  with check (public.can_edit_plan(plan_id, auth.uid()));

drop policy if exists "asker_or_admin_delete_questions" on public.plan_task_questions;
create policy "asker_or_admin_delete_questions" on public.plan_task_questions
  for delete using (
    asked_by_user_id = auth.uid()
    or public.can_edit_plan(plan_id, auth.uid())
  );

-- comments / events: any editor of the plan may write ---------------------------
drop policy if exists "workspace_admin_write_comments" on public.plan_task_comments;
create policy "workspace_admin_write_comments" on public.plan_task_comments
  for insert with check (
    exists (
      select 1 from public.plan_tasks t
      where t.id = plan_task_comments.task_id
        and public.can_edit_plan(t.plan_id, auth.uid())
    )
  );

drop policy if exists "workspace_member_insert_events" on public.plan_events;
create policy "workspace_member_insert_events" on public.plan_events
  for insert with check (
    actor_id = auth.uid()
    and public.can_edit_plan(plan_id, auth.uid())
  );
