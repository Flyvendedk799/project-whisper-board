-- Project progress, derived rather than typed.
--
-- `projects.progress` is rendered on the dashboard, the project grid and the
-- project header, and no code has ever written to it — every project shows 0%.
-- Milestones are the honest source: progress is how much of the plan is done.

create or replace function public.recompute_project_progress(_project_id uuid)
returns void language sql security definer set search_path = public
as $$
  update public.projects p
  set progress = coalesce((
    select round(100.0 * count(*) filter (where m.status = 'done') / nullif(count(*), 0))
    from public.milestones m
    where m.project_id = p.id
  ), 0)
  where p.id = _project_id;
$$;
revoke execute on function public.recompute_project_progress(uuid) from public, anon, authenticated;

create or replace function public.on_milestone_change()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  perform public.recompute_project_progress(coalesce(new.project_id, old.project_id));

  -- Completing a milestone is news the client should see without being told.
  if tg_op = 'UPDATE' and new.status = 'done' and old.status is distinct from 'done' then
    update public.milestones set completed_at = coalesce(new.completed_at, now())
    where id = new.id and completed_at is null;

    insert into public.project_updates (project_id, kind, title, body, data)
    values (new.project_id, 'milestone_done', new.title,
            'Milestone completed.', jsonb_build_object('milestone_id', new.id));
  end if;

  return coalesce(new, old);
end $$;
revoke execute on function public.on_milestone_change() from public, anon, authenticated;

create trigger on_milestone_change after insert or update or delete on public.milestones
  for each row execute function public.on_milestone_change();

-- Backfill every existing project.
update public.projects p
set progress = coalesce((
  select round(100.0 * count(*) filter (where m.status = 'done') / nullif(count(*), 0))
  from public.milestones m where m.project_id = p.id
), 0);
