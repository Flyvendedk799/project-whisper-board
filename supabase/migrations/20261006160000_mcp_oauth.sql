-- ============================================================
-- Hosted MCP OAuth — storage + transactional RPCs
-- Opaque Boared-issued tokens (NOT Supabase JWTs). Secrets are
-- hashed (SHA-256 hex) before insert; plaintext never stored.
-- ============================================================

-- pgcrypto for digest() in PKCE (S256) verification inside RPCs
create extension if not exists pgcrypto with schema extensions;

-- Allowed token auth methods for registered OAuth clients.
do $$ begin
  create type public.mcp_oauth_auth_method as enum (
    'none',
    'client_secret_basic',
    'client_secret_post'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.mcp_oauth_token_kind as enum ('access', 'refresh');
exception when duplicate_object then null;
end $$;

-- Hosted MCP scopes (subset; grants store the consented list).
-- planner:read/write, account:read/write, github:read/write/merge

-- 1. Clients (predefined / operator-registered; no public DCR) ─
create table if not exists public.mcp_oauth_clients (
  client_id          text primary key,
  client_name        text not null,
  redirect_uris      text[] not null,
  auth_method        public.mcp_oauth_auth_method not null default 'none',
  client_secret_hash text,
  allowed_scopes     text[] not null default '{planner:read}',
  created_at         timestamptz not null default now(),
  disabled_at        timestamptz,
  constraint mcp_oauth_clients_redirects_nonempty
    check (cardinality(redirect_uris) >= 1),
  constraint mcp_oauth_clients_scopes_nonempty
    check (cardinality(allowed_scopes) >= 1),
  constraint mcp_oauth_clients_secret_for_confidential
    check (
      (auth_method = 'none' and client_secret_hash is null)
      or (auth_method <> 'none' and client_secret_hash is not null
          and char_length(client_secret_hash) = 64)
    )
);

comment on table public.mcp_oauth_clients is
  'Predefined OAuth clients for hosted MCP. No unauthenticated DCR.';

-- 2. Pending authorization requests (browser-bound txn) ────────
create table if not exists public.mcp_oauth_authorization_requests (
  id                     uuid primary key default gen_random_uuid(),
  client_id              text not null references public.mcp_oauth_clients(client_id),
  redirect_uri           text not null,
  resource               text not null,
  requested_scopes       text[] not null,
  code_challenge         text not null,
  code_challenge_method  text not null default 'S256'
    check (code_challenge_method = 'S256'),
  state                  text,
  binding_nonce_hash     text not null check (char_length(binding_nonce_hash) = 64),
  bound_user_id          uuid references auth.users(id) on delete set null,
  created_at             timestamptz not null default now(),
  expires_at             timestamptz not null,
  consumed_at            timestamptz,
  constraint mcp_oauth_auth_req_scopes_nonempty
    check (cardinality(requested_scopes) >= 1),
  constraint mcp_oauth_auth_req_redirect_nonempty
    check (char_length(redirect_uri) > 0),
  constraint mcp_oauth_auth_req_challenge_nonempty
    check (char_length(code_challenge) > 0)
);

create index if not exists idx_mcp_oauth_auth_req_client
  on public.mcp_oauth_authorization_requests(client_id);
create index if not exists idx_mcp_oauth_auth_req_expires
  on public.mcp_oauth_authorization_requests(expires_at);

-- 3. Grants (consented connection) ────────────────────────────
create table if not exists public.mcp_oauth_grants (
  id            uuid primary key default gen_random_uuid(),
  client_id     text not null references public.mcp_oauth_clients(client_id),
  user_id       uuid not null references auth.users(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  issuer        text not null,
  resource      text not null,
  scopes        text[] not null,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  last_used_at  timestamptz,
  constraint mcp_oauth_grants_scopes_nonempty
    check (cardinality(scopes) >= 1),
  constraint mcp_oauth_grants_member_fk
    foreign key (workspace_id, user_id)
    references public.workspace_members(workspace_id, user_id)
    on delete cascade
);

create index if not exists idx_mcp_oauth_grants_user
  on public.mcp_oauth_grants(user_id);
create index if not exists idx_mcp_oauth_grants_workspace
  on public.mcp_oauth_grants(workspace_id);
create index if not exists idx_mcp_oauth_grants_client
  on public.mcp_oauth_grants(client_id);

-- 4. Authorization codes (single-use) ─────────────────────────
create table if not exists public.mcp_oauth_codes (
  code_hash     text primary key check (char_length(code_hash) = 64),
  grant_id      uuid not null references public.mcp_oauth_grants(id) on delete cascade,
  client_id     text not null,
  redirect_uri  text not null,
  resource      text not null,
  code_challenge text not null,
  expires_at    timestamptz not null,
  consumed_at   timestamptz
);

create index if not exists idx_mcp_oauth_codes_grant
  on public.mcp_oauth_codes(grant_id);

-- 5. Access + refresh tokens ──────────────────────────────────
create table if not exists public.mcp_oauth_tokens (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique check (char_length(token_hash) = 64),
  grant_id      uuid not null references public.mcp_oauth_grants(id) on delete cascade,
  kind          public.mcp_oauth_token_kind not null,
  family_id     uuid not null,
  parent_id     uuid references public.mcp_oauth_tokens(id) on delete set null,
  scopes        text[] not null,
  not_before    timestamptz not null default now(),
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now(),
  consumed_at   timestamptz,
  revoked_at    timestamptz,
  constraint mcp_oauth_tokens_scopes_nonempty
    check (cardinality(scopes) >= 1)
);

create index if not exists idx_mcp_oauth_tokens_grant
  on public.mcp_oauth_tokens(grant_id);
create index if not exists idx_mcp_oauth_tokens_family
  on public.mcp_oauth_tokens(family_id);
create index if not exists idx_mcp_oauth_tokens_expires
  on public.mcp_oauth_tokens(expires_at);
create index if not exists idx_mcp_oauth_tokens_kind_hash
  on public.mcp_oauth_tokens(kind, token_hash);

-- 6. Audit (no tokens/codes/bodies/creds) ─────────────────────
create table if not exists public.mcp_oauth_audit (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  user_id       uuid,
  workspace_id  uuid,
  grant_id      uuid,
  request_id    text,
  event         text not null,
  tool_name     text,
  target_type   text,
  target_id     text,
  outcome       text,
  duration_ms   integer
);

create index if not exists idx_mcp_oauth_audit_created
  on public.mcp_oauth_audit(created_at desc);
create index if not exists idx_mcp_oauth_audit_grant
  on public.mcp_oauth_audit(grant_id);

-- RLS: service_role only ──────────────────────────────────────
alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_authorization_requests enable row level security;
alter table public.mcp_oauth_grants enable row level security;
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_oauth_tokens enable row level security;
alter table public.mcp_oauth_audit enable row level security;

revoke all on public.mcp_oauth_clients from public, anon, authenticated;
revoke all on public.mcp_oauth_authorization_requests from public, anon, authenticated;
revoke all on public.mcp_oauth_grants from public, anon, authenticated;
revoke all on public.mcp_oauth_codes from public, anon, authenticated;
revoke all on public.mcp_oauth_tokens from public, anon, authenticated;
revoke all on public.mcp_oauth_audit from public, anon, authenticated;

grant all on public.mcp_oauth_clients to service_role;
grant all on public.mcp_oauth_authorization_requests to service_role;
grant all on public.mcp_oauth_grants to service_role;
grant all on public.mcp_oauth_codes to service_role;
grant all on public.mcp_oauth_tokens to service_role;
grant all on public.mcp_oauth_audit to service_role;

-- Helper: user is live (not deleted / banned) and admin of workspace
create or replace function public.mcp_oauth_user_is_live_admin(
  _user_id uuid,
  _workspace_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from auth.users u
    join public.workspace_members wm
      on wm.user_id = u.id
     and wm.workspace_id = _workspace_id
     and wm.role = 'admin'
    where u.id = _user_id
      and (u.banned_until is null or u.banned_until < now())
  );
$$;

revoke all on function public.mcp_oauth_user_is_live_admin(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mcp_oauth_user_is_live_admin(uuid, uuid) to service_role;

-- ============================================================
-- redeem_mcp_oauth_code
-- Consumes a single-use code and inserts access+refresh pair.
-- ============================================================
create or replace function public.redeem_mcp_oauth_code(
  _code_hash text,
  _client_id text,
  _redirect_uri text,
  _resource text,
  _code_verifier text,
  _access_token_hash text,
  _refresh_token_hash text,
  _access_ttl_seconds integer,
  _refresh_ttl_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_code public.mcp_oauth_codes%rowtype;
  v_grant public.mcp_oauth_grants%rowtype;
  v_client public.mcp_oauth_clients%rowtype;
  v_family uuid;
  v_access_id uuid;
  v_refresh_id uuid;
  v_challenge text;
  v_now timestamptz := now();
begin
  if _code_hash is null or char_length(_code_hash) <> 64 then
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;
  if _access_token_hash is null or char_length(_access_token_hash) <> 64
     or _refresh_token_hash is null or char_length(_refresh_token_hash) <> 64 then
    raise exception 'server_error' using errcode = 'P0001';
  end if;
  if _access_ttl_seconds is null or _access_ttl_seconds < 60 or _access_ttl_seconds > 3600 then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;
  if _refresh_ttl_seconds is null or _refresh_ttl_seconds < 3600 or _refresh_ttl_seconds > 7776000 then
    raise exception 'invalid_request' using errcode = 'P0001';
  end if;

  select * into v_code
  from public.mcp_oauth_codes
  where code_hash = _code_hash
  for update;

  if not found then
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;

  if v_code.consumed_at is not null then
    -- Code replay: revoke the grant and any tokens issued from it.
    update public.mcp_oauth_grants
      set revoked_at = coalesce(revoked_at, v_now)
    where id = v_code.grant_id;
    update public.mcp_oauth_tokens
      set revoked_at = coalesce(revoked_at, v_now)
    where grant_id = v_code.grant_id and revoked_at is null;
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;

  if v_code.expires_at <= v_now then
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;

  if v_code.client_id <> _client_id
     or v_code.redirect_uri <> _redirect_uri
     or v_code.resource <> _resource then
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;

  -- PKCE S256: BASE64URL(SHA256(verifier)) must equal stored challenge
  v_challenge := trim(trailing '=' from translate(
    encode(extensions.digest(convert_to(_code_verifier, 'UTF8'), 'sha256'), 'base64'),
    '+/', '-_'
  ));
  if v_challenge is distinct from v_code.code_challenge then
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;

  select * into v_grant
  from public.mcp_oauth_grants
  where id = v_code.grant_id
  for update;

  if not found
     or v_grant.revoked_at is not null
     or v_grant.expires_at <= v_now then
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;

  select * into v_client
  from public.mcp_oauth_clients
  where client_id = _client_id
  for update;

  if not found or v_client.disabled_at is not null then
    raise exception 'invalid_client' using errcode = 'P0001';
  end if;

  if not public.mcp_oauth_user_is_live_admin(v_grant.user_id, v_grant.workspace_id) then
    raise exception 'access_denied' using errcode = 'P0001';
  end if;

  update public.mcp_oauth_codes
    set consumed_at = v_now
  where code_hash = _code_hash
    and consumed_at is null;

  if not found then
    -- Concurrent redeem lost the race
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;

  v_family := gen_random_uuid();

  insert into public.mcp_oauth_tokens (
    token_hash, grant_id, kind, family_id, parent_id, scopes, not_before, expires_at
  ) values (
    _access_token_hash, v_grant.id, 'access', v_family, null, v_grant.scopes, v_now,
    v_now + make_interval(secs => _access_ttl_seconds)
  ) returning id into v_access_id;

  insert into public.mcp_oauth_tokens (
    token_hash, grant_id, kind, family_id, parent_id, scopes, not_before, expires_at
  ) values (
    _refresh_token_hash, v_grant.id, 'refresh', v_family, v_access_id, v_grant.scopes, v_now,
    v_now + make_interval(secs => _refresh_ttl_seconds)
  ) returning id into v_refresh_id;

  update public.mcp_oauth_grants
    set last_used_at = v_now
  where id = v_grant.id;

  return jsonb_build_object(
    'grant_id', v_grant.id,
    'access_token_id', v_access_id,
    'refresh_token_id', v_refresh_id,
    'family_id', v_family,
    'scopes', to_jsonb(v_grant.scopes),
    'resource', v_grant.resource,
    'workspace_id', v_grant.workspace_id,
    'user_id', v_grant.user_id,
    'access_expires_at', (v_now + make_interval(secs => _access_ttl_seconds)),
    'refresh_expires_at', (v_now + make_interval(secs => _refresh_ttl_seconds))
  );
end;
$$;

revoke all on function public.redeem_mcp_oauth_code(
  text, text, text, text, text, text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.redeem_mcp_oauth_code(
  text, text, text, text, text, text, text, integer, integer
) to service_role;

-- ============================================================
-- rotate_mcp_oauth_refresh_token
-- Consumes predecessor refresh; inserts replacement pair.
-- Reused refresh revokes the whole grant.
-- ============================================================
create or replace function public.rotate_mcp_oauth_refresh_token(
  _refresh_token_hash text,
  _client_id text,
  _resource text,
  _requested_scopes text[],
  _access_token_hash text,
  _new_refresh_token_hash text,
  _access_ttl_seconds integer,
  _refresh_ttl_seconds integer
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_old public.mcp_oauth_tokens%rowtype;
  v_grant public.mcp_oauth_grants%rowtype;
  v_client public.mcp_oauth_clients%rowtype;
  v_scopes text[];
  v_access_id uuid;
  v_refresh_id uuid;
  v_now timestamptz := now();
  v_scope text;
begin
  if _refresh_token_hash is null or char_length(_refresh_token_hash) <> 64 then
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;
  if _access_token_hash is null or char_length(_access_token_hash) <> 64
     or _new_refresh_token_hash is null or char_length(_new_refresh_token_hash) <> 64 then
    raise exception 'server_error' using errcode = 'P0001';
  end if;

  select * into v_old
  from public.mcp_oauth_tokens
  where token_hash = _refresh_token_hash
    and kind = 'refresh'
  for update;

  if not found then
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;

  select * into v_grant
  from public.mcp_oauth_grants
  where id = v_old.grant_id
  for update;

  if not found then
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;

  -- Refresh reuse detection: already consumed or revoked → kill the grant family
  if v_old.consumed_at is not null or v_old.revoked_at is not null then
    update public.mcp_oauth_grants
      set revoked_at = coalesce(revoked_at, v_now)
    where id = v_grant.id;
    update public.mcp_oauth_tokens
      set revoked_at = coalesce(revoked_at, v_now)
    where grant_id = v_grant.id and revoked_at is null;
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;

  if v_old.expires_at <= v_now
     or v_grant.revoked_at is not null
     or v_grant.expires_at <= v_now then
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;

  if v_grant.client_id <> _client_id or v_grant.resource <> _resource then
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;

  select * into v_client
  from public.mcp_oauth_clients
  where client_id = _client_id
  for update;

  if not found or v_client.disabled_at is not null then
    raise exception 'invalid_client' using errcode = 'P0001';
  end if;

  if not public.mcp_oauth_user_is_live_admin(v_grant.user_id, v_grant.workspace_id) then
    raise exception 'access_denied' using errcode = 'P0001';
  end if;

  -- Scopes: retain or narrow; never expand. Must be subset of live grant ∩ client allowlist.
  if _requested_scopes is null or cardinality(_requested_scopes) = 0 then
    v_scopes := v_old.scopes;
  else
    v_scopes := '{}';
    foreach v_scope in array _requested_scopes loop
      if not (v_scope = any (v_old.scopes)) then
        raise exception 'invalid_scope' using errcode = 'P0001';
      end if;
      if not (v_scope = any (v_grant.scopes)) then
        raise exception 'invalid_scope' using errcode = 'P0001';
      end if;
      if not (v_scope = any (v_client.allowed_scopes)) then
        raise exception 'invalid_scope' using errcode = 'P0001';
      end if;
      v_scopes := array_append(v_scopes, v_scope);
    end loop;
    if cardinality(v_scopes) = 0 then
      raise exception 'invalid_scope' using errcode = 'P0001';
    end if;
  end if;

  update public.mcp_oauth_tokens
    set consumed_at = v_now
  where id = v_old.id
    and consumed_at is null
    and revoked_at is null;

  if not found then
    update public.mcp_oauth_grants
      set revoked_at = coalesce(revoked_at, v_now)
    where id = v_grant.id;
    update public.mcp_oauth_tokens
      set revoked_at = coalesce(revoked_at, v_now)
    where grant_id = v_grant.id and revoked_at is null;
    raise exception 'invalid_grant' using errcode = 'P0001';
  end if;

  -- Also revoke prior access tokens in this family (rotation)
  update public.mcp_oauth_tokens
    set revoked_at = coalesce(revoked_at, v_now)
  where family_id = v_old.family_id
    and kind = 'access'
    and revoked_at is null
    and consumed_at is null;

  insert into public.mcp_oauth_tokens (
    token_hash, grant_id, kind, family_id, parent_id, scopes, not_before, expires_at
  ) values (
    _access_token_hash, v_grant.id, 'access', v_old.family_id, v_old.id, v_scopes, v_now,
    v_now + make_interval(secs => _access_ttl_seconds)
  ) returning id into v_access_id;

  insert into public.mcp_oauth_tokens (
    token_hash, grant_id, kind, family_id, parent_id, scopes, not_before, expires_at
  ) values (
    _new_refresh_token_hash, v_grant.id, 'refresh', v_old.family_id, v_access_id, v_scopes, v_now,
    v_now + make_interval(secs => _refresh_ttl_seconds)
  ) returning id into v_refresh_id;

  update public.mcp_oauth_grants
    set last_used_at = v_now
  where id = v_grant.id;

  return jsonb_build_object(
    'grant_id', v_grant.id,
    'access_token_id', v_access_id,
    'refresh_token_id', v_refresh_id,
    'family_id', v_old.family_id,
    'scopes', to_jsonb(v_scopes),
    'resource', v_grant.resource,
    'workspace_id', v_grant.workspace_id,
    'user_id', v_grant.user_id,
    'access_expires_at', (v_now + make_interval(secs => _access_ttl_seconds)),
    'refresh_expires_at', (v_now + make_interval(secs => _refresh_ttl_seconds))
  );
end;
$$;

revoke all on function public.rotate_mcp_oauth_refresh_token(
  text, text, text, text[], text, text, integer, integer
) from public, anon, authenticated;
grant execute on function public.rotate_mcp_oauth_refresh_token(
  text, text, text, text[], text, text, integer, integer
) to service_role;

-- ============================================================
-- revoke_mcp_oauth_grant
-- ============================================================
create or replace function public.revoke_mcp_oauth_grant(
  _grant_id uuid,
  _actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_grant public.mcp_oauth_grants%rowtype;
  v_now timestamptz := now();
  v_is_owner boolean;
  v_is_admin boolean;
begin
  select * into v_grant
  from public.mcp_oauth_grants
  where id = _grant_id
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  v_is_owner := v_grant.user_id = _actor_user_id;
  v_is_admin := public.is_workspace_admin(v_grant.workspace_id, _actor_user_id);

  if not (v_is_owner or v_is_admin) then
    raise exception 'access_denied' using errcode = 'P0001';
  end if;

  if v_grant.revoked_at is not null then
    return jsonb_build_object('grant_id', v_grant.id, 'revoked_at', v_grant.revoked_at, 'already', true);
  end if;

  update public.mcp_oauth_grants
    set revoked_at = v_now
  where id = v_grant.id;

  update public.mcp_oauth_tokens
    set revoked_at = coalesce(revoked_at, v_now)
  where grant_id = v_grant.id
    and revoked_at is null;

  return jsonb_build_object('grant_id', v_grant.id, 'revoked_at', v_now, 'already', false);
end;
$$;

revoke all on function public.revoke_mcp_oauth_grant(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_mcp_oauth_grant(uuid, uuid) to service_role;

