-- Aggregates the redesigned shell and home screen need in one round trip each.
--
-- Both functions are SECURITY INVOKER on purpose: they run as the caller, so the
-- existing row level security on tickets, invoices, payments and time_entries
-- decides what is counted. There is no second copy of the access rules here.

-- ---------------------------------------------------------------------------
-- Queue counts: every number beside a view in the triage rail, the sidebar
-- badge and the home tiles. Replaces eight separate head-only count requests.
-- ---------------------------------------------------------------------------
create or replace function public.ticket_queue_counts(
  _workspace_id uuid,
  _viewer_id uuid
) returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with open_tickets as (
    select t.status, t.assignee_id, t.first_response_at, t.sla_due_at
    from public.tickets t
    where t.workspace_id = _workspace_id
      and t.status not in ('done', 'wont_fix')
  )
  select jsonb_build_object(
    'allOpen',     (select count(*) from open_tickets),
    -- A ticket nobody has picked up: still "open" and with no owner.
    'needsTriage', (select count(*) from open_tickets where status = 'open' and assignee_id is null),
    'unassigned',  (select count(*) from open_tickets where assignee_id is null),
    'awaiting',    (select count(*) from open_tickets where first_response_at is null),
    'breached',    (select count(*) from open_tickets where sla_due_at < now()),
    'atRisk',      (select count(*) from open_tickets
                    where sla_due_at > now() and sla_due_at < now() + interval '24 hours'),
    'mine',        (select count(*) from open_tickets where assignee_id = _viewer_id),
    'closed',      (select count(*) from public.tickets t
                    where t.workspace_id = _workspace_id and t.status in ('done', 'wont_fix'))
  );
$$;

-- ---------------------------------------------------------------------------
-- Home: money and time. Outstanding is per currency because a workspace can
-- invoice in more than one and adding DKK to USD is not a number.
-- ---------------------------------------------------------------------------
create or replace function public.workspace_dashboard(
  _workspace_id uuid,
  _week_start timestamptz
) returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with owed as (
    select i.currency,
           greatest(
             i.amount_cents - coalesce((
               select sum(p.amount_cents) from public.payments p
               where p.invoice_id = i.id and p.status = 'succeeded'
             ), 0),
             0
           ) as outstanding_cents,
           (i.status = 'overdue') as is_overdue
    from public.invoices i
    where i.workspace_id = _workspace_id
      and i.status in ('sent', 'overdue')
  ),
  owed_by_currency as (
    select currency,
           sum(outstanding_cents)::bigint as cents,
           count(*)::int as invoices,
           count(*) filter (where is_overdue)::int as overdue
    from owed
    group by currency
  ),
  week as (
    select coalesce(sum(duration_minutes), 0)::int as minutes,
           coalesce(sum(duration_minutes) filter (where billable), 0)::int as billable_minutes
    from public.time_entries
    where workspace_id = _workspace_id
      and ended_at is not null
      and started_at >= _week_start
  )
  select jsonb_build_object(
    'outstanding', coalesce(
      (select jsonb_agg(jsonb_build_object(
         'currency', currency, 'cents', cents, 'invoices', invoices, 'overdue', overdue
       ) order by cents desc) from owed_by_currency),
      '[]'::jsonb),
    'weekMinutes', (select minutes from week),
    'weekBillableMinutes', (select billable_minutes from week)
  );
$$;

revoke all on function public.ticket_queue_counts(uuid, uuid) from public, anon;
revoke all on function public.workspace_dashboard(uuid, timestamptz) from public, anon;
grant execute on function public.ticket_queue_counts(uuid, uuid) to authenticated;
grant execute on function public.workspace_dashboard(uuid, timestamptz) to authenticated;

-- The awaiting-first-reply count and the "coming up" lists scan these columns.
create index if not exists idx_tickets_awaiting
  on public.tickets (workspace_id)
  where first_response_at is null and status not in ('done', 'wont_fix');
create index if not exists idx_milestones_due
  on public.milestones (due_date)
  where status <> 'done' and due_date is not null;
