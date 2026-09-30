-- Plan task sub-steps and media.
--
--  * plan_task_steps        checklist under a task (was nested Markdown in the
--                           description). Ordered, optionally indented.
--  * plan_task_attachments  files on a task or on one of its notes. A marked-up
--                           copy points at the untouched original through
--                           source_attachment_id. `shared_with_agents` decides
--                           whether the agent API and MCP server may see it.
--  * plan-attachments       private storage bucket. The first path segment is
--                           the uploader's id, the same rule the ticket buckets
--                           use (storage_upload_own).
--  * plan_events            members may now write events (server functions were
--                           inserting them with no policy, so the feed was empty).

-- ---------------------------------------------------------------------------
-- Steps
-- ---------------------------------------------------------------------------
create table if not exists public.plan_task_steps (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.plan_tasks(id) on delete cascade,
  plan_id     uuid not null references public.plans(id) on delete cascade,
  text        text not null check (char_length(btrim(text)) between 1 and 500),
  done        boolean not null default false,
  depth       smallint not null default 0 check (depth between 0 and 3),
  position    integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_plan_task_steps_task on public.plan_task_steps(task_id, position);
create index if not exists idx_plan_task_steps_plan on public.plan_task_steps(plan_id);
alter table public.plan_task_steps enable row level security;

create or replace function public.plan_child_inherit_plan()
returns trigger language plpgsql
set search_path = public
as $$
declare
  task_plan uuid;
begin
  select plan_id into task_plan from public.plan_tasks where id = new.task_id;
  if task_plan is null then
    raise exception 'That task no longer exists';
  end if;
  new.plan_id := task_plan;
  return new;
end $$;

drop trigger if exists plan_task_steps_inherit on public.plan_task_steps;
create trigger plan_task_steps_inherit
  before insert on public.plan_task_steps
  for each row execute function public.plan_child_inherit_plan();

drop trigger if exists plan_task_steps_updated_at on public.plan_task_steps;
create trigger plan_task_steps_updated_at
  before update on public.plan_task_steps
  for each row execute function public.plan_touch_updated_at();

create policy "workspace_read_steps" on public.plan_task_steps
  for select using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_task_steps.plan_id and wm.user_id = auth.uid()
    )
  );
create policy "workspace_admin_insert_steps" on public.plan_task_steps
  for insert with check (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      join public.plan_tasks t on t.plan_id = p.id
      where t.id = plan_task_steps.task_id and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );
create policy "workspace_admin_update_steps" on public.plan_task_steps
  for update using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_task_steps.plan_id and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );
create policy "workspace_admin_delete_steps" on public.plan_task_steps
  for delete using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_task_steps.plan_id and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- Attachments
-- ---------------------------------------------------------------------------
create table if not exists public.plan_task_attachments (
  id                    uuid primary key default gen_random_uuid(),
  task_id               uuid not null references public.plan_tasks(id) on delete cascade,
  plan_id               uuid not null references public.plans(id) on delete cascade,
  comment_id            uuid references public.plan_task_comments(id) on delete set null,
  uploader_id           uuid references public.profiles(id) on delete set null,
  storage_bucket        text not null default 'plan-attachments'
                          check (storage_bucket = 'plan-attachments'),
  storage_path          text not null,
  file_name             text not null check (char_length(file_name) between 1 and 255),
  mime_type             text,
  size_bytes            bigint check (size_bytes is null or (size_bytes > 0 and size_bytes <= 26214400)),
  shared_with_agents    boolean not null default true,
  source_attachment_id  uuid references public.plan_task_attachments(id) on delete set null,
  width                 integer,
  height                integer,
  created_at            timestamptz not null default now()
);

create unique index if not exists idx_plan_task_attachments_path
  on public.plan_task_attachments(storage_bucket, storage_path);
create index if not exists idx_plan_task_attachments_task on public.plan_task_attachments(task_id);
create index if not exists idx_plan_task_attachments_plan on public.plan_task_attachments(plan_id);
create index if not exists idx_plan_task_attachments_comment
  on public.plan_task_attachments(comment_id) where comment_id is not null;
