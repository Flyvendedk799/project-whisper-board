-- Human-readable ticket references.
--
-- "Have a look at #124" is how people actually talk about tickets. A UUID in
-- the URL is fine; a UUID in a conversation is not.

alter table public.tickets add column ticket_number int;

create or replace function public.assign_ticket_number()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  n int;
begin
  if new.ticket_number is not null then
    return new;
  end if;
  -- UPDATE ... RETURNING takes a row lock, so concurrent inserts queue rather
  -- than racing for the same number.
  update public.workspaces
     set ticket_seq = ticket_seq + 1
   where id = new.workspace_id
  returning ticket_seq into n;
  new.ticket_number := n;
  return new;
end $$;
revoke execute on function public.assign_ticket_number() from public, anon, authenticated;

-- Backfill in creation order, then advance each workspace counter past it.
with numbered as (
  select id, row_number() over (partition by workspace_id order by created_at, id) as n
  from public.tickets
)
update public.tickets t set ticket_number = numbered.n
from numbered where numbered.id = t.id;

update public.workspaces w
set ticket_seq = greatest(w.ticket_seq, coalesce(
  (select max(ticket_number) from public.tickets t where t.workspace_id = w.id), 0));

alter table public.tickets alter column ticket_number set not null;
alter table public.tickets add constraint tickets_workspace_number_key
  unique (workspace_id, ticket_number);

-- BEFORE INSERT so the number is present in the row the audit trigger sees.
create trigger assign_ticket_number before insert on public.tickets
  for each row execute function public.assign_ticket_number();
