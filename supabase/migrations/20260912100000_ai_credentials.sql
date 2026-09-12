-- Where a person's own AI credential lives.
--
-- One row per account per provider. The payload is already sealed by the
-- library that writes it — an AES-GCM envelope keyed off the app secret — so
-- this table never sees a token in the clear, and a database dump is not a
-- disclosure of anybody's subscription.
--
-- Reached only by the service role, from the server. Row-level security is on
-- with NO policies, which is what makes that true: under RLS a table with no
-- policy returns nothing to anyone, and `service_role` bypasses RLS by design.
-- The grants are revoked as well rather than relying on that alone, because the
-- schema's default privileges hand every new table to `anon` and `authenticated`
-- and this is the one table where that would be worth noticing.

create table if not exists public.ai_credentials (
  key         text primary key,
  payload     text not null,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.ai_credentials enable row level security;

revoke all on public.ai_credentials from anon, authenticated;
grant all on public.ai_credentials to service_role;

comment on table public.ai_credentials is
  'Sealed per-account AI credentials (Claude subscription tokens). Service role only; RLS on with no policies.';
