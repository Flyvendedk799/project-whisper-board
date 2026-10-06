import {
  DEFAULT_PUBLIC_SCOPES,
  getMcpOAuthConfig,
  MCP_SCOPES,
  type McpOAuthConfig,
} from "./config";

export function protectedResourceMetadata(config: McpOAuthConfig = getMcpOAuthConfig()) {
  return {
    resource: config.resource,
    authorization_servers: [config.issuer],
    scopes_supported: [...DEFAULT_PUBLIC_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "Boared",
  };
}

export function authorizationServerMetadata(config: McpOAuthConfig = getMcpOAuthConfig()) {
  const origin = config.publicOrigin;
  return {
    issuer: config.issuer,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    registration_endpoint: undefined,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    scopes_supported: [...MCP_SCOPES],
    authorization_response_iss_parameter_supported: true,
    resource_indicators_supported: true,
  };
}

export function wwwAuthenticateChallenge(config: McpOAuthConfig = getMcpOAuthConfig()): string {
  const metadata = `${config.publicOrigin}/.well-known/oauth-protected-resource/api/mcp`;
  return `Bearer realm="Boared", resource_metadata="${metadata}", scope="planner:read"`;
}
