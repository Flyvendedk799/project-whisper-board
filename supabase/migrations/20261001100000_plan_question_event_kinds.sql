-- Activity kinds for questions.
--
-- Kept in its own file: a new enum value cannot be *used* in the transaction
-- that adds it, and the next migration's triggers refer to the questions table.

alter type public.plan_event_kind add value if not exists 'question_asked';
alter type public.plan_event_kind add value if not exists 'question_answered';
