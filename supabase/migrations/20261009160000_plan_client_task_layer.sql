-- The client layer reaches down to tasks and steps.
--
-- Clients of a shared plan see a column board: one column per section, with the
-- tasks of that section as cards and each task's steps as a checklist, all in
-- plain words. The agency's own wording stays technical, so each of these has a
-- separate client text, and nothing reaches a client until someone has written
-- it: a task without client_title, or a step without client_text, is simply not
-- part of what they see.

alter table public.plan_tasks
  add column if not exists client_title text,
  add column if not exists client_summary text;

alter table public.plan_task_steps
  add column if not exists client_text text;

comment on column public.plan_tasks.client_title is
  'Client layer: the task as a client reads it, a short plain Danish name. A task is shown to clients only when this is set.';
comment on column public.plan_tasks.client_summary is
  'Client layer: optional one plain Danish sentence explaining the task to a client.';
comment on column public.plan_task_steps.client_text is
  'Client layer: the step in plain Danish. A step is shown to clients only when this is set.';

-- Sections with their client-written tasks. Counts still cover every task so
-- progress is the real progress; the cards are only the ones with a client text.
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
          ),
          'unwritten_task_count', (
            select count(*) from public.plan_tasks t
            where t.section_id = s.id and nullif(btrim(coalesce(t.client_title, '')), '') is null
          ),
          'tasks', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', t.id,
                'title', btrim(t.client_title),
                'summary', nullif(btrim(coalesce(t.client_summary, '')), ''),
                'status', case t.status::text
                  when 'done' then 'done'
                  when 'blocked' then 'waiting'
                  when 'in_progress' then 'in_progress'
                  when 'in_review' then 'in_progress'
                  when 'claimed' then 'in_progress'
                  else 'todo'
                end,
                'position', t.position,
                'steps', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', st.id,
                      'text', btrim(st.client_text),
                      'done', st.done
                    )
                    order by st.position, st.created_at
                  )
                  from public.plan_task_steps st
                  where st.task_id = t.id
                    and nullif(btrim(coalesce(st.client_text, '')), '') is not null
                ), '[]'::jsonb)
              )
              order by t.position, t.created_at
            )
            from public.plan_tasks t
            where t.section_id = s.id
              and nullif(btrim(coalesce(t.client_title, '')), '') is not null
          ), '[]'::jsonb)
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

revoke execute on function public.plan_client_overview(uuid) from public, anon;
grant execute on function public.plan_client_overview(uuid) to authenticated;
