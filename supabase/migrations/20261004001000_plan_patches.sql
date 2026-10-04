-- Commit-sized changes on a plan, grouped for a safe fast-forward or one PR.
create table public.plan_patches (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete cascade,
  branch text not null,
  commit_sha text not null,
  worktree_label text not null default '',
  bundle_name text not null default '',
  summary text not null,
  file_count integer not null default 0,
  additions integer not null default 0,
  deletions integer not null default 0,
  status text not null default 'registered' check (status in ('registered', 'applied', 'pr_open')),
  pr_url text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  applied_at timestamptz,
  unique(plan_id, commit_sha)
);
create index plan_patches_plan_created on public.plan_patches(plan_id, created_at desc);
alter table public.plan_patches enable row level security;

create policy plan_patches_workspace_read on public.plan_patches for select to authenticated
  using (exists (select 1 from public.plans p join public.workspace_members wm
    on wm.workspace_id = p.workspace_id where p.id = plan_patches.plan_id and wm.user_id = auth.uid()));
create policy plan_patches_admin_insert on public.plan_patches for insert to authenticated
  with check (exists (select 1 from public.plans p join public.workspace_members wm
    on wm.workspace_id = p.workspace_id where p.id = plan_patches.plan_id
    and wm.user_id = auth.uid() and wm.role = 'admin'));
create policy plan_patches_admin_update on public.plan_patches for update to authenticated
  using (exists (select 1 from public.plans p join public.workspace_members wm
    on wm.workspace_id = p.workspace_id where p.id = plan_patches.plan_id
    and wm.user_id = auth.uid() and wm.role = 'admin'));
create policy plan_patches_admin_delete on public.plan_patches for delete to authenticated
  using (exists (select 1 from public.plans p join public.workspace_members wm
    on wm.workspace_id = p.workspace_id where p.id = plan_patches.plan_id
    and wm.user_id = auth.uid() and wm.role = 'admin'));
