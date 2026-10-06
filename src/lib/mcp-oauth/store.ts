import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/integrations/supabase/types";
import { getMcpOAuthConfig } from "./config";
import { hashSecret, sha256Hex } from "./crypto";

export type Admin = SupabaseClient<Database>;

export function mcpOAuthAdmin(): Admin {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function ensureConfiguredClient(admin: Admin = mcpOAuthAdmin()) {
  const config = getMcpOAuthConfig();
  if (!config.clientId) return null;
  if (config.redirectUris.length === 0) {
    throw new Error("MCP_OAUTH_REDIRECT_URIS required when MCP_OAUTH_CLIENT_ID is set");
  }

  const row = {
    client_id: config.clientId,
    client_name: config.clientName,
    redirect_uris: [...config.redirectUris],
    auth_method: config.authMethod,
    client_secret_hash: config.clientSecret ? hashSecret(config.clientSecret) : null,
    allowed_scopes: [...config.allowedScopes],
    disabled_at: null as string | null,
  };

  const { error } = await admin.from("mcp_oauth_clients").upsert(row, { onConflict: "client_id" });
  if (error) throw error;
  return row;
}

export async function getClient(clientId: string, admin: Admin = mcpOAuthAdmin()) {
  await ensureConfiguredClient(admin);
  const { data, error } = await admin
    .from("mcp_oauth_clients")
    .select("*")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function insertAuthorizationRequest(
  input: {
    clientId: string;
    redirectUri: string;
    resource: string;
    requestedScopes: string[];
    codeChallenge: string;
    state: string | null;
    bindingNonceHash: string;
    expiresAt: string;
  },
  admin: Admin = mcpOAuthAdmin(),
) {
  const { data, error } = await admin
    .from("mcp_oauth_authorization_requests")
    .insert({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      resource: input.resource,
      requested_scopes: input.requestedScopes,
      code_challenge: input.codeChallenge,
      code_challenge_method: "S256",
      state: input.state,
      binding_nonce_hash: input.bindingNonceHash,
      expires_at: input.expiresAt,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function getAuthorizationRequest(id: string, admin: Admin = mcpOAuthAdmin()) {
  const { data, error } = await admin
    .from("mcp_oauth_authorization_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function bindAuthorizationUser(
  id: string,
  userId: string,
  admin: Admin = mcpOAuthAdmin(),
) {
  const { data, error } = await admin
    .from("mcp_oauth_authorization_requests")
    .update({ bound_user_id: userId })
    .eq("id", id)
    .is("consumed_at", null)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function consumeAuthorizationRequest(id: string, admin: Admin = mcpOAuthAdmin()) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("mcp_oauth_authorization_requests")
    .update({ consumed_at: now })
    .eq("id", id)
    .is("consumed_at", null)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createGrantAndCode(
  input: {
    clientId: string;
    userId: string;
    workspaceId: string;
    issuer: string;
    resource: string;
    scopes: string[];
    grantExpiresAt: string;
    codeHash: string;
    redirectUri: string;
    codeChallenge: string;
    codeExpiresAt: string;
  },
  admin: Admin = mcpOAuthAdmin(),
) {
  const { data: grant, error: grantError } = await admin
    .from("mcp_oauth_grants")
    .insert({
      client_id: input.clientId,
      user_id: input.userId,
      workspace_id: input.workspaceId,
      issuer: input.issuer,
      resource: input.resource,
      scopes: input.scopes,
      expires_at: input.grantExpiresAt,
    })
    .select("*")
    .single();
  if (grantError) throw grantError;

  const { error: codeError } = await admin.from("mcp_oauth_codes").insert({
    code_hash: input.codeHash,
    grant_id: grant.id,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    resource: input.resource,
    code_challenge: input.codeChallenge,
    expires_at: input.codeExpiresAt,
  });
  if (codeError) throw codeError;

  return grant;
}

export async function redeemCode(
  args: {
    codeHash: string;
    clientId: string;
    redirectUri: string;
    resource: string;
    codeVerifier: string;
    accessTokenHash: string;
    refreshTokenHash: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  },
  admin: Admin = mcpOAuthAdmin(),
) {
  const { data, error } = await admin.rpc("redeem_mcp_oauth_code", {
    _code_hash: args.codeHash,
    _client_id: args.clientId,
    _redirect_uri: args.redirectUri,
    _resource: args.resource,
    _code_verifier: args.codeVerifier,
    _access_token_hash: args.accessTokenHash,
    _refresh_token_hash: args.refreshTokenHash,
    _access_ttl_seconds: args.accessTtlSeconds,
    _refresh_ttl_seconds: args.refreshTtlSeconds,
  });
  if (error) throw error;
  return data as Json;
}

export async function rotateRefresh(
  args: {
    refreshTokenHash: string;
    clientId: string;
    resource: string;
    requestedScopes: string[] | null;
    accessTokenHash: string;
    newRefreshTokenHash: string;
    accessTtlSeconds: number;
    refreshTtlSeconds: number;
  },
  admin: Admin = mcpOAuthAdmin(),
) {
  const { data, error } = await admin.rpc("rotate_mcp_oauth_refresh_token", {
    _refresh_token_hash: args.refreshTokenHash,
    _client_id: args.clientId,
    _resource: args.resource,
    _requested_scopes: args.requestedScopes ?? [],
    _access_token_hash: args.accessTokenHash,
    _new_refresh_token_hash: args.newRefreshTokenHash,
    _access_ttl_seconds: args.accessTtlSeconds,
    _refresh_ttl_seconds: args.refreshTtlSeconds,
  });
  if (error) throw error;
  return data as Json;
}

export async function revokeGrant(
  grantId: string,
  actorUserId: string,
  admin: Admin = mcpOAuthAdmin(),
) {
  const { data, error } = await admin.rpc("revoke_mcp_oauth_grant", {
    _grant_id: grantId,
    _actor_user_id: actorUserId,
  });
  if (error) throw error;
  return data as Json;
}

export async function findAccessToken(tokenHash: string, admin: Admin = mcpOAuthAdmin()) {
  const { data, error } = await admin
    .from("mcp_oauth_tokens")
    .select("*, mcp_oauth_grants(*)")
    .eq("token_hash", tokenHash)
    .eq("kind", "access")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listGrantsForUser(userId: string, admin: Admin = mcpOAuthAdmin()) {
  const { data, error } = await admin
    .from("mcp_oauth_grants")
    .select("*, mcp_oauth_clients(client_name)")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listGrantsForWorkspace(workspaceId: string, admin: Admin = mcpOAuthAdmin()) {
  const { data, error } = await admin
    .from("mcp_oauth_grants")
    .select("*, mcp_oauth_clients(client_name)")
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function listAdminWorkspaces(userId: string, admin: Admin = mcpOAuthAdmin()) {
  const { data, error } = await admin
    .from("workspace_members")
    .select("workspace_id, role, workspaces(id, name)")
    .eq("user_id", userId)
    .eq("role", "admin");
  if (error) throw error;
  return (data ?? []).map((row) => {
    const ws = row.workspaces as { id: string; name: string } | null;
    return { workspaceId: row.workspace_id, name: ws?.name ?? row.workspace_id };
  });
}

export async function writeAudit(
  event: {
    userId?: string | null;
    workspaceId?: string | null;
    grantId?: string | null;
    requestId?: string | null;
    event: string;
    toolName?: string | null;
    targetType?: string | null;
    targetId?: string | null;
    outcome?: string | null;
    durationMs?: number | null;
  },
  admin: Admin = mcpOAuthAdmin(),
) {
  await admin.from("mcp_oauth_audit").insert({
    user_id: event.userId ?? null,
    workspace_id: event.workspaceId ?? null,
    grant_id: event.grantId ?? null,
    request_id: event.requestId ?? null,
    event: event.event,
    tool_name: event.toolName ?? null,
    target_type: event.targetType ?? null,
    target_id: event.targetId ?? null,
    outcome: event.outcome ?? null,
    duration_ms: event.durationMs ?? null,
  });
}

export { sha256Hex };
