-- Assertions for 20260930300000_organization_members.sql.
--   psql ... -f supabase/tests/organization_members_assertions.sql
-- Runs in a transaction that is rolled back, against a database already built
-- by supabase/tests/run-local.sh (SKIP_ASSERTIONS=1 is fine).

\set ON_ERROR_STOP on
\pset tuples_only on
\pset format unaligned
set client_min_messages to notice;

begin;

create or replace function assert(_condition boolean, _what text)
returns void language plpgsql as $$
begin
  if _condition is not true then raise exception 'FAILED: %', _what; end if;
  raise notice '  ok  %', _what;
end $$;

insert into public.workspaces (id, slug, name)
values ('00000000-0000-0000-0000-000000000002', 'rival', 'Rival Agency');
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@a.test'),
  ('22222222-2222-2222-2222-222222222222', 'lead@acme.test'),
  ('33333333-3333-3333-3333-333333333333', 'other@acme.test'),
  ('44444444-4444-4444-4444-444444444444', 'rival@rival.test');
insert into public.workspace_members (workspace_id, user_id, role) values
  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'admin'),
  ('00000000-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'client_admin'),
  ('00000000-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'client'),
  ('00000000-0000-0000-0000-000000000002', '44444444-4444-4444-4444-444444444444', 'admin');
insert into public.organizations (id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Acme'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Acme Two');
insert into public.organizations (id, workspace_id, name) values
  ('aaaaaaaa-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'Rival client');

-- The workspace follows the company, whatever the caller passes.
insert into public.organization_members (organization_id, user_id, workspace_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222',
   '00000000-0000-0000-0000-000000000002');
select assert(
  (select workspace_id from public.organization_members
   where user_id = '22222222-2222-2222-2222-222222222222')
    = '00000000-0000-0000-0000-000000000001',
  'a member row takes its workspace from the company'
);
insert into public.organization_members (organization_id, user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333');

-- An admin sees and edits their workspace's rows only.
set local role authenticated;
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select assert((select count(*) from public.organization_members) = 2, 'admin sees their workspace members');

-- A client sees only their own company's people.
set local request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select assert(
  (select count(*) from public.organization_members) = 1
    and (select organization_id from public.organization_members)
      = 'aaaaaaaa-0000-0000-0000-000000000001',
  'a client sees only their own company'
);

-- ...and cannot edit anything.
do $$
begin
  begin
    insert into public.organization_members (organization_id, user_id) values
      ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333');
    raise exception 'FAILED: a client inserted a company member';
  exception when insufficient_privilege or others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice '  ok  a client cannot add company members';
  end;
end $$;

-- Another workspace sees none of it.
set local request.jwt.claim.sub = '44444444-4444-4444-4444-444444444444';
select assert((select count(*) from public.organization_members) = 0, 'the boundary hides other workspaces');

-- Merging keeps the people of the company that goes away.
set local request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select public.merge_organizations('aaaaaaaa-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001');
select assert(
  (select count(*) from public.organization_members
   where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 2,
  'merge moves the people across'
);

rollback;
