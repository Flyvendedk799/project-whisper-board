import { afterEach, describe, expect, it } from "vitest";
import {
  getMcpOAuthConfig,
  isAllowedHost,
  isAllowedOrigin,
  resetMcpOAuthConfig,
  resourceMetadataUrl,
} from "./config";

afterEach(() => {
  resetMcpOAuthConfig();
});

describe("getMcpOAuthConfig", () => {
  it("uses canonical defaults when env is sparse", () => {
    const config = getMcpOAuthConfig({ MCP_ENABLED: "false" } as NodeJS.ProcessEnv);
    expect(config.enabled).toBe(false);
    expect(config.publicOrigin).toBe("https://boared.online");
    expect(config.issuer).toBe("https://boared.online");
    expect(config.resource).toBe("https://boared.online/api/mcp");
    expect(config.accessTokenTtlSeconds).toBe(900);
  });

  it("rejects non-absolute origins (never derive from Host)", () => {
    expect(() =>
      getMcpOAuthConfig({ MCP_PUBLIC_ORIGIN: "boared.online" } as NodeJS.ProcessEnv),
    ).toThrow(/absolute URL/);
  });

  it("validates allowed hosts and origins", () => {
    const config = getMcpOAuthConfig({
      MCP_PUBLIC_ORIGIN: "https://boared.online",
      MCP_ALLOWED_HOSTS: "boared.online",
      MCP_ALLOWED_ORIGINS: "https://boared.online",
    } as NodeJS.ProcessEnv);
    expect(isAllowedHost("boared.online", config)).toBe(true);
    expect(isAllowedHost("evil.example", config)).toBe(false);
    expect(isAllowedOrigin("https://boared.online", config)).toBe(true);
    expect(isAllowedOrigin("https://evil.example", config)).toBe(false);
    expect(resourceMetadataUrl(config)).toContain("/.well-known/oauth-protected-resource/api/mcp");
  });
});
