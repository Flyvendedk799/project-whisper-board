import { assertHostedMcpAdminGrant } from "@/lib/integration-principal";
import {
  AUTH_REQUEST_TTL_SECONDS,
  BINDING_COOKIE,
  CODE_TTL_SECONDS,
  getMcpOAuthConfig,
  MCP_SCOPES,
  type McpScope,
} from "./config";
import { exactRedirectMatch } from "./clients";
import { randomNonce, randomToken, sha256Hex } from "./crypto";
import {
  bindAuthorizationUser,
  consumeAuthorizationRequest,
  createGrantAndCode,
  getAuthorizationRequest,
  getClient,
  insertAuthorizationRequest,
  listAdminWorkspaces,
  writeAudit,
} from "./store";

export class OAuthError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "OAuthError";
  }
}

const SCOPE_SET = new Set<string>(MCP_SCOPES);

export function parseScopeList(raw: string | null | undefined): string[] {
  if (!raw || !raw.trim()) return ["planner:read"];
  return [
    ...new Set(
      raw
        .split(/[\s+]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}

export function validateScopes(
  requested: string[],
  allowed: readonly string[],
): { ok: true; scopes: string[] } | { ok: false; error: string } {
  if (requested.length === 0) return { ok: false, error: "invalid_scope" };
  for (const scope of requested) {
    if (!SCOPE_SET.has(scope) && !allowed.includes(scope)) {
      return { ok: false, error: "invalid_scope" };
    }
    if (!allowed.includes(scope)) return { ok: false, error: "invalid_scope" };
  }
  // Write scopes require corresponding reads
  const set = new Set(requested);
  const pairs: Array<[string, string]> = [
    ["planner:write", "planner:read"],
    ["account:write", "account:read"],
    ["github:write", "github:read"],
    ["github:merge", "github:read"],
  ];
  for (const [write, read] of pairs) {
    if (set.has(write) && !set.has(read)) set.add(read);
  }
  return { ok: true, scopes: [...set] };
}

export interface AuthorizeQuery {
  client_id: string | null;
  redirect_uri: string | null;
  response_type: string | null;
  scope: string | null;
  state: string | null;
  code_challenge: string | null;
  code_challenge_method: string | null;
  resource: string | null;
}

/**
 * Validate an /oauth/authorize request before login.
 * On success returns a pending txn id + Set-Cookie for the binding nonce.
 * Never redirects to an invalid redirect_uri — returns a local error instead.
 */
export async function beginAuthorization(query: AuthorizeQuery): Promise<
  | {
      ok: true;
      requestId: string;
      consentPath: string;
      cookie: { name: string; value: string; maxAge: number };
    }
  | { ok: false; error: string; status: number; redirectTo?: string }
> {
  const config = getMcpOAuthConfig();
  if (!config.enabled) {
    return { ok: false, error: "temporarily_unavailable", status: 503 };
  }

  const clientId = query.client_id?.trim() ?? "";
  const redirectUri = query.redirect_uri?.trim() ?? "";
  const responseType = query.response_type?.trim() ?? "";
  const codeChallenge = query.code_challenge?.trim() ?? "";
  const method = query.code_challenge_method?.trim() || "S256";
  const resource = (query.resource?.trim() || config.resource).replace(/\/+$/, "");
  const state = query.state ?? null;

  if (!clientId || !redirectUri) {
    return { ok: false, error: "invalid_request", status: 400 };
  }

  const client = await getClient(clientId);
  if (!client || client.disabled_at) {
    return { ok: false, error: "invalid_client", status: 400 };
  }

  if (!exactRedirectMatch(client, redirectUri)) {
    // Spec: do not redirect to unregistered URI
    return { ok: false, error: "invalid_request", status: 400 };
  }

  const failRedirect = (error: string, description?: string) => {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    if (description) url.searchParams.set("error_description", description);
    if (state) url.searchParams.set("state", state);
    url.searchParams.set("iss", config.issuer);
    return { ok: false as const, error, status: 302, redirectTo: url.toString() };
  };

  if (responseType !== "code") return failRedirect("unsupported_response_type");
  if (method !== "S256") return failRedirect("invalid_request", "PKCE S256 required");
  if (!codeChallenge || codeChallenge.length < 43) {
    return failRedirect("invalid_request", "code_challenge required");
  }
  if (resource !== config.resource) {
    return failRedirect("invalid_target", "resource must be the Boared MCP resource");
  }
  if (state !== null && state.length > 512) {
    return failRedirect("invalid_request", "state too long");
  }

  const requested = parseScopeList(query.scope);
  const scopes = validateScopes(requested, client.allowed_scopes);
  if (!scopes.ok) return failRedirect("invalid_scope");

  const nonce = randomNonce();
  const expiresAt = new Date(Date.now() + AUTH_REQUEST_TTL_SECONDS * 1000).toISOString();
  const row = await insertAuthorizationRequest({
    clientId,
    redirectUri,
    resource,
    requestedScopes: scopes.scopes,
    codeChallenge,
    state,
    bindingNonceHash: nonce.hash,
    expiresAt,
  });

  await writeAudit({
    event: "authorize_started",
    requestId: row.id,
    outcome: "ok",
  });

  return {
    ok: true,
    requestId: row.id,
    consentPath: `/oauth/consent?request_id=${encodeURIComponent(row.id)}`,
    cookie: {
      name: BINDING_COOKIE,
      value: nonce.plaintext,
      maxAge: AUTH_REQUEST_TTL_SECONDS,
    },
  };
}

export async function loadConsentContext(input: {
  requestId: string;
  bindingCookie: string | undefined;
  userId: string;
}) {
  const config = getMcpOAuthConfig();
  const row = await getAuthorizationRequest(input.requestId);
  if (!row || row.consumed_at || new Date(row.expires_at).getTime() <= Date.now()) {
    throw new OAuthError("invalid_request", "Authorization request expired or unknown", 400);
  }
  if (!input.bindingCookie || sha256Hex(input.bindingCookie) !== row.binding_nonce_hash) {
    throw new OAuthError("invalid_request", "Browser binding mismatch", 400);
  }

  const client = await getClient(row.client_id);
  if (!client || client.disabled_at) {
    throw new OAuthError("invalid_client", "Client disabled", 400);
  }

  await bindAuthorizationUser(row.id, input.userId);
  const workspaces = await listAdminWorkspaces(input.userId);

  return {
    request: row,
    client,
    workspaces,
    scopes: row.requested_scopes as McpScope[],
    issuer: config.issuer,
    resource: row.resource,
  };
}

export async function approveConsent(input: {
  requestId: string;
  bindingCookie: string | undefined;
  userId: string;
  workspaceId: string;
  scopes: string[];
}): Promise<{ redirectTo: string }> {
  const config = getMcpOAuthConfig();
  const ctx = await loadConsentContext({
    requestId: input.requestId,
    bindingCookie: input.bindingCookie,
    userId: input.userId,
  });

  if (!ctx.workspaces.some((w) => w.workspaceId === input.workspaceId)) {
    throw new OAuthError("access_denied", "Admin membership required for that workspace", 403);
  }
  try {
    await assertHostedMcpAdminGrant(input.workspaceId, input.userId);
  } catch {
    throw new OAuthError("access_denied", "Admin membership required for that workspace", 403);
  }

  const narrowed = validateScopes(input.scopes, ctx.request.requested_scopes);
  if (!narrowed.ok) throw new OAuthError("invalid_scope", "Cannot expand scopes", 400);
  // Must be subset of requested
  for (const s of narrowed.scopes) {
    if (!ctx.request.requested_scopes.includes(s)) {
      throw new OAuthError("invalid_scope", "Cannot expand scopes", 400);
    }
  }

  const consumed = await consumeAuthorizationRequest(input.requestId);
  if (!consumed) throw new OAuthError("invalid_request", "Authorization already used", 400);

  const code = randomToken("code");
  const grantExpires = new Date(Date.now() + config.grantTtlSeconds * 1000).toISOString();
  const codeExpires = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();

  await createGrantAndCode({
    clientId: ctx.client.client_id,
    userId: input.userId,
    workspaceId: input.workspaceId,
    issuer: config.issuer,
    resource: ctx.request.resource,
    scopes: narrowed.scopes,
    grantExpiresAt: grantExpires,
    codeHash: code.hash,
    redirectUri: ctx.request.redirect_uri,
    codeChallenge: ctx.request.code_challenge,
    codeExpiresAt: codeExpires,
  });

  const url = new URL(ctx.request.redirect_uri);
  url.searchParams.set("code", code.plaintext);
  if (ctx.request.state) url.searchParams.set("state", ctx.request.state);
  url.searchParams.set("iss", config.issuer);

  await writeAudit({
    event: "consent_approved",
    userId: input.userId,
    workspaceId: input.workspaceId,
    requestId: input.requestId,
    outcome: "ok",
  });

  return { redirectTo: url.toString() };
}

export async function cancelConsent(input: {
  requestId: string;
  bindingCookie: string | undefined;
  userId: string;
}): Promise<{ redirectTo: string }> {
  const config = getMcpOAuthConfig();
  const row = await getAuthorizationRequest(input.requestId);
  if (!row) throw new OAuthError("invalid_request", "Unknown request", 400);
  if (!input.bindingCookie || sha256Hex(input.bindingCookie) !== row.binding_nonce_hash) {
    throw new OAuthError("invalid_request", "Browser binding mismatch", 400);
  }
  await consumeAuthorizationRequest(input.requestId);

  const url = new URL(row.redirect_uri);
  url.searchParams.set("error", "access_denied");
  if (row.state) url.searchParams.set("state", row.state);
  url.searchParams.set("iss", config.issuer);

  await writeAudit({
    event: "consent_cancelled",
    userId: input.userId,
    requestId: input.requestId,
    outcome: "access_denied",
  });

  return { redirectTo: url.toString() };
}
