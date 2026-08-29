create type public.outbound_status as enum ('queued', 'sent', 'skipped', 'failed');

create table public.outbound_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.workspaces(id) on delete cascade,
  channel text not null default 'email',
  template text not null,
  to_address text not null,
  to_user_id uuid references auth.users(id) on delete set null,
  subject text,
  body_text text,
  body_html text,
  status outbound_status not null default 'queued',
  provider text,
  provider_message_id text,
  error text,
  related_type text,
  related_id uuid,
  scheduled_for timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

grant select on public.outbound_messages to authenticated;
grant all on public.outbound_messages to service_role;
alter table public.outbound_messages enable row level security;
create index idx_outbound_created on public.outbound_messages(workspace_id, created_at desc);
create index idx_outbound_status on public.outbound_messages(status, scheduled_for)
  where status = 'queued';

create policy "ws_boundary" on public.outbound_messages as restrictive to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())))
  with check (workspace_id in (select public.user_workspace_ids(auth.uid())));
create policy "outbound_admin_select" on public.outbound_messages for select to authenticated
  using (public.is_admin(auth.uid()));
create policy "outbound_own_select" on public.outbound_messages for select to authenticated
  using (to_user_id = auth.uid());

create table public.app_errors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  fingerprint text not null,
  message text not null,
  stack text,
  severity text not null default 'error' check (severity in ('warning', 'error', 'fatal')),
  side text not null default 'server' check (side in ('client', 'server')),
  url text,
  release text,
  context jsonb,
  occurred_at timestamptz not null default now()
);

grant select on public.app_errors to authenticated;
grant all on public.app_errors to service_role;
alter table public.app_errors enable row level security;
create index idx_app_errors_fingerprint on public.app_errors(fingerprint, occurred_at desc);
create index idx_app_errors_recent on public.app_errors(occurred_at desc);

create policy "errors_admin_select" on public.app_errors for select to authenticated
  using (public.is_admin(auth.uid()));

create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.workspaces(id) on delete cascade,
  channels jsonb not null default jsonb_build_object(
    'mention',       jsonb_build_object('in_app', true, 'email', true),
    'comment',       jsonb_build_object('in_app', true, 'email', true),
    'ticket_update', jsonb_build_object('in_app', true, 'email', false),
    'milestone',     jsonb_build_object('in_app', true, 'email', true),
    'invoice',       jsonb_build_object('in_app', true, 'email', true),
    'meeting',       jsonb_build_object('in_app', true, 'email', true)
  ),
  digest_frequency text not null default 'daily'
    check (digest_frequency in ('off', 'daily', 'weekly')),
  quiet_hours_start int check (quiet_hours_start between 0 and 23),
  quiet_hours_end int check (quiet_hours_end between 0 and 23),
  timezone text not null default 'UTC',
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;
alter table public.notification_preferences enable row level security;
create policy "ws_boundary" on public.notification_preferences as restrictive to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())))
  with check (workspace_id in (select public.user_workspace_ids(auth.uid())));
create policy "prefs_own_all" on public.notification_preferences for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create trigger touch_notification_preferences before update on public.notification_preferences
  for each row execute function public.touch_updated_at();

insert into public.notification_preferences (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  ws uuid := coalesce(
    nullif(new.raw_user_meta_data->>'workspace_id', '')::uuid,
    '00000000-0000-0000-0000-000000000001'
  );
  is_first boolean;
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.email,
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  select not exists (
    select 1 from public.workspace_members
    where workspace_id = ws and role = 'admin'
  ) into is_first;

  insert into public.user_roles (user_id, workspace_id, role)
  values (new.id, ws, (case when is_first then 'admin' else 'client' end)::app_role)
  on conflict do nothing;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws, new.id, (case when is_first then 'admin' else 'client' end)::app_role)
  on conflict (workspace_id, user_id) do nothing;

  insert into public.notification_preferences (user_id, workspace_id)
  values (new.id, ws)
  on conflict (user_id) do nothing;

  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create table public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.workspaces(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  description text not null,
  quantity numeric not null default 1,
  unit_price_cents bigint not null default 0,
  position int not null default 0
);
grant select, insert, update, delete on public.invoice_line_items to authenticated;
grant all on public.invoice_line_items to service_role;
alter table public.invoice_line_items enable row level security;
create index idx_invoice_lines_invoice on public.invoice_line_items(invoice_id, position);
create policy "ws_boundary" on public.invoice_line_items as restrictive to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())))
  with check (workspace_id in (select public.user_workspace_ids(auth.uid())));
