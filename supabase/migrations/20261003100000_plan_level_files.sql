-- Files on the plan itself.
--
-- A plan could only carry files by way of a task, so a brief, a spec or a design
-- that belongs to the whole plan had nowhere to live and agents could not be
-- pointed at it. A plan-level file is a plan_task_attachments row with no task:
-- it names its plan directly, and everything else (the bucket, the signed URLs,
-- sharing with agents, who may change it) works the way it does for a task's
-- files, because it is the same row.
--
--  * task_id is optional. plan_id was already on every row; the trigger used to
--    derive it from the task and now takes the one the file names when there is
--    no task.
--  * A file with no task cannot belong to a note, and a marked-up copy stays at
--    the level of its original.
--  * Any member of the plan's workspace may add one, as with a task's files.
--    Changing or removing it is still the uploader's or an admin's.
--  * Storage needs nothing new: the upload rule is the uploader's own folder and
--    the read rule already goes through plan_id.

alter table public.plan_task_attachments alter column task_id drop not null;

create or replace function public.plan_attachment_before_insert()
returns trigger language plpgsql
set search_path = public
as $$
declare
  task_plan uuid;
  source_task uuid;
  source_plan uuid;
  comment_task uuid;
begin
  if new.task_id is null then
    if new.plan_id is null or not exists (select 1 from public.plans where id = new.plan_id) then
      raise exception 'That plan no longer exists';
    end if;
    if new.comment_id is not null then
      raise exception 'A file on the plan itself cannot belong to a note';
    end if;
  else
    select plan_id into task_plan from public.plan_tasks where id = new.task_id;
    if task_plan is null then
      raise exception 'That task no longer exists';
    end if;
    new.plan_id := task_plan;
  end if;

  if new.source_attachment_id is not null then
    select task_id, plan_id into source_task, source_plan
    from public.plan_task_attachments where id = new.source_attachment_id;
    if source_task is distinct from new.task_id or source_plan is distinct from new.plan_id then
      raise exception 'A marked-up copy must belong to the same task as its original';
    end if;
  end if;

  if new.comment_id is not null then
    select task_id into comment_task
    from public.plan_task_comments where id = new.comment_id;
    if comment_task is distinct from new.task_id then
      raise exception 'That note belongs to a different task';
    end if;
  end if;
  return new;
end $$;

-- Adding a file is open to every member of the plan's workspace, to a task or to
-- the plan itself.
drop policy if exists "workspace_member_insert_plan_attachments" on public.plan_task_attachments;
create policy "workspace_member_insert_plan_attachments" on public.plan_task_attachments
  for insert with check (
    uploader_id = auth.uid()
    and exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_task_attachments.plan_id
        and wm.user_id = auth.uid()
        and (
          plan_task_attachments.task_id is null
          or exists (
            select 1 from public.plan_tasks t
            where t.id = plan_task_attachments.task_id and t.plan_id = p.id
          )
        )
    )
  );
