-- A project can point at the repository its plans and tickets are about.
alter table public.projects
  add column if not exists github_repo text,
  add column if not exists github_default_branch text;
