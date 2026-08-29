-- Audit trail, written by the database.
--
-- `ticket_events` has existed since the first migration and nothing has ever
-- written to it. Putting the writes in application code is how it stayed empty:
-- every new mutation path is another chance to forget. Triggers cannot forget.

alter table public.ticket_events
  add column field text,
  add column old_value text,
  add column new_value text;

create index idx_ticket_events_ticket on public.ticket_events(ticket_id, created_at desc);

create or replace function public.log_ticket_event()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_events (ticket_id, actor_id, kind, data)
    values (new.id, coalesce(actor, new.reporter_id), 'created',
            jsonb_build_object('title', new.title, 'type', new.type, 'priority', new.priority));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.ticket_events (ticket_id, actor_id, kind, field, old_value, new_value)
    values (new.id, actor, 'status_changed', 'status', old.status::text, new.status::text);
  end if;
  if new.priority is distinct from old.priority then
    insert into public.ticket_events (ticket_id, actor_id, kind, field, old_value, new_value)
    values (new.id, actor, 'priority_changed', 'priority', old.priority::text, new.priority::text);
  end if;
  if new.type is distinct from old.type then
    insert into public.ticket_events (ticket_id, actor_id, kind, field, old_value, new_value)
    values (new.id, actor, 'type_changed', 'type', old.type::text, new.type::text);
  end if;
  if new.assignee_id is distinct from old.assignee_id then
    insert into public.ticket_events (ticket_id, actor_id, kind, field, old_value, new_value)
    values (new.id, actor,
            case when new.assignee_id is null then 'unassigned' else 'assigned' end,
            'assignee_id', old.assignee_id::text, new.assignee_id::text);
  end if;
  if new.due_date is distinct from old.due_date then
    insert into public.ticket_events (ticket_id, actor_id, kind, field, old_value, new_value)
    values (new.id, actor, 'due_date_changed', 'due_date', old.due_date::text, new.due_date::text);
  end if;
  if new.eta_date is distinct from old.eta_date then
    insert into public.ticket_events (ticket_id, actor_id, kind, field, old_value, new_value)
    values (new.id, actor, 'eta_changed', 'eta_date', old.eta_date::text, new.eta_date::text);
  end if;
  if new.estimate_hours is distinct from old.estimate_hours then
    insert into public.ticket_events (ticket_id, actor_id, kind, field, old_value, new_value)
    values (new.id, actor, 'estimate_changed', 'estimate_hours',
            old.estimate_hours::text, new.estimate_hours::text);
  end if;
  return new;
end $$;
revoke execute on function public.log_ticket_event() from public, anon, authenticated;

create trigger log_ticket_event after insert or update on public.tickets
  for each row execute function public.log_ticket_event();

create or replace function public.log_comment_event()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.ticket_events (ticket_id, actor_id, kind, data)
  values (new.ticket_id, new.author_id,
          case when new.is_internal then 'internal_note' else 'commented' end,
          jsonb_build_object('comment_id', new.id));
  return new;
end $$;
revoke execute on function public.log_comment_event() from public, anon, authenticated;

create trigger log_comment_event after insert on public.ticket_comments
  for each row execute function public.log_comment_event();

create or replace function public.log_attachment_event()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.ticket_events (ticket_id, actor_id, kind, data)
  values (new.ticket_id, new.uploader_id, 'attached',
          jsonb_build_object('attachment_id', new.id, 'file_name', new.file_name,
                             'is_recording', new.is_recording));
  return new;
end $$;
revoke execute on function public.log_attachment_event() from public, anon, authenticated;

create trigger log_attachment_event after insert on public.ticket_attachments
  for each row execute function public.log_attachment_event();
