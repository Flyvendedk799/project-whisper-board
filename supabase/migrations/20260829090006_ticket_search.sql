-- Full-text search and the indexes the triage queue sorts on.
--
-- Search has to survive pagination, so it runs in Postgres rather than over an
-- already-fetched page. A generated tsvector column keeps it inside normal
-- PostgREST filtering, which means it composes with every other filter and
-- stays subject to RLS — neither is true of an RPC.

alter table public.tickets add column search_tsv tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B')
  ) stored;

create index idx_tickets_search on public.tickets using gin (search_tsv);

create index idx_tickets_queue on public.tickets(workspace_id, status, created_at desc);
create index idx_tickets_assignee on public.tickets(assignee_id)
  where assignee_id is not null;
create index idx_tickets_project_status on public.tickets(project_id, status);
create index idx_tickets_updated on public.tickets(workspace_id, updated_at desc);
