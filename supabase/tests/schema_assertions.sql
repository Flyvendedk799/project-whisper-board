-- Behavioural assertions for the migrations.
--
-- These do not check that the SQL parses — applying it already proved that.
-- They check the invariants the application now relies on and would otherwise
-- only discover in production: that the workspace boundary hides other people's
-- rows without hiding your own, that progress and audit rows are actually
-- written, and that the constraints we lean on for error messages really fire.

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
set client_min_messages to notice;

begin;

create or replace function assert(_condition boolean, _what text)
returns void language plpgsql as $$
begin
  if not _condition then
    raise exception 'FAILED: %', _what;
  end if;
  raise notice '  ok  %', _what;
end $$;

-- ---------------------------------------------------------------------------
-- Fixtures: two workspaces, so isolation is testable at all.
-- ---------------------------------------------------------------------------
insert into public.workspaces (id, slug, name)
values ('00000000-0000-0000-0000-000000000002', 'rival', 'Rival Agency');

-- Inserting into auth.users fires handle_new_user, which is exactly what we
-- want to exercise: it creates the profile, the role, the workspace membership
-- and the notification preferences. The third user carries a workspace_id in
-- their metadata, which is how a second agency's owner would sign up.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@consflow.test'),
  ('22222222-2222-2222-2222-222222222222', 'client@acme.test');

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333333', 'rival@rival.test',
   '{"workspace_id": "00000000-0000-0000-0000-000000000002"}'::jsonb);

-- Signup no longer auto-joins the seeded workspace. A missing role compared
-- with `=` is null, and `assert` treats null as success, so these checks
-- must look for a row.
select assert(
  (select count(*) from public.workspace_members
   where user_id = '11111111-1111-1111-1111-111111111111') = 0,
  'a signup with no workspace does not become an admin of the default one'
);
select assert(
  (select count(*) from public.workspace_members
   where user_id = '22222222-2222-2222-2222-222222222222') = 0,
  'a second signup with no workspace does not either'
);
select assert(
  (select role from public.workspace_members
   where user_id = '33333333-3333-3333-3333-333333333333') = 'client',
  'naming a workspace without an invite role joins as a client'
);
select assert(
  (select count(*) from public.notification_preferences) = 0,
  'signup does not invent notification preferences'
);

