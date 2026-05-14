
-- ENUMS
create type public.app_role as enum ('admin', 'client_admin', 'client');
create type public.project_status as enum ('discovery', 'proposal', 'in_progress', 'review', 'done', 'archived');
create type public.ticket_type as enum ('bug', 'feature', 'question', 'feedback', 'change_request');
create type public.ticket_priority as enum ('low', 'medium', 'high', 'urgent');
create type public.ticket_status as enum ('open', 'triaged', 'in_progress', 'in_review', 'done', 'wont_fix');
create type public.milestone_status as enum ('pending', 'in_progress', 'done');
create type public.meeting_status as enum ('scheduled', 'completed', 'cancelled');
create type public.action_item_status as enum ('open', 'converted', 'done', 'dismissed');
create type public.update_kind as enum ('post', 'ticket_opened', 'ticket_closed', 'milestone_done', 'meeting_held', 'invoice_paid');
create type public.notification_kind as enum ('mention', 'ticket_update', 'comment', 'milestone', 'invoice', 'meeting');
create type public.quote_status as enum ('draft', 'sent', 'accepted', 'declined', 'expired');
create type public.invoice_status as enum ('draft', 'sent', 'paid', 'overdue', 'void');

-- TABLES (no policies yet)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text, avatar_url text, company text, email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null, website text, logo_url text, notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  title text not null, description text,
  status project_status not null default 'discovery',
  start_date date, end_date date,
  budget_cents bigint, hourly_rate_cents bigint,
  currency text not null default 'USD',
  progress int not null default 0 check (progress between 0 and 100),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'client',
  created_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  reporter_id uuid references auth.users(id),
  assignee_id uuid references auth.users(id),
  title text not null, description text,
  type ticket_type not null default 'bug',
  priority ticket_priority not null default 'medium',
  status ticket_status not null default 'open',
  due_date date, estimate_hours numeric, eta_date date,
  ai_summary text,
  ai_suggested_type ticket_type,
  ai_suggested_priority ticket_priority,
  ai_screenshot_analysis text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  author_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.ticket_attachments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  uploader_id uuid not null references auth.users(id) on delete cascade,
  storage_bucket text not null, storage_path text not null,
  file_name text not null, mime_type text, size_bytes bigint,
  is_recording boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  actor_id uuid references auth.users(id),
  kind text not null, data jsonb,
  created_at timestamptz not null default now()
);

create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null, description text,
  status milestone_status not null default 'pending',
  due_date date, amount_cents bigint, position int not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  scheduled_at timestamptz not null,
  duration_minutes int default 30,
  agenda text, notes text, ai_summary text,
  status meeting_status not null default 'scheduled',
  meeting_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.meeting_action_items (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  title text not null, description text,
  status action_item_status not null default 'open',
  ticket_id uuid references public.tickets(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.project_updates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  author_id uuid references auth.users(id),
  kind update_kind not null default 'post',
  title text, body text, data jsonb,
  created_at timestamptz not null default now()
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind notification_kind not null,
  title text not null, body text, link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  status quote_status not null default 'draft',
  subtotal_cents bigint not null default 0,
  total_cents bigint not null default 0,
  currency text not null default 'USD',
  notes text, sent_at timestamptz, responded_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.quote_line_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete cascade,
  description text not null,
  quantity numeric not null default 1,
  unit_price_cents bigint not null default 0,
  position int not null default 0
);

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  milestone_id uuid references public.milestones(id) on delete set null,
  number text,
  status invoice_status not null default 'draft',
  amount_cents bigint not null default 0,
  currency text not null default 'USD',
  due_date date, paid_at timestamptz,
  stripe_payment_intent text,
  created_at timestamptz not null default now()
);

create table public.ai_summaries (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null, subject_id uuid not null,
  summary text not null, source_hash text,
  created_at timestamptz not null default now(),
  unique (subject_type, subject_id)
);

-- ENABLE RLS
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.organizations enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_comments enable row level security;
alter table public.ticket_attachments enable row level security;
alter table public.ticket_events enable row level security;
alter table public.milestones enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_action_items enable row level security;
alter table public.project_updates enable row level security;
alter table public.notifications enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_line_items enable row level security;
alter table public.invoices enable row level security;
alter table public.ai_summaries enable row level security;

-- HELPER FUNCTIONS (security definer)
create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = _role) $$;

create or replace function public.is_admin(_user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.user_roles where user_id = _user_id and role = 'admin') $$;

create or replace function public.is_project_member(_project_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public
as $$
  select exists(select 1 from public.project_members where project_id = _project_id and user_id = _user_id)
    or public.is_admin(_user_id);
$$;

-- POLICIES
-- profiles
create policy "profiles_select_all" on public.profiles for select to authenticated using (true);
create policy "profiles_update_own" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (auth.uid() = id);

-- user_roles
create policy "roles_select_own_or_admin" on public.user_roles for select to authenticated
  using (auth.uid() = user_id or public.is_admin(auth.uid()));
create policy "roles_admin_all" on public.user_roles for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- organizations
create policy "orgs_admin_all" on public.organizations for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "orgs_member_select" on public.organizations for select to authenticated
  using (exists (select 1 from public.projects p
                 join public.project_members pm on pm.project_id = p.id
                 where p.organization_id = organizations.id and pm.user_id = auth.uid()));

-- projects
create policy "projects_admin_all" on public.projects for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "projects_member_select" on public.projects for select to authenticated
  using (exists (select 1 from public.project_members where project_id = projects.id and user_id = auth.uid()));

-- project_members
create policy "members_admin_all" on public.project_members for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "members_select_own" on public.project_members for select to authenticated
  using (user_id = auth.uid());

-- tickets
create policy "tickets_admin_all" on public.tickets for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "tickets_member_select" on public.tickets for select to authenticated
  using (public.is_project_member(project_id, auth.uid()));
create policy "tickets_member_insert" on public.tickets for insert to authenticated
  with check (public.is_project_member(project_id, auth.uid()) and reporter_id = auth.uid());
create policy "tickets_member_update_own" on public.tickets for update to authenticated
  using (public.is_project_member(project_id, auth.uid()) and reporter_id = auth.uid())
  with check (public.is_project_member(project_id, auth.uid()));

-- ticket_comments
create policy "comments_admin_all" on public.ticket_comments for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "comments_member_select" on public.ticket_comments for select to authenticated
  using (not is_internal and exists (
    select 1 from public.tickets t where t.id = ticket_comments.ticket_id
    and public.is_project_member(t.project_id, auth.uid())));
create policy "comments_member_insert" on public.ticket_comments for insert to authenticated
  with check (author_id = auth.uid() and is_internal = false and exists (
    select 1 from public.tickets t where t.id = ticket_comments.ticket_id
    and public.is_project_member(t.project_id, auth.uid())));

-- ticket_attachments
create policy "attach_admin_all" on public.ticket_attachments for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "attach_member_select" on public.ticket_attachments for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_attachments.ticket_id
                 and public.is_project_member(t.project_id, auth.uid())));
