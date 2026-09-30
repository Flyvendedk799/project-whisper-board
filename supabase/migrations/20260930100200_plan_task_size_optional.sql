-- A task can be "not sized yet". The redesigned plan screen shows a size chip
-- only when somebody chose one; with a NOT NULL default of 'medium' every card
-- claimed to be medium-sized and the chip carried no information.

alter table public.plan_tasks alter column complexity drop not null;
alter table public.plan_tasks alter column complexity drop default;