-- The rest of the suite needs an admin, a client, and prefs. That membership
-- now comes from create_workspace / invite, which this fixture stands in for.
insert into public.workspace_members (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('00000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'client');
insert into public.user_roles (user_id, workspace_id, role) values
  ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000001', 'client');
update public.workspace_members
set role = 'admin'
where user_id = '33333333-3333-3333-3333-333333333333';
update public.user_roles
set role = 'admin'
where user_id = '33333333-3333-3333-3333-333333333333';
insert into public.notification_preferences (user_id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222'),
  ('33333333-3333-3333-3333-333333333333');

-- `is_admin` is workspace-agnostic today, so scope the rival to their own.
delete from public.user_roles
where user_id = '33333333-3333-3333-3333-333333333333'
  and workspace_id = '00000000-0000-0000-0000-000000000001';

insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Acme Corp');
insert into public.projects (id, organization_id, title, created_by) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Acme storefront', '11111111-1111-1111-1111-111111111111');
insert into public.project_members (project_id, user_id, role) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'client');

-- A project belonging to the other workspace.
insert into public.organizations (id, workspace_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Rival client');
insert into public.projects (id, organization_id, title) values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'Rival work');

-- ---------------------------------------------------------------------------
\echo 'workspace boundary'
-- ---------------------------------------------------------------------------
select assert(
  (select workspace_id from public.projects where id = 'bbbbbbbb-0000-0000-0000-000000000002')
    = '00000000-0000-0000-0000-000000000002',
  'child rows inherit their parent workspace'
);

set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

-- The failure mode that matters most: a boundary that hides everything from
-- everyone looks exactly like data loss.
select assert(
  (select count(*) from public.projects where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 1,
  'a pre-existing admin still sees their own project'
);
select assert(
  (select count(*) from public.projects where id = 'bbbbbbbb-0000-0000-0000-000000000002') = 0,
  'another workspace''s project is invisible'
);

set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select assert(
  (select count(*) from public.projects where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 0,
  'the boundary holds in the other direction too'
);

reset role;

-- ---------------------------------------------------------------------------
\echo 'ticket numbering'
-- ---------------------------------------------------------------------------
insert into public.tickets (id, project_id, reporter_id, title, priority)
values ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'Checkout button does nothing', 'urgent'),
       ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222', 'Add CSV export', 'low');

select assert(
  (select array_agg(ticket_number order by ticket_number) from public.tickets)
    = array[1, 2],
  'tickets are numbered sequentially from one'
);
select assert(
  (select ticket_seq from public.workspaces
   where id = '00000000-0000-0000-0000-000000000001') = 2,
  'the workspace counter tracks the highest number issued'
);

-- ---------------------------------------------------------------------------
\echo 'sla'
-- ---------------------------------------------------------------------------
select assert(
  (select sla_due_at - created_at from public.tickets
   where id = 'cccccccc-0000-0000-0000-000000000001') = interval '480 minutes',
  'an urgent ticket is due in eight hours'
);

update public.tickets set priority = 'low' where id = 'cccccccc-0000-0000-0000-000000000001';
select assert(
  (select sla_due_at - created_at from public.tickets
   where id = 'cccccccc-0000-0000-0000-000000000001') = interval '43200 minutes',
  'changing priority recomputes the due date'
);

-- ---------------------------------------------------------------------------
\echo 'audit trail'
-- ---------------------------------------------------------------------------
select assert(
  (select count(*) from public.ticket_events
   where ticket_id = 'cccccccc-0000-0000-0000-000000000001' and kind = 'created') = 1,
  'creating a ticket writes a created event'
);
select assert(
  (select count(*) from public.ticket_events
   where ticket_id = 'cccccccc-0000-0000-0000-000000000001' and kind = 'priority_changed') = 1,
  'changing priority writes a priority_changed event'
);

update public.tickets set status = 'in_progress'
where id = 'cccccccc-0000-0000-0000-000000000001';
select assert(
  (select old_value = 'open' and new_value = 'in_progress' from public.ticket_events
   where ticket_id = 'cccccccc-0000-0000-0000-000000000001' and kind = 'status_changed'),
  'a status event records both the old and the new value'
);

-- ---------------------------------------------------------------------------
\echo 'first response'
-- ---------------------------------------------------------------------------
insert into public.ticket_comments (ticket_id, author_id, body, is_internal)
values ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'Looking into it now.', true);
select assert(
  (select first_response_at is null from public.tickets
   where id = 'cccccccc-0000-0000-0000-000000000001'),
  'an internal note is not a response to the client'
);

insert into public.ticket_comments (ticket_id, author_id, body)
values ('cccccccc-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        'Reproduced — fix going out today.');
select assert(
  (select first_response_at is not null from public.tickets
   where id = 'cccccccc-0000-0000-0000-000000000001'),
  'a visible reply from someone other than the reporter is'
);

insert into public.ticket_comments (ticket_id, author_id, body)
values ('cccccccc-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222',
        'Bumping this.');
select assert(
  (select first_response_at is null from public.tickets
   where id = 'cccccccc-0000-0000-0000-000000000002'),
  'the reporter replying to themselves is not a first response'
);

-- ---------------------------------------------------------------------------
\echo 'resolution and reopening'
-- ---------------------------------------------------------------------------
update public.tickets set status = 'done' where id = 'cccccccc-0000-0000-0000-000000000001';
select assert(
  (select resolved_at is not null and reopened_count = 0 from public.tickets
   where id = 'cccccccc-0000-0000-0000-000000000001'),
  'closing a ticket stamps resolved_at'
);

update public.tickets set status = 'open' where id = 'cccccccc-0000-0000-0000-000000000001';
select assert(
  (select resolved_at is null and reopened_count = 1 from public.tickets
   where id = 'cccccccc-0000-0000-0000-000000000001'),
  'reopening clears it and counts the reopen'
);

-- ---------------------------------------------------------------------------
\echo 'activity feed'
-- ---------------------------------------------------------------------------
select assert(
  (select count(*) from public.project_updates
   where project_id = 'bbbbbbbb-0000-0000-0000-000000000001' and kind = 'ticket_opened') = 2,
  'opening a ticket posts it to the project feed'
);
select assert(
  (select count(*) from public.project_updates
   where project_id = 'bbbbbbbb-0000-0000-0000-000000000001' and kind = 'ticket_closed') = 1,
  'and closing it posts once, on the transition'
);

-- Moving between two closed statuses is not a second closure.
update public.tickets set status = 'done' where id = 'cccccccc-0000-0000-0000-000000000002';
update public.tickets set status = 'wont_fix' where id = 'cccccccc-0000-0000-0000-000000000002';
select assert(
  (select count(*) from public.project_updates
   where project_id = 'bbbbbbbb-0000-0000-0000-000000000001' and kind = 'ticket_closed') = 2,
  'moving between two closed statuses does not post a second time'
);

-- A client can reopen their own closed ticket with a visible follow-up comment.
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select public.post_ticket_followup(
  'cccccccc-0000-0000-0000-000000000002', '<p>The fix still needs work.</p>', 'fix'
);
select assert(
  (select status = 'open' and follow_up_kind = 'fix' from public.tickets
   where id = 'cccccccc-0000-0000-0000-000000000002'),
  'follow-up reopens the ticket with a visible reason'
);
select assert(
  (select count(*) from public.ticket_comments
   where ticket_id = 'cccccccc-0000-0000-0000-000000000002'
     and body = '<p>The fix still needs work.</p>') = 1,
  'the follow-up and its comment are written together'
);
update public.tickets set title = 'Add CSV download' where id = 'cccccccc-0000-0000-0000-000000000002';
select assert(
  (select count(*) from public.ticket_events
   where ticket_id = 'cccccccc-0000-0000-0000-000000000002'
     and kind = 'title_changed' and new_value = 'Add CSV download') = 1,
  'a reporter edit appears in the audit timeline'
);
reset role;

-- ---------------------------------------------------------------------------
\echo 'project progress'
-- ---------------------------------------------------------------------------
insert into public.milestones (id, project_id, title, position) values
  ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Design', 0),
  ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Build', 1),
  ('dddddddd-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'Launch', 2);

select assert(
  (select progress from public.projects where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 0,
  'a project with no completed milestones is at 0%'
);

update public.milestones set status = 'done' where id = 'dddddddd-0000-0000-0000-000000000001';
select assert(
  (select progress from public.projects where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 33,
  'one of three milestones done is 33%'
);
select assert(
  (select completed_at is not null from public.milestones
   where id = 'dddddddd-0000-0000-0000-000000000001'),
  'completing a milestone stamps completed_at'
);
select assert(
  (select count(*) from public.project_updates
   where project_id = 'bbbbbbbb-0000-0000-0000-000000000001' and kind = 'milestone_done') = 1,
  'and posts it to the project feed'
);

update public.milestones set status = 'done'
where id in ('dddddddd-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000003');
select assert(
  (select progress from public.projects where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 100,
  'all milestones done is 100%'
);

delete from public.milestones where project_id = 'bbbbbbbb-0000-0000-0000-000000000001';
select assert(
  (select progress from public.projects where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 0,
  'removing every milestone divides by zero safely'
);

-- Untouched milestones must not hide a finished plan.
insert into public.projects (id, organization_id, title, created_by) values
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Plan only', '11111111-1111-1111-1111-111111111111');
insert into public.milestones (project_id, title, position) values
  ('bbbbbbbb-0000-0000-0000-000000000003', 'Later', 0);
insert into public.plans (id, workspace_id, project_id, title) values
  ('eeeeeeee-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000003', 'Delivery');
insert into public.plan_sections (id, plan_id, title) values
  ('eeeeeeee-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', 'Now');
insert into public.plan_tasks (section_id, plan_id, title, status) values
  ('eeeeeeee-0000-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', 'Ship it', 'done');
select assert(
  (select progress from public.projects where id = 'bbbbbbbb-0000-0000-0000-000000000003') = 100,
  'a finished plan counts while every milestone is still pending'
);

-- ---------------------------------------------------------------------------
\echo 'time tracking'
-- ---------------------------------------------------------------------------
insert into public.time_entries (project_id, user_id, started_at, ended_at)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
        now() - interval '90 minutes', now());
select assert(
  (select duration_minutes from public.time_entries
   where user_id = '11111111-1111-1111-1111-111111111111') = 90,
  'a finished entry computes its own duration'
);

insert into public.time_entries (project_id, user_id)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');

do $$
begin
  insert into public.time_entries (project_id, user_id)
  values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111');
  raise exception 'FAILED: a second running timer was allowed';
exception when unique_violation then
  raise notice '  ok  a second running timer is rejected by the database';
end $$;

-- ---------------------------------------------------------------------------
\echo 'billing'
-- ---------------------------------------------------------------------------
insert into public.invoices (id, project_id, amount_cents, status)
values ('eeeeeeee-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        150000, 'sent');

select assert(
  (select number from public.invoices where id = 'eeeeeeee-0000-0000-0000-000000000001')
    = 'INV-0001',
  'invoices are numbered per workspace from the workspace prefix'
);

insert into public.payments (invoice_id, amount_cents, provider)
values ('eeeeeeee-0000-0000-0000-000000000001', 50000, 'manual');
select assert(
  (select status from public.invoices where id = 'eeeeeeee-0000-0000-0000-000000000001')
    = 'sent',
  'a part payment does not settle the invoice'
);

insert into public.payments (invoice_id, amount_cents, provider)
values ('eeeeeeee-0000-0000-0000-000000000001', 100000, 'manual');
select assert(
  (select status = 'paid' and paid_at is not null from public.invoices
   where id = 'eeeeeeee-0000-0000-0000-000000000001'),
  'payments covering the total settle it'
);
select assert(
  (select count(*) from public.project_updates
   where project_id = 'bbbbbbbb-0000-0000-0000-000000000001' and kind = 'invoice_paid') = 1,
  'and the client sees it in the feed'
);

delete from public.payments where invoice_id = 'eeeeeeee-0000-0000-0000-000000000001'
  and amount_cents = 100000;
select assert(
  (select status from public.invoices where id = 'eeeeeeee-0000-0000-0000-000000000001')
    = 'sent',
  'reversing a payment un-settles it'
);

-- ---------------------------------------------------------------------------
\echo 'search'
-- ---------------------------------------------------------------------------
select assert(
  (select count(*) from public.tickets
   where search_tsv @@ websearch_to_tsquery('english', 'checkout')) = 1,
  'the title is searchable'
);
select assert(
  (select count(*) from public.tickets
   where search_tsv @@ websearch_to_tsquery('english', 'nonexistent')) = 0,
  'and does not match everything'
);

-- ---------------------------------------------------------------------------
\echo 'storage reads'
-- ---------------------------------------------------------------------------
-- The original policy let any signed-in user read any object in these buckets.
-- These lock the fix: your own project's files, and nobody else's.
insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
on conflict (id) do nothing;

insert into storage.objects (bucket_id, name, owner) values
  ('attachments', '22222222-2222-2222-2222-222222222222/cccccccc-0000-0000-0000-000000000001/shot.png',
   '22222222-2222-2222-2222-222222222222'),
  ('recordings', '33333333-3333-3333-3333-333333333333/rival-ticket/private.webm',
   '33333333-3333-3333-3333-333333333333');

insert into public.ticket_attachments
  (ticket_id, uploader_id, storage_bucket, storage_path, file_name, mime_type)
values ('cccccccc-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
        'attachments', '22222222-2222-2222-2222-222222222222/cccccccc-0000-0000-0000-000000000001/shot.png',
        'shot.png', 'image/png');

grant select on storage.objects to authenticated;

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

select assert(
  (select count(*) from storage.objects
   where name like '22222222%shot.png') = 1,
  'you can read a file you uploaded'
);
select assert(
  (select count(*) from storage.objects where bucket_id = 'recordings') = 0,
  'another workspace''s recording is not readable'
);

-- The admin is on the project, so the attachment row makes it visible even
-- though they did not upload it.
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select assert(
  (select count(*) from storage.objects where name like '22222222%shot.png') = 1,
  'a project member can read that project''s files'
);
select assert(
  (select count(*) from storage.objects where bucket_id = 'recordings') = 0,
  'and still cannot read files from a project they are not on'
);

reset role;

-- ---------------------------------------------------------------------------
\echo 'plan steps and attachments'
-- ---------------------------------------------------------------------------
insert into public.plan_tasks (id, section_id, plan_id, title) values
  ('eeeeeeee-0000-0000-0000-000000000010', 'eeeeeeee-0000-0000-0000-000000000002',
   'eeeeeeee-0000-0000-0000-000000000001', 'Checklist task');

-- plan_id is derived from the task, so a client cannot file a step under a
-- plan it does not belong to.
insert into public.plan_task_steps (task_id, plan_id, text, position) values
  ('eeeeeeee-0000-0000-0000-000000000010', 'eeeeeeee-0000-0000-0000-000000000099', 'Write it', 1);
select assert(
  (select plan_id from public.plan_task_steps where text = 'Write it')
    = 'eeeeeeee-0000-0000-0000-000000000001',
  'a step takes its plan from its task'
);

select assert(
  (select count(*) from pg_constraint
   where conrelid = 'public.plan_task_steps'::regclass and contype = 'c') >= 2,
  'step depth and text length are constrained'
);

insert into public.plan_task_attachments
  (id, task_id, uploader_id, storage_path, file_name, mime_type, size_bytes)
values ('eeeeeeee-0000-0000-0000-000000000020', 'eeeeeeee-0000-0000-0000-000000000010',
        '11111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-000000000001/a-shot.png',
        'shot.png', 'image/png', 1024);
select assert(
  (select shared_with_agents from public.plan_task_attachments
   where id = 'eeeeeeee-0000-0000-0000-000000000020'),
  'attachments are shared with agents unless someone hides them'
);

insert into public.plan_task_attachments
  (task_id, uploader_id, storage_path, file_name, mime_type, size_bytes, source_attachment_id)
values ('eeeeeeee-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-000000000001/b-marked.png',
        'shot-marked.png', 'image/png', 2048, 'eeeeeeee-0000-0000-0000-000000000020');
select assert(
  (select count(*) from public.plan_task_attachments
   where source_attachment_id = 'eeeeeeee-0000-0000-0000-000000000020') = 1,
  'a marked-up copy points at its original'
);

do $$
begin
  begin
    insert into public.plan_task_attachments
      (task_id, uploader_id, storage_path, file_name, size_bytes)
    values ('eeeeeeee-0000-0000-0000-000000000010', '11111111-1111-1111-1111-111111111111',
            'x/too-big.bin', 'too-big.bin', 26214401);
    raise exception 'FAILED: an oversized file was accepted';
  exception when check_violation then
    raise notice '  ok  files over 25 MB are refused by the database too';
  end;
end $$;

insert into public.plan_tasks (id, section_id, plan_id, title) values
  ('eeeeeeee-0000-0000-0000-000000000011', 'eeeeeeee-0000-0000-0000-000000000002',
   'eeeeeeee-0000-0000-0000-000000000001', 'Another task');
do $$
begin
  begin
    insert into public.plan_task_attachments
      (task_id, uploader_id, storage_path, file_name, size_bytes, source_attachment_id)
    values ('eeeeeeee-0000-0000-0000-000000000011', '11111111-1111-1111-1111-111111111111',
            'x/wrong-task.png', 'wrong-task.png', 10, 'eeeeeeee-0000-0000-0000-000000000020');
    raise exception 'FAILED: a marked-up copy was filed under a different task';
  exception when raise_exception then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok  a marked-up copy must stay on its original''s task';
  end;
end $$;

-- Who can see and change them.
set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select assert(
  (select count(*) from public.plan_task_attachments) = 2,
  'a workspace member reads the plan''s attachments'
);
select assert(
  (select count(*) from public.plan_task_steps) = 1,
  'and its steps'
);
update public.plan_task_attachments set shared_with_agents = false
where id = 'eeeeeeee-0000-0000-0000-000000000020';
select assert(
  (select shared_with_agents from public.plan_task_attachments
   where id = 'eeeeeeee-0000-0000-0000-000000000020'),
  'but cannot hide or delete a file somebody else uploaded'
);

set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select assert(
  (select count(*) from public.plan_task_attachments) = 0
    and (select count(*) from public.plan_task_steps) = 0,
  'another workspace sees none of it'
);

set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
update public.plan_task_attachments set shared_with_agents = false
where id = 'eeeeeeee-0000-0000-0000-000000000020';
select assert(
  not (select shared_with_agents from public.plan_task_attachments
       where id = 'eeeeeeee-0000-0000-0000-000000000020'),
  'the uploader can toggle sharing'
);
insert into public.plan_events (plan_id, task_id, actor_id, kind) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000010',
   '11111111-1111-1111-1111-111111111111', 'attachment_added');
select assert(
  (select count(*) from public.plan_events where kind = 'attachment_added') = 1,
  'a member can record an activity event about their own action'
);
reset role;

-- ---------------------------------------------------------------------------
\echo 'files on the plan itself'
-- ---------------------------------------------------------------------------
-- No task: the file names its plan, and nothing derives it.
insert into public.plan_task_attachments
  (id, plan_id, uploader_id, storage_path, file_name, mime_type, size_bytes)
values ('eeeeeeee-0000-0000-0000-000000000040', 'eeeeeeee-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111',
        '11111111-1111-1111-1111-111111111111/eeeeeeee-0000-0000-0000-000000000001/plan/a-brief.pdf',
        'brief.pdf', 'application/pdf', 2048);
select assert(
  (select task_id is null and shared_with_agents from public.plan_task_attachments
   where id = 'eeeeeeee-0000-0000-0000-000000000040'),
  'a file can belong to the plan itself, shared with agents like any other'
);

do $$
begin
  begin
    insert into public.plan_task_attachments
      (plan_id, uploader_id, storage_path, file_name, size_bytes)
    values ('eeeeeeee-0000-0000-0000-000000000099', '11111111-1111-1111-1111-111111111111',
            'x/no-such-plan.pdf', 'no-such-plan.pdf', 10);
    raise exception 'FAILED: a file was filed under a plan that does not exist';
  exception when raise_exception then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok  a plan-level file must name a real plan';
  end;
end $$;

do $$
begin
  begin
    insert into public.plan_task_attachments
      (plan_id, uploader_id, storage_path, file_name, size_bytes, source_attachment_id)
    values ('eeeeeeee-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
            'x/lifted.png', 'lifted.png', 10, 'eeeeeeee-0000-0000-0000-000000000020');
    raise exception 'FAILED: a task file''s marked-up copy was filed on the plan';
  exception when raise_exception then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok  a marked-up copy stays at the level of its original';
  end;
end $$;

set local role authenticated;
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select assert(
  (select count(*) from public.plan_task_attachments where task_id is null) = 1,
  'a workspace member reads the plan''s own files'
);
insert into public.plan_task_attachments
  (id, plan_id, uploader_id, storage_path, file_name, mime_type, size_bytes)
values ('eeeeeeee-0000-0000-0000-000000000041', 'eeeeeeee-0000-0000-0000-000000000001',
        '22222222-2222-2222-2222-222222222222',
        '22222222-2222-2222-2222-222222222222/eeeeeeee-0000-0000-0000-000000000001/plan/b-spec.pdf',
        'spec.pdf', 'application/pdf', 4096);
select assert(
  (select count(*) from public.plan_task_attachments where task_id is null) = 2,
  'and any member can add one'
);
delete from public.plan_task_attachments where id = 'eeeeeeee-0000-0000-0000-000000000040';
select assert(
  (select count(*) from public.plan_task_attachments
   where id = 'eeeeeeee-0000-0000-0000-000000000040') = 1,
  'but cannot delete a plan file somebody else uploaded'
);

set local request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
select assert(
  (select count(*) from public.plan_task_attachments where task_id is null) = 0,
  'another workspace sees none of the plan''s files'
);
do $$
begin
  begin
    insert into public.plan_task_attachments
      (plan_id, uploader_id, storage_path, file_name, size_bytes)
    values ('eeeeeeee-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333',
            '33333333-3333-3333-3333-333333333333/eeeeeeee-0000-0000-0000-000000000001/plan/c.pdf',
            'c.pdf', 10);
    raise exception 'FAILED: another workspace added a file to this plan';
  exception when insufficient_privilege or raise_exception then
    -- The trigger reads the plan as the caller, and the caller cannot see it; RLS would refuse next.
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok  nor can it add one';
  end;
end $$;
reset role;

-- ---------------------------------------------------------------------------
\echo 'questions, features and tags'
-- ---------------------------------------------------------------------------
update public.plan_tasks set status = 'in_progress'
where id = 'eeeeeeee-0000-0000-0000-000000000011';

insert into public.plan_task_questions (id, task_id, body, blocking, asked_by_user_id)
values ('eeeeeeee-0000-0000-0000-000000000030', 'eeeeeeee-0000-0000-0000-000000000011',
        'Which payment provider?', true, '11111111-1111-1111-1111-111111111111');
select assert(
  (select plan_id from public.plan_task_questions
   where id = 'eeeeeeee-0000-0000-0000-000000000030') = 'eeeeeeee-0000-0000-0000-000000000001',
  'a question takes its plan from its task'
);
select assert(
  (select status from public.plan_tasks where id = 'eeeeeeee-0000-0000-0000-000000000011') = 'blocked'
  and (select blocked_from from public.plan_tasks
       where id = 'eeeeeeee-0000-0000-0000-000000000011') = 'in_progress',
  'an open blocking question blocks the task and remembers where it was'
);

insert into public.plan_task_questions (id, task_id, body, blocking, asked_by_user_id)
values ('eeeeeeee-0000-0000-0000-000000000031', 'eeeeeeee-0000-0000-0000-000000000010',
        'Is a dark mode wanted?', false, '11111111-1111-1111-1111-111111111111');
select assert(
  (select status from public.plan_tasks where id = 'eeeeeeee-0000-0000-0000-000000000010') <> 'blocked',
  'a question that does not block leaves the task alone'
);

update public.plan_task_questions
set status = 'answered', answer = 'Stripe', answered_at = now()
where id = 'eeeeeeee-0000-0000-0000-000000000030';
select assert(
  (select status from public.plan_tasks where id = 'eeeeeeee-0000-0000-0000-000000000011') = 'in_progress'
  and (select blocked_from from public.plan_tasks
       where id = 'eeeeeeee-0000-0000-0000-000000000011') is null,
  'answering the last blocking question puts the task back'
);

-- Two blocking questions: the task stays blocked until both are settled.
insert into public.plan_task_questions (id, task_id, body, blocking, asked_by_user_id) values
  ('eeeeeeee-0000-0000-0000-000000000032', 'eeeeeeee-0000-0000-0000-000000000011', 'One?', true,
   '11111111-1111-1111-1111-111111111111'),
  ('eeeeeeee-0000-0000-0000-000000000033', 'eeeeeeee-0000-0000-0000-000000000011', 'Two?', true,
   '11111111-1111-1111-1111-111111111111');
update public.plan_task_questions set status = 'dismissed'
where id = 'eeeeeeee-0000-0000-0000-000000000032';
select assert(
  (select status from public.plan_tasks where id = 'eeeeeeee-0000-0000-0000-000000000011') = 'blocked',
  'one open blocking question is enough to keep the task blocked'
);
update public.plan_task_questions set status = 'answered', answer = 'ok'
where id = 'eeeeeeee-0000-0000-0000-000000000033';
select assert(
  (select status from public.plan_tasks where id = 'eeeeeeee-0000-0000-0000-000000000011') = 'in_progress',
  'and it is released once none are open'
);

-- A task someone blocked by hand is not released by an unrelated answer.
update public.plan_tasks set status = 'blocked' where id = 'eeeeeeee-0000-0000-0000-000000000010';
update public.plan_task_questions set status = 'answered', answer = 'no'
where id = 'eeeeeeee-0000-0000-0000-000000000031';
select assert(
  (select status from public.plan_tasks where id = 'eeeeeeee-0000-0000-0000-000000000010') = 'blocked',
  'a hand-blocked task stays blocked when an unrelated question is answered'
);

insert into public.plan_task_features (task_id, plan_id, text, position)
values ('eeeeeeee-0000-0000-0000-000000000010', 'eeeeeeee-0000-0000-0000-000000000099',
        'Must be able to block questions', 1);
select assert(
  (select plan_id from public.plan_task_features where text like 'Must be able%')
    = 'eeeeeeee-0000-0000-0000-000000000001',
  'a feature takes its plan from its task'
);

do $$
begin
  begin
    update public.plan_tasks set color = 'red; drop table x'
    where id = 'eeeeeeee-0000-0000-0000-000000000010';
    raise exception 'FAILED: an arbitrary colour string was accepted';
  exception when check_violation then
    raise notice '  ok  a colour must be a token or a hex value';
  end;
end $$;

-- ---------------------------------------------------------------------------
\echo 'realtime'
-- ---------------------------------------------------------------------------
select assert(
  (select count(*) from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('tickets', 'ticket_comments', 'ticket_events',
                       'notifications', 'project_updates')) = 5
  and (select count(*) from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public'
         and tablename in ('plan_events', 'plan_tasks', 'plan_task_steps',
                           'plan_task_attachments', 'plan_task_comments')) = 5,
  'every table the app subscribes to is published'
);

rollback;

\echo ''
\echo 'All schema assertions passed.'
