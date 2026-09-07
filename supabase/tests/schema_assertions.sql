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

select assert(
  (select role from public.workspace_members
   where user_id = '11111111-1111-1111-1111-111111111111') = 'admin',
  'the first person in a workspace becomes its admin'
);
select assert(
  (select role from public.workspace_members
   where user_id = '22222222-2222-2222-2222-222222222222') = 'client',
  'the second person does not'
);
select assert(
  (select role from public.workspace_members
   where user_id = '33333333-3333-3333-3333-333333333333') = 'admin',
  'but the first person in a different workspace does'
);
select assert(
  (select count(*) from public.notification_preferences) = 3,
  'everyone gets notification preferences on signup'
);

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
\echo 'realtime'
-- ---------------------------------------------------------------------------
select assert(
  (select count(*) from pg_publication_tables
   where pubname = 'supabase_realtime' and schemaname = 'public'
     and tablename in ('tickets', 'ticket_comments', 'ticket_events',
                       'notifications', 'project_updates')) = 5,
  'every table the app subscribes to is published'
);

rollback;

\echo ''
\echo 'All schema assertions passed.'
