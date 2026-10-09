-- Client layer, part three: what is needed, who is asked, and talking about a task.
--
-- A client has the same view and control as the agency on a shared plan, only
-- in plain Danish and without code, diffs or implementation. So besides the task
-- title and steps:
--   * features (what a task must deliver) get a plain wording: it is the list of
--     what is still missing, and a client can see it;
--   * questions get an audience: the agency (the default, i.e. you), the agents,
--     or the client. The agency can send one on to the client with a Danish
--     wording, and a client can ask the agency their own;
--   * a client can comment on a single task, not only on a section.

-- Features ------------------------------------------------------------------
alter table public.plan_task_features
  add column if not exists client_text text;

comment on column public.plan_task_features.client_text is
  'Client layer: this deliverable in plain Danish. A feature is shown to clients only when this is set.';

-- Questions -----------------------------------------------------------------
alter table public.plan_task_questions
  add column if not exists audience text not null default 'agency',
  add column if not exists client_body text,
  add column if not exists from_client boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'plan_task_questions_audience_check'
  ) then
    alter table public.plan_task_questions
      add constraint plan_task_questions_audience_check
      check (audience in ('agency', 'agent', 'client'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'plan_task_questions_client_body_len'
  ) then
    alter table public.plan_task_questions
      add constraint plan_task_questions_client_body_len
      check (client_body is null or char_length(client_body) <= 2000);
  end if;
end $$;

comment on column public.plan_task_questions.audience is
  'Who has to answer: the agency (default), an agent, or the client.';
comment on column public.plan_task_questions.client_body is
  'The question as the client reads it, in plain Danish. Required before a question can be put to the client.';
comment on column public.plan_task_questions.from_client is
  'The client asked this one (always aimed at the agency); the client can see it and its answer.';

create index if not exists idx_plan_task_questions_audience
  on public.plan_task_questions(plan_id, audience) where status = 'open';

-- Comments on a task ----------------------------------------------------------
alter table public.plan_section_comments
  add column if not exists task_id uuid references public.plan_tasks(id) on delete cascade;

create index if not exists idx_plan_section_comments_task
  on public.plan_section_comments(task_id) where task_id is not null;

-- Policy checks run as the caller, who cannot read plan_tasks, so "does this task
-- belong to this plan" is asked from a definer function (as for sections).
create or replace function public.task_in_plan(_task_id uuid, _plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.plan_tasks t
    where t.id = _task_id and t.plan_id = _plan_id
  );
$$;

revoke execute on function public.task_in_plan(uuid, uuid) from public, anon;
grant execute on function public.task_in_plan(uuid, uuid) to authenticated;

drop policy if exists "client_layer_write_comments" on public.plan_section_comments;
create policy "client_layer_write_comments" on public.plan_section_comments
  for insert with check (
    author_id = auth.uid()
    and public.can_edit_plan(plan_id, auth.uid())
    and (section_id is null or public.section_in_plan(section_id, plan_id))
    and (task_id is null or public.task_in_plan(task_id, plan_id))
  );

-- Answering and asking, as a client ---------------------------------------------

-- A client answers a question that was put to them.
create or replace function public.answer_client_question(_question_id uuid, _answer text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.plan_task_questions%rowtype;
  cleaned text := nullif(btrim(coalesce(_answer, '')), '');
begin
  select * into q from public.plan_task_questions where id = _question_id;
  if not found then
    raise exception 'Not found';
  end if;
  if not public.can_edit_plan(q.plan_id, auth.uid()) or q.audience <> 'client' then
    raise exception 'Forbidden';
  end if;
  if q.status <> 'open' then
    raise exception 'Already answered';
  end if;
  if cleaned is null then
    raise exception 'Write an answer first';
  end if;
  if char_length(cleaned) > 5000 then
    raise exception 'The answer is too long';
  end if;

  update public.plan_task_questions
  set status = 'answered',
      answer = cleaned,
      answered_by_user_id = auth.uid(),
      answered_by_agent_id = null,
      answered_at = now()
  where id = _question_id;

  insert into public.plan_events (plan_id, task_id, actor_id, kind, new_value)
  values (q.plan_id, q.task_id, auth.uid(), 'question_answered', left(cleaned, 200));
end;
$$;

-- A client asks the agency something about a task.
create or replace function public.ask_client_question(_task_id uuid, _body text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_plan uuid;
  qid uuid;
  cleaned text := nullif(btrim(coalesce(_body, '')), '');
begin
  select plan_id into target_plan from public.plan_tasks where id = _task_id;
  if target_plan is null then
    raise exception 'Not found';
  end if;
  if not public.can_edit_plan(target_plan, auth.uid()) then
    raise exception 'Forbidden';
  end if;
  if cleaned is null then
    raise exception 'Write the question first';
  end if;
  if char_length(cleaned) > 2000 then
    raise exception 'The question is too long';
  end if;

  insert into public.plan_task_questions (task_id, body, blocking, asked_by_user_id, audience, from_client)
  values (_task_id, cleaned, false, auth.uid(), 'agency', true)
  returning id into qid;

  insert into public.plan_events (plan_id, task_id, actor_id, kind, new_value)
  values (target_plan, _task_id, auth.uid(), 'question_asked', left(cleaned, 200));

  return qid;
end;
$$;

revoke execute on function public.answer_client_question(uuid, text) from public, anon;
revoke execute on function public.ask_client_question(uuid, text) from public, anon;
grant execute on function public.answer_client_question(uuid, text) to authenticated;
grant execute on function public.ask_client_question(uuid, text) to authenticated;

-- The overview, now with what each task must deliver and the client's questions.
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
                ), '[]'::jsonb),
                'features', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', f.id,
                      'text', btrim(f.client_text),
                      'met', f.met
                    )
                    order by f.position, f.created_at
                  )
                  from public.plan_task_features f
                  where f.task_id = t.id
                    and nullif(btrim(coalesce(f.client_text, '')), '') is not null
                ), '[]'::jsonb),
                'questions', coalesce((
                  select jsonb_agg(
                    jsonb_build_object(
                      'id', q.id,
                      'body', case
                        when q.from_client then q.body
                        else btrim(q.client_body)
                      end,
                      'status', q.status,
                      'from_client', q.from_client,
                      'awaiting_client', (q.audience = 'client' and q.status = 'open'),
                      'answer', case when q.status = 'answered' then q.answer else null end,
                      'created_at', q.created_at,
                      'answered_at', q.answered_at
                    )
                    order by q.created_at
                  )
                  from public.plan_task_questions q
                  where q.task_id = t.id
                    and q.status <> 'dismissed'
                    and (
                      q.from_client
                      or (q.audience = 'client' and nullif(btrim(coalesce(q.client_body, '')), '') is not null)
                    )
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
