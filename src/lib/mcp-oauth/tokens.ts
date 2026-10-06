import type { IntegrationPrincipal, McpOAuthPrincipal } from "@/lib/integration-principal";
import { isWorkspaceAdmin } from "@/lib/integration-principal";
import { getMcpOAuthConfig } from "./config";
import { authenticateClient } from "./clients";
import { randomToken, sha256Hex } from "./crypto";
import {
  findAccessToken,
  mcpOAuthAdmin,
  redeemCode,
  revokeGrant,
  rotateRefresh,
  writeAudit,
} from "./store";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function oauthJson(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

function oauthError(code: string, status = 400, description?: string): Response {
  return oauthJson(
    description ? { error: code, error_description: description } : { error: code },
    status,
  );
}

export async function handleTokenRequest(request: Request): Promise<Response> {
  const config = getMcpOAuthConfig();
  if (!config.enabled) return oauthError("temporarily_unavailable", 503);

  if (request.method !== "POST") return oauthError("invalid_request", 405);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return oauthError(
      "invalid_request",
      400,
      "token endpoint requires application/x-www-form-urlencoded",
    );
  }

  const raw = await request.text();
  if (raw.length > 64_000) return oauthError("invalid_request", 413);
  const params = new URLSearchParams(raw);
  const grantType = params.get("grant_type");

  const auth = await authenticateClient({
    authHeader: request.headers.get("authorization"),
    bodyClientId: params.get("client_id"),
    bodyClientSecret: params.get("client_secret"),
  });
  if ("error" in auth) return oauthError(auth.error, auth.status);

  if (grantType === "authorization_code") {
    return exchangeAuthorizationCode(params, auth.client.client_id);
  }
  if (grantType === "refresh_token") {
    return exchangeRefreshToken(params, auth.client.client_id);
  }
  return oauthError("unsupported_grant_type");
}

