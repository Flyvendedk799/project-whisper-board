import { describe, expect, it } from "vitest";
import {
  apiKeyPrincipal,
  isApiKeyPrincipal,
  isMcpOAuthPrincipal,
  principalAsKeyContext,
  principalScopes,
  principalUserId,
  principalWorkspaceId,
  type McpOAuthPrincipal,
} from "./integration-principal";

describe("integration principal", () => {
  it("builds an api_key principal from verifyApiKey shape", () => {
    const p = apiKeyPrincipal({
      keyId: "k1",
      workspaceId: "w1",
      scopes: ["planner", "account"],
      userId: "u1",
    });
    expect(isApiKeyPrincipal(p)).toBe(true);
    expect(isMcpOAuthPrincipal(p)).toBe(false);
    expect(principalWorkspaceId(p)).toBe("w1");
    expect(principalUserId(p)).toBe("u1");
    expect(principalScopes(p)).toEqual(["planner", "account"]);
    expect(principalAsKeyContext(p)).toEqual({ workspaceId: "w1", userId: "u1" });
  });

  it("discriminates mcp_oauth", () => {
    const p: McpOAuthPrincipal = {
      kind: "mcp_oauth",
      grantId: "g1",
      clientId: "c1",
      workspaceId: "w1",
      userId: "u1",
      scopes: ["planner:read"],
    };
    expect(isMcpOAuthPrincipal(p)).toBe(true);
    expect(isApiKeyPrincipal(p)).toBe(false);
    expect(principalUserId(p)).toBe("u1");
  });
});
