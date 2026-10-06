-- Rethink plan visibility defaults vs 20261006140000:
-- Admin-created plans are agency-only by default (clients_can_view = false).
-- Client-created plans must set clients_can_view = true at insert (app/API).
-- Membership rule unchanged: clients only see plans they are project_members of
-- when the flag is true. Admins always see all workspace plans.

alter table public.plans
  alter column clients_can_view set default false;

comment on column public.plans.clients_can_view is
  'When true, project-member clients can read this plan. Admins always can. Defaults to false for admin-created plans; set true when a client creates a plan (or when an admin opts in via settings).';