create policy "ili_admin_all" on public.invoice_line_items for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "ili_member_select" on public.invoice_line_items for select to authenticated
  using (exists (select 1 from public.invoices i
                 where i.id = invoice_line_items.invoice_id
                   and i.status <> 'draft'
                   and public.is_project_member(i.project_id, auth.uid())));
create trigger ws_inherit before insert on public.invoice_line_items
  for each row execute function public.inherit_workspace('invoices', 'invoice_id');

alter table public.invoices
  add column quote_id uuid references public.quotes(id) on delete set null,
  add column subtotal_cents bigint not null default 0,
  add column tax_bps int not null default 0,
  add column issued_at timestamptz,
  add column notes text,
  add column payment_link text;

update public.invoices set subtotal_cents = amount_cents where subtotal_cents = 0;

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null default '00000000-0000-0000-0000-000000000001'
    references public.workspaces(id) on delete cascade,
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  provider text not null default 'manual',
  provider_ref text,
  amount_cents bigint not null,
  currency text not null default 'USD',
  status text not null default 'succeeded'
    check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  recorded_by uuid references auth.users(id),
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (provider, provider_ref)
);
grant select, insert, update, delete on public.payments to authenticated;
grant all on public.payments to service_role;
alter table public.payments enable row level security;
create index idx_payments_invoice on public.payments(invoice_id);
create policy "ws_boundary" on public.payments as restrictive to authenticated
  using (workspace_id in (select public.user_workspace_ids(auth.uid())))
  with check (workspace_id in (select public.user_workspace_ids(auth.uid())));
create policy "payments_admin_all" on public.payments for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create policy "payments_member_select" on public.payments for select to authenticated
  using (exists (select 1 from public.invoices i
                 where i.id = payments.invoice_id
                   and public.is_project_member(i.project_id, auth.uid())));
create trigger ws_inherit before insert on public.payments
  for each row execute function public.inherit_workspace('invoices', 'invoice_id');

create or replace function public.settle_invoice()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  inv uuid := coalesce(new.invoice_id, old.invoice_id);
  total bigint;
  due bigint;
begin
  select coalesce(sum(amount_cents), 0) into total
  from public.payments where invoice_id = inv and status = 'succeeded';

  select amount_cents into due from public.invoices where id = inv;

  if total >= due and due > 0 then
    update public.invoices
    set status = 'paid', paid_at = coalesce(paid_at, now())
    where id = inv and status <> 'paid';

    insert into public.project_updates (project_id, kind, title, body, data)
    select i.project_id, 'invoice_paid', coalesce(i.number, 'Invoice'),
           'Payment received. Thank you.', jsonb_build_object('invoice_id', i.id)
    from public.invoices i where i.id = inv;
  else
    update public.invoices set status = 'sent', paid_at = null
    where id = inv and status = 'paid';
  end if;
  return coalesce(new, old);
end $$;
revoke execute on function public.settle_invoice() from public, anon, authenticated;

create trigger settle_invoice after insert or update or delete on public.payments
  for each row execute function public.settle_invoice();

create or replace function public.assign_invoice_number()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  n int;
  prefix text;
begin
  if new.number is not null and new.number <> '' then
    return new;
  end if;
  update public.workspaces
     set invoice_seq = invoice_seq + 1
   where id = new.workspace_id
  returning invoice_seq, invoice_prefix into n, prefix;
  new.number := format('%s-%s', coalesce(prefix, 'INV'), lpad(n::text, 4, '0'));
  return new;
end $$;
revoke execute on function public.assign_invoice_number() from public, anon, authenticated;

create trigger assign_invoice_number before insert on public.invoices
  for each row execute function public.assign_invoice_number();

create policy "documents_read_auth" on storage.objects for select to authenticated
  using (bucket_id = 'documents');

create or replace function public.post_ticket_update()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.project_updates (project_id, author_id, kind, title, body, data)
    values (new.project_id, new.reporter_id, 'ticket_opened',
            format('#%s %s', new.ticket_number, new.title),
            null,
            jsonb_build_object('ticket_id', new.id, 'type', new.type));
    return new;
  end if;

  if new.status in ('done', 'wont_fix') and old.status not in ('done', 'wont_fix') then
    insert into public.project_updates (project_id, author_id, kind, title, body, data)
    values (new.project_id, auth.uid(), 'ticket_closed',
            format('#%s %s', new.ticket_number, new.title),
            case when new.status = 'wont_fix' then 'Closed without a change.' else 'Done.' end,
            jsonb_build_object('ticket_id', new.id));
  end if;

  return new;
end $$;
revoke execute on function public.post_ticket_update() from public, anon, authenticated;

create trigger post_ticket_update after insert or update of status on public.tickets
  for each row execute function public.post_ticket_update();