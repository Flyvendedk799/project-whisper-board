-- Phase 1 leftovers: stop implying tickets/PRs that are not there.
--
-- plan_tasks.ticket_id is ON DELETE SET NULL, but seed/agent paths can leave
-- ticket_id pointing at a row the join cannot see, or pr_number without pr_url,
-- or free-text "ticket #1" / "PR #13" in comments after the structured link is gone.

-- Dangling structured ticket links.
update public.plan_tasks t
set ticket_id = null
where t.ticket_id is not null
  and not exists (select 1 from public.tickets tk where tk.id = t.ticket_id);

-- PR number/status without a URL reads as linked on the card and empty in the drawer.
update public.plan_tasks
set pr_number = null,
    pr_status = null
where pr_url is null
  and (pr_number is not null or pr_status is not null);

-- Drop "From ticket #N …" headers when nothing is linked anymore.
update public.plan_tasks
set description = nullif(
  trim(both E' \n' from regexp_replace(
    description,
    '(?i)^From ticket #[0-9]+[^\n]*\.?\s*',
    ''
  )),
  ''
)
where ticket_id is null
  and description ~* '^From ticket #[0-9]+';

-- Scrub free-text citations on tasks that have no live ticket or PR URL.
update public.plan_task_comments c
set body = trim(both E' \n' from regexp_replace(
  regexp_replace(
    regexp_replace(
      c.body,
      '(?i)\mresolves\s+ticket(\s*#[0-9]+)?\M[^.!\n]*[.!]?',
      '',
      'g'
    ),
    '(?i)\m(from\s+)?ticket\s*#[0-9]+\M[^.!\n]*[.!]?',
    '',
    'g'
  ),
  '(?i)\mPR\s*#[0-9]+\M',
  '',
  'g'
))
from public.plan_tasks t
where c.task_id = t.id
  and t.ticket_id is null
  and t.pr_url is null
  and (
    c.body ~* 'ticket\s*#[0-9]+'
    or c.body ~* 'PR\s*#[0-9]+'
    or c.body ~* 'resolves\s+ticket'
  );

-- Drop comments that became empty after scrubbing.
delete from public.plan_task_comments
where trim(coalesce(body, '')) = '';
