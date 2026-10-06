/**
 * Canonical hosted MCP OAuth configuration.
 * Origin / issuer / resource come from server env only — never from Host or X-Forwarded-Host.
 */

export const MCP_SCOPES = [
  "planner:read",
  "planner:write",
  "account:read",
  "account:write",
  "github:read",
  "github:write",
  "github:merge",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

export const DEFAULT_PUBLIC_SCOPES: readonly McpScope[] = ["planner:read"];

export const CODE_TTL_SECONDS = 5 * 60;
export const AUTH_REQUEST_TTL_SECONDS = 10 * 60;
export const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60;
export const DEFAULT_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;
export const DEFAULT_GRANT_TTL_SECONDS = 90 * 24 * 60 * 60;

export const TOKEN_PREFIX = {
  code: "bmc_code_",
  access: "bmc_at_",
  refresh: "bmc_rt_",
} as const;

export const BINDING_COOKIE = "boared_mcp_oauth_txn";

export interface McpOAuthConfig {
  enabled: boolean;
  publicOrigin: string;
  issuer: string;
  resource: string;
  allowedHosts: readonly string[];
  allowedOrigins: readonly string[];
  accessTokenTtlSeconds: number;
  refreshTokenTtlSeconds: number;
  grantTtlSeconds: number;
  clientId: string | null;
  clientName: string;
  redirectUris: readonly string[];
  clientSecret: string | null;
  authMethod: "none" | "client_secret_basic" | "client_secret_post";
  allowedScopes: readonly string[];
}

function requireAbsoluteHttpsOrHttp(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL (got ${JSON.stringify(value)})`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${name} must be http(s)`);
  }
  if (url.username || url.password) {
    throw new Error(`${name} must not include credentials`);
  }
  return value.replace(/\/+$/, "");
}

function parseCsv(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseIntBounded(
  name: string,
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return n;
}

let cached: McpOAuthConfig | null = null;

/** Load and validate MCP OAuth config from process.env. Safe to call repeatedly. */
export function getMcpOAuthConfig(env: NodeJS.ProcessEnv = process.env): McpOAuthConfig {
  if (cached && env === process.env) return cached;

  const enabled = (env.MCP_ENABLED ?? "false").toLowerCase() === "true";
  const publicOrigin = requireAbsoluteHttpsOrHttp(
    "MCP_PUBLIC_ORIGIN",
    env.MCP_PUBLIC_ORIGIN?.trim() || "https://boared.online",
  );
  const issuer = requireAbsoluteHttpsOrHttp(
    "MCP_OAUTH_ISSUER",
    env.MCP_OAUTH_ISSUER?.trim() || publicOrigin,
  );
  const resource = requireAbsoluteHttpsOrHttp(
    "MCP_RESOURCE_URL",
    env.MCP_RESOURCE_URL?.trim() || `${publicOrigin}/api/mcp`,
  );

  const allowedHosts = parseCsv(env.MCP_ALLOWED_HOSTS);
  const allowedOrigins = parseCsv(env.MCP_ALLOWED_ORIGINS).map((o) =>
    requireAbsoluteHttpsOrHttp("MCP_ALLOWED_ORIGINS entry", o),
  );

  const hosts = allowedHosts.length > 0 ? allowedHosts : [new URL(publicOrigin).host];
  const origins = allowedOrigins.length > 0 ? allowedOrigins : [publicOrigin];

  const redirectUris = parseCsv(env.MCP_OAUTH_REDIRECT_URIS);
  const clientId = env.MCP_OAUTH_CLIENT_ID?.trim() || null;
  const clientSecret = env.MCP_OAUTH_CLIENT_SECRET?.trim() || null;
  const authMethodRaw = (
    env.MCP_OAUTH_CLIENT_AUTH_METHOD ?? (clientSecret ? "client_secret_post" : "none")
  ).trim();
  if (
    authMethodRaw !== "none" &&
    authMethodRaw !== "client_secret_basic" &&
    authMethodRaw !== "client_secret_post"
  ) {
    throw new Error(
      "MCP_OAUTH_CLIENT_AUTH_METHOD must be none | client_secret_basic | client_secret_post",
    );
  }
  if (authMethodRaw === "none" && clientSecret) {
    throw new Error("MCP_OAUTH_CLIENT_SECRET set but auth method is none");
  }
  if (authMethodRaw !== "none" && !clientSecret) {
    throw new Error("Confidential client requires MCP_OAUTH_CLIENT_SECRET");
  }

  const allowedScopes = parseCsv(env.MCP_OAUTH_ALLOWED_SCOPES);
  const scopes = allowedScopes.length > 0 ? allowedScopes : [...MCP_SCOPES];

  const config: McpOAuthConfig = {
    enabled,
    publicOrigin,
    issuer,
    resource,
    allowedHosts: hosts,
    allowedOrigins: origins,
    accessTokenTtlSeconds: parseIntBounded(
      "MCP_ACCESS_TOKEN_TTL_SECONDS",
      env.MCP_ACCESS_TOKEN_TTL_SECONDS,
      DEFAULT_ACCESS_TTL_SECONDS,
      60,
      3600,
    ),
    refreshTokenTtlSeconds: parseIntBounded(
      "MCP_REFRESH_TOKEN_TTL_SECONDS",
      env.MCP_REFRESH_TOKEN_TTL_SECONDS,
      DEFAULT_REFRESH_TTL_SECONDS,
      3600,
      7776000,
    ),
    grantTtlSeconds: parseIntBounded(
      "MCP_GRANT_TTL_SECONDS",
      env.MCP_GRANT_TTL_SECONDS,
      DEFAULT_GRANT_TTL_SECONDS,
      86400,
      31536000,
    ),
    clientId,
    clientName: env.MCP_OAUTH_CLIENT_NAME?.trim() || "MCP client",
    redirectUris,
    clientSecret,
    authMethod: authMethodRaw,
    allowedScopes: scopes,
  };

  if (env === process.env) cached = config;
  return config;
}

/** Test seam: drop the cached config. */
export function resetMcpOAuthConfig() {
  cached = null;
}

export function resourceMetadataUrl(config: McpOAuthConfig = getMcpOAuthConfig()): string {
  return `${config.publicOrigin}/.well-known/oauth-protected-resource/api/mcp`;
}

export function isAllowedHost(host: string, config: McpOAuthConfig = getMcpOAuthConfig()): boolean {
  const bare = host.split(":")[0]?.toLowerCase() ?? "";
  const full = host.toLowerCase();
  return config.allowedHosts.some((h) => {
    const want = h.toLowerCase();
    return want === full || want === bare || want === `${bare}:443` || want === `${bare}:80`;
  });
}

export function isAllowedOrigin(
  origin: string,
  config: McpOAuthConfig = getMcpOAuthConfig(),
): boolean {
  return config.allowedOrigins.includes(origin.replace(/\/+$/, ""));
}
