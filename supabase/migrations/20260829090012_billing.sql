-- Billing: line items, payments, and numbering.
--
-- The invoices table held a single amount and a dangling stripe column. Real
-- invoices are itemised, are numbered per workspace, and are marked paid
-- because money arrived — not because someone clicked a button. Routing every
-- settlement through `payments` means the manual path and the card path
-- converge on the same trigger.

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
-- RLS decides which rows; a table grant decides whether the role may reach
-- the table at all. Supabase grants these by default for new tables in
-- `public`, but leaning on that makes the schema unreproducible anywhere
-- else — which is why the local harness had to grant by hand.
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

-- An invoice is paid when the money adds up, whoever recorded it.
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

-- Per-workspace invoice numbering, same counter pattern as ticket numbers.
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

-- Runs after ws_inherit, which needs to have set workspace_id first.
create trigger assign_invoice_number before insert on public.invoices
  for each row execute function public.assign_invoice_number();

-- Generated documents (quote and invoice PDFs the client can download).
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "documents_read_auth" on storage.objects for select to authenticated
  using (bucket_id = 'documents');
