-- Activity kinds for the redesigned plan screen.
--
-- Kept in its own file: a new enum value cannot be *used* in the transaction
-- that adds it, and the next migration's policies and triggers refer to them.

alter type public.plan_event_kind add value if not exists 'task_moved';
alter type public.plan_event_kind add value if not exists 'attachment_added';
alter type public.plan_event_kind add value if not exists 'attachment_removed';
alter type public.plan_event_kind add value if not exists 'task_deleted';