create policy "attach_member_insert" on public.ticket_attachments for insert to authenticated
  with check (uploader_id = auth.uid() and exists (
    select 1 from public.tickets t where t.id = ticket_attachments.ticket_id
    and public.is_project_member(t.project_id, auth.uid())));

-- ticket_events
create policy "events_admin_all" on public.ticket_events for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "events_member_select" on public.ticket_events for select to authenticated
  using (exists (select 1 from public.tickets t where t.id = ticket_events.ticket_id
                 and public.is_project_member(t.project_id, auth.uid())));

-- milestones
create policy "milestones_admin_all" on public.milestones for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "milestones_member_select" on public.milestones for select to authenticated
  using (public.is_project_member(project_id, auth.uid()));

-- meetings
create policy "meetings_admin_all" on public.meetings for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "meetings_member_select" on public.meetings for select to authenticated
  using (public.is_project_member(project_id, auth.uid()));

-- meeting_action_items
create policy "ai_admin_all" on public.meeting_action_items for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "ai_member_select" on public.meeting_action_items for select to authenticated
  using (exists (select 1 from public.meetings m where m.id = meeting_action_items.meeting_id
                 and public.is_project_member(m.project_id, auth.uid())));

-- project_updates
create policy "updates_admin_all" on public.project_updates for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "updates_member_select" on public.project_updates for select to authenticated
  using (public.is_project_member(project_id, auth.uid()));

-- notifications
create policy "notif_select_own" on public.notifications for select to authenticated using (user_id = auth.uid());
create policy "notif_update_own" on public.notifications for update to authenticated using (user_id = auth.uid());
create policy "notif_insert" on public.notifications for insert to authenticated
  with check (public.is_admin(auth.uid()) or user_id = auth.uid());

-- quotes
create policy "quotes_admin_all" on public.quotes for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "quotes_member_select" on public.quotes for select to authenticated
  using (status <> 'draft' and public.is_project_member(project_id, auth.uid()));
create policy "quotes_member_update" on public.quotes for update to authenticated
  using (status = 'sent' and public.is_project_member(project_id, auth.uid()));

-- quote_line_items
create policy "qli_admin_all" on public.quote_line_items for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "qli_member_select" on public.quote_line_items for select to authenticated
  using (exists (select 1 from public.quotes q where q.id = quote_line_items.quote_id
                 and q.status <> 'draft' and public.is_project_member(q.project_id, auth.uid())));

-- invoices
create policy "inv_admin_all" on public.invoices for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "inv_member_select" on public.invoices for select to authenticated
  using (status <> 'draft' and public.is_project_member(project_id, auth.uid()));

-- ai_summaries
create policy "ais_select_all" on public.ai_summaries for select to authenticated using (true);
create policy "ais_admin_all" on public.ai_summaries for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

-- TRIGGERS
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;

create trigger touch_profiles before update on public.profiles for each row execute function public.touch_updated_at();
create trigger touch_orgs before update on public.organizations for each row execute function public.touch_updated_at();
create trigger touch_projects before update on public.projects for each row execute function public.touch_updated_at();
create trigger touch_tickets before update on public.tickets for each row execute function public.touch_updated_at();
create trigger touch_meetings before update on public.meetings for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email, new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (new.id, 'client') on conflict do nothing;
  return new;
end; $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- STORAGE BUCKETS
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false), ('recordings', 'recordings', false)
on conflict (id) do nothing;

create policy "storage_upload_own" on storage.objects for insert to authenticated
  with check (bucket_id in ('attachments','recordings') and (storage.foldername(name))[1] = auth.uid()::text);
create policy "storage_read_auth" on storage.objects for select to authenticated
  using (bucket_id in ('attachments','recordings'));
create policy "storage_update_own" on storage.objects for update to authenticated
  using (bucket_id in ('attachments','recordings') and owner = auth.uid());
create policy "storage_delete_admin" on storage.objects for delete to authenticated
  using (bucket_id in ('attachments','recordings') and public.is_admin(auth.uid()));

-- INDEXES
create index idx_tickets_project on public.tickets(project_id);
create index idx_tickets_status on public.tickets(status);
create index idx_comments_ticket on public.ticket_comments(ticket_id);
create index idx_attachments_ticket on public.ticket_attachments(ticket_id);
create index idx_milestones_project on public.milestones(project_id);
create index idx_updates_project on public.project_updates(project_id, created_at desc);
create index idx_notifications_user on public.notifications(user_id, read_at);
