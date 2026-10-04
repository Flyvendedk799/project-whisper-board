-- A follow-up is an open ticket with a visible reason, created alongside its comment.
alter table public.tickets add column follow_up_kind text
  check (follow_up_kind in ('improvement', 'fix'));

create or replace function public.post_ticket_followup(
  _ticket_id uuid, _body text, _kind text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  ticket_project uuid;
  comment_id uuid;
begin
  if auth.uid() is null or _kind not in ('improvement', 'fix')
     or length(trim(_body)) < 1 or length(_body) > 20000 then
    raise exception 'Invalid follow-up request';
  end if;
  select project_id into ticket_project from public.tickets where id = _ticket_id for update;
  if ticket_project is null or not (
    public.is_admin(auth.uid()) or public.is_project_member(ticket_project, auth.uid())
  ) then
    raise exception 'Ticket is not available';
  end if;
  insert into public.ticket_comments (ticket_id, author_id, body, is_internal)
  values (_ticket_id, auth.uid(), _body, false) returning id into comment_id;
  update public.tickets set status = 'open', follow_up_kind = _kind where id = _ticket_id;
  return comment_id;
end $$;
revoke all on function public.post_ticket_followup(uuid, text, text) from public, anon;
grant execute on function public.post_ticket_followup(uuid, text, text) to authenticated;

create or replace function public.log_ticket_edit_event()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.title is distinct from old.title then
    insert into public.ticket_events(ticket_id, actor_id, kind, field, old_value, new_value)
    values(new.id, auth.uid(), 'title_changed', 'title', old.title, new.title);
  end if;
  if new.description is distinct from old.description then
    insert into public.ticket_events(ticket_id, actor_id, kind, field)
    values(new.id, auth.uid(), 'description_changed', 'description');
  end if;
  if new.follow_up_kind is distinct from old.follow_up_kind then
    insert into public.ticket_events(ticket_id, actor_id, kind, field, new_value)
    values(new.id, auth.uid(), 'follow_up_requested', 'follow_up_kind', new.follow_up_kind);
  end if;
  return new;
end $$;
revoke execute on function public.log_ticket_edit_event() from public, anon, authenticated;
create trigger log_ticket_edit_event after update on public.tickets
  for each row execute function public.log_ticket_edit_event();