async function exchangeAuthorizationCode(params: URLSearchParams, clientId: string) {
  const config = getMcpOAuthConfig();
  const code = params.get("code")?.trim() ?? "";
  const redirectUri = params.get("redirect_uri")?.trim() ?? "";
  const resource = (params.get("resource")?.trim() || config.resource).replace(/\/+$/, "");
  const verifier = params.get("code_verifier")?.trim() ?? "";

  if (!code || !redirectUri || !verifier) return oauthError("invalid_request");
  if (resource !== config.resource) return oauthError("invalid_target");

  const access = randomToken("access");
  const refresh = randomToken("refresh");

  try {
    const result = asRecord(
      await redeemCode({
        codeHash: sha256Hex(code),
        clientId,
        redirectUri,
        resource,
        codeVerifier: verifier,
        accessTokenHash: access.hash,
        refreshTokenHash: refresh.hash,
        accessTtlSeconds: config.accessTokenTtlSeconds,
        refreshTtlSeconds: config.refreshTokenTtlSeconds,
      }),
    );

    const scopes = Array.isArray(result.scopes) ? (result.scopes as string[]) : [];

    await writeAudit({
      event: "token_issued",
      userId: typeof result.user_id === "string" ? result.user_id : null,
      workspaceId: typeof result.workspace_id === "string" ? result.workspace_id : null,
      grantId: typeof result.grant_id === "string" ? result.grant_id : null,
      outcome: "ok",
    });

    return oauthJson({
      access_token: access.plaintext,
      token_type: "Bearer",
      expires_in: config.accessTokenTtlSeconds,
      refresh_token: refresh.plaintext,
      scope: scopes.join(" "),
      resource: config.resource,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid_grant";
    const code =
      message.includes("invalid_client") || message.includes("access_denied")
        ? message.includes("access_denied")
          ? "access_denied"
          : "invalid_client"
        : "invalid_grant";
    return oauthError(code, code === "invalid_client" ? 401 : 400);
  }
}

async function exchangeRefreshToken(params: URLSearchParams, clientId: string) {
  const config = getMcpOAuthConfig();
  const refreshToken = params.get("refresh_token")?.trim() ?? "";
  const resource = (params.get("resource")?.trim() || config.resource).replace(/\/+$/, "");
  const scopeRaw = params.get("scope");
  const requested = scopeRaw
    ? scopeRaw
        .split(/[\s+]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    : null;

  if (!refreshToken) return oauthError("invalid_request");
  if (resource !== config.resource) return oauthError("invalid_target");

  const access = randomToken("access");
  const refresh = randomToken("refresh");

  try {
    const result = asRecord(
      await rotateRefresh({
        refreshTokenHash: sha256Hex(refreshToken),
        clientId,
        resource,
        requestedScopes: requested,
        accessTokenHash: access.hash,
        newRefreshTokenHash: refresh.hash,
        accessTtlSeconds: config.accessTokenTtlSeconds,
        refreshTtlSeconds: config.refreshTokenTtlSeconds,
      }),
    );
    const scopes = Array.isArray(result.scopes) ? (result.scopes as string[]) : [];

    await writeAudit({
      event: "token_refreshed",
      userId: typeof result.user_id === "string" ? result.user_id : null,
      workspaceId: typeof result.workspace_id === "string" ? result.workspace_id : null,
      grantId: typeof result.grant_id === "string" ? result.grant_id : null,
      outcome: "ok",
    });

    return oauthJson({
      access_token: access.plaintext,
      token_type: "Bearer",
      expires_in: config.accessTokenTtlSeconds,
      refresh_token: refresh.plaintext,
      scope: scopes.join(" "),
      resource: config.resource,
    });
  } catch {
    return oauthError("invalid_grant");
  }
}

export async function handleRevokeRequest(request: Request): Promise<Response> {
  const config = getMcpOAuthConfig();
  if (!config.enabled) return oauthError("temporarily_unavailable", 503);
  if (request.method !== "POST") return oauthError("invalid_request", 405);

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return oauthError("invalid_request", 400);
  }
  const raw = await request.text();
  if (raw.length > 64_000) return oauthError("invalid_request", 413);
  const params = new URLSearchParams(raw);

  const auth = await authenticateClient({
    authHeader: request.headers.get("authorization"),
    bodyClientId: params.get("client_id"),
    bodyClientSecret: params.get("client_secret"),
  });
  if ("error" in auth) return oauthError(auth.error, auth.status);

  const token = params.get("token")?.trim() ?? "";
  if (!token) {
    // RFC 7009: always 200
    return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
  }

  const admin = mcpOAuthAdmin();
  const hash = sha256Hex(token);
  const { data: row } = await admin
    .from("mcp_oauth_tokens")
    .select("id, grant_id, mcp_oauth_grants(client_id, user_id)")
    .eq("token_hash", hash)
    .maybeSingle();

  if (row) {
    const grant = row.mcp_oauth_grants as { client_id: string; user_id: string } | null;
    if (grant && grant.client_id === auth.client.client_id) {
      await revokeGrant(row.grant_id, grant.user_id, admin);
      await writeAudit({
        event: "token_revoked",
        userId: grant.user_id,
        grantId: row.grant_id,
        outcome: "ok",
      });
    }
  }

  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}

/**
 * Validate a hosted MCP access token and return a frozen mcp_oauth principal.
 * Refresh tokens, API keys, and Supabase JWTs are rejected.
 */
export async function validateAccessToken(
  bearer: string | null,
): Promise<IntegrationPrincipal | null> {
  if (!bearer || !bearer.startsWith("Bearer ")) return null;
  const token = bearer.slice(7).trim();
  if (!token.startsWith("bmc_at_")) return null;

  const config = getMcpOAuthConfig();
  if (!config.enabled) return null;

  let row;
  try {
    row = await findAccessToken(sha256Hex(token));
  } catch {
    return null; // fail closed on DB uncertainty
  }
  if (!row) return null;
  if (row.revoked_at || row.consumed_at) return null;
  const now = Date.now();
  if (new Date(row.not_before).getTime() > now) return null;
  if (new Date(row.expires_at).getTime() <= now) return null;

  const grant = row.mcp_oauth_grants as {
    id: string;
    client_id: string;
    user_id: string;
    workspace_id: string;
    issuer: string;
    resource: string;
    scopes: string[];
    revoked_at: string | null;
    expires_at: string;
  } | null;

  if (!grant || grant.revoked_at || new Date(grant.expires_at).getTime() <= now) return null;
  if (grant.issuer !== config.issuer || grant.resource !== config.resource) return null;

  const client = await (await import("./store")).getClient(grant.client_id);
  if (!client || client.disabled_at) return null;

  const admin = mcpOAuthAdmin();
  // Recheck admin membership on every request (role change ≠ membership delete).
  if (!(await isWorkspaceAdmin(grant.workspace_id, grant.user_id, admin))) return null;

  void admin
    .from("mcp_oauth_grants")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", grant.id);

  const principal: McpOAuthPrincipal = {
    kind: "mcp_oauth",
    grantId: grant.id,
    clientId: grant.client_id,
    workspaceId: grant.workspace_id,
    userId: grant.user_id,
    scopes: [...row.scopes],
  };
  return Object.freeze(principal);
}