create index if not exists idx_plan_task_attachments_source
  on public.plan_task_attachments(source_attachment_id) where source_attachment_id is not null;
alter table public.plan_task_attachments enable row level security;

create or replace function public.plan_attachment_before_insert()
returns trigger language plpgsql
set search_path = public
as $$
declare
  task_plan uuid;
  source_task uuid;
  comment_task uuid;
begin
  select plan_id into task_plan from public.plan_tasks where id = new.task_id;
  if task_plan is null then
    raise exception 'That task no longer exists';
  end if;
  new.plan_id := task_plan;

  if new.source_attachment_id is not null then
    select task_id into source_task
    from public.plan_task_attachments where id = new.source_attachment_id;
    if source_task is distinct from new.task_id then
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

drop trigger if exists plan_attachment_before_insert on public.plan_task_attachments;
create trigger plan_attachment_before_insert
  before insert on public.plan_task_attachments
  for each row execute function public.plan_attachment_before_insert();

-- Mirrors plan_tasks: anyone in the workspace reads. Adding a file is open to
-- every member (notes already are); changing or removing one is for whoever
-- uploaded it and for workspace admins.
create policy "workspace_read_plan_attachments" on public.plan_task_attachments
  for select using (
    exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_task_attachments.plan_id and wm.user_id = auth.uid()
    )
  );
create policy "workspace_member_insert_plan_attachments" on public.plan_task_attachments
  for insert with check (
    uploader_id = auth.uid()
    and exists (
      select 1 from public.plan_tasks t
      join public.plans p on p.id = t.plan_id
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where t.id = plan_task_attachments.task_id and wm.user_id = auth.uid()
    )
  );
create policy "uploader_or_admin_update_plan_attachments" on public.plan_task_attachments
  for update using (
    uploader_id = auth.uid()
    or exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_task_attachments.plan_id and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );
create policy "uploader_or_admin_delete_plan_attachments" on public.plan_task_attachments
  for delete using (
    uploader_id = auth.uid()
    or exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_task_attachments.plan_id and wm.user_id = auth.uid() and wm.role = 'admin'
    )
  );

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('plan-attachments', 'plan-attachments', false)
on conflict (id) do nothing;

create policy "plan_attachments_upload_own" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'plan-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Read what you uploaded, or what is attached to a task in a workspace you
-- belong to. Signed URLs are created server-side with the service role after
-- the attachment row has passed its own RLS, so this is the second lock.
create policy "plan_attachments_read_own_or_workspace" on storage.objects for select to authenticated
  using (
    bucket_id = 'plan-attachments'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1
        from public.plan_task_attachments a
        join public.plans p on p.id = a.plan_id
        join public.workspace_members wm on wm.workspace_id = p.workspace_id
        where a.storage_bucket = storage.objects.bucket_id
          and a.storage_path = storage.objects.name
          and wm.user_id = auth.uid()
      )
    )
  );

-- An upload whose row could not be written is taken back out by its owner.
create policy "plan_attachments_delete_own" on storage.objects for delete to authenticated
  using (bucket_id = 'plan-attachments' and owner = auth.uid());

-- ---------------------------------------------------------------------------
-- Activity feed: members may record events about their own actions.
-- ---------------------------------------------------------------------------
create policy "workspace_member_insert_events" on public.plan_events
  for insert with check (
    actor_id = auth.uid()
    and exists (
      select 1 from public.plans p
      join public.workspace_members wm on wm.workspace_id = p.workspace_id
      where p.id = plan_events.plan_id and wm.user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- Grants and realtime
-- ---------------------------------------------------------------------------
grant all on public.plan_task_steps       to service_role;
grant all on public.plan_task_attachments to service_role;

do $$
declare
  t text;
begin
  foreach t in array array['plan_task_steps', 'plan_task_attachments', 'plan_task_comments']
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
