import { describe, expect, it } from "vitest";
import { parseScopeList, validateScopes } from "./authorization";
import { isSafeInternalPath } from "./utils";
import { exactRedirectMatch } from "./clients";
import { pkceChallengeS256 } from "./crypto";
import { authorizationServerMetadata, protectedResourceMetadata } from "./metadata";
import type { McpOAuthConfig } from "./config";

const baseConfig: McpOAuthConfig = {
  enabled: true,
  publicOrigin: "https://boared.online",
  issuer: "https://boared.online",
  resource: "https://boared.online/api/mcp",
  allowedHosts: ["boared.online"],
  allowedOrigins: ["https://boared.online"],
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 2592000,
  grantTtlSeconds: 7776000,
  clientId: null,
  clientName: "x",
  redirectUris: [],
  clientSecret: null,
  authMethod: "none",
  allowedScopes: ["planner:read"],
};

describe("isSafeInternalPath", () => {
  it("accepts normalized internal paths", () => {
    expect(isSafeInternalPath("/oauth/consent?request_id=x")).toBe(true);
    expect(isSafeInternalPath("/app/agents")).toBe(true);
  });

  it("rejects protocol-relative and external redirects", () => {
    expect(isSafeInternalPath("//evil.example")).toBe(false);
    expect(isSafeInternalPath("/\\evil")).toBe(false);
    expect(isSafeInternalPath("https://evil.example")).toBe(false);
  });
});

describe("scopes + PKCE + redirects + metadata", () => {
  it("auto-adds reads for writes", () => {
    const result = validateScopes(["planner:write"], ["planner:read", "planner:write"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.scopes).toContain("planner:read");
    expect(parseScopeList("")).toEqual(["planner:read"]);
  });

  it("matches RFC 7636 S256 example", () => {
    expect(pkceChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("requires exact redirect URIs", () => {
    const client = {
      redirect_uris: ["https://cursor.com/callback"],
    } as Parameters<typeof exactRedirectMatch>[0];
    expect(exactRedirectMatch(client, "https://cursor.com/callback")).toBe(true);
    expect(exactRedirectMatch(client, "https://cursor.com/callback/")).toBe(false);
  });

  it("PR metadata advertises only basic read; AS includes full grants", () => {
    expect(protectedResourceMetadata(baseConfig).scopes_supported).toEqual(["planner:read"]);
    const as = authorizationServerMetadata(baseConfig);
    expect(as.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
  });
});
