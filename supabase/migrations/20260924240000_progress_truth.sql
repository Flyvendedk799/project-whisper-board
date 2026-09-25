-- One progress number.
--
-- Milestones own the bar once any of them has left "pending" — that is the
-- plan the client is paying for. Until then, a finished planner does not sit
-- at 0% beside a row of untouched milestones: plan tasks are the work, and
-- the project percent is their completion. With neither, the number is 0.

create or replace function public.recompute_project_progress(_project_id uuid)
returns void language sql security definer set search_path = public
as $$
  update public.projects p
  set progress = coalesce((
    select case
      when exists (
        select 1 from public.milestones m
        where m.project_id = p.id and m.status <> 'pending'
      ) then (
        select round(100.0 * count(*) filter (where m.status = 'done') / nullif(count(*), 0))
        from public.milestones m
        where m.project_id = p.id
      )
      when exists (
        select 1
        from public.plan_tasks t
        join public.plans pl on pl.id = t.plan_id
        where pl.project_id = p.id
      ) then (
        select round(100.0 * count(*) filter (where t.status = 'done') / nullif(count(*), 0))
        from public.plan_tasks t
        join public.plans pl on pl.id = t.plan_id
        where pl.project_id = p.id
      )
      else (
        select round(100.0 * count(*) filter (where m.status = 'done') / nullif(count(*), 0))
        from public.milestones m
        where m.project_id = p.id
      )
    end
  ), 0)
  where p.id = _project_id;
$$;

update public.workspaces
set name = 'Boared'
where id = '00000000-0000-0000-0000-000000000001'
  and name = 'Consflow';

do $$
declare
  pid uuid;
begin
  for pid in select id from public.projects loop
    perform public.recompute_project_progress(pid);
  end loop;
end $$;
