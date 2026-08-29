-- Closing a ticket is news.
--
-- The update_kind enum has had ticket_opened and ticket_closed since the first
-- migration and nothing ever wrote either. A client watching a project should
-- see work land without anyone having to narrate it.

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

  -- Only on the transition, so re-saving a done ticket does not post again.
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
