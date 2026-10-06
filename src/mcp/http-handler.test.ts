import { afterEach, describe, expect, it, vi } from "vitest";
import { resetMcpOAuthConfig } from "@/lib/mcp-oauth/config";

vi.mock("@/lib/mcp-oauth/tokens", () => ({
  validateAccessToken: vi.fn(async () => null),
}));

import { handleMcpHttp } from "./http-handler";
import { validateAccessToken } from "@/lib/mcp-oauth/tokens";

afterEach(() => {
  resetMcpOAuthConfig();
  vi.mocked(validateAccessToken).mockReset();
  vi.mocked(validateAccessToken).mockResolvedValue(null);
  delete process.env.MCP_ENABLED;
  delete process.env.MCP_PUBLIC_ORIGIN;
  delete process.env.MCP_OAUTH_ISSUER;
  delete process.env.MCP_RESOURCE_URL;
  delete process.env.MCP_ALLOWED_HOSTS;
  delete process.env.MCP_ALLOWED_ORIGINS;
});

function envOn() {
  process.env.MCP_ENABLED = "true";
  process.env.MCP_PUBLIC_ORIGIN = "https://boared.online";
  process.env.MCP_OAUTH_ISSUER = "https://boared.online";
  process.env.MCP_RESOURCE_URL = "https://boared.online/api/mcp";
  process.env.MCP_ALLOWED_HOSTS = "boared.online";
  process.env.MCP_ALLOWED_ORIGINS = "https://boared.online";
  resetMcpOAuthConfig();
}

describe("handleMcpHttp", () => {
  it("returns unavailable when MCP_ENABLED is false", async () => {
    process.env.MCP_ENABLED = "false";
    resetMcpOAuthConfig();
    const res = await handleMcpHttp(
      new Request("https://boared.online/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", host: "boared.online" },
        body: "{}",
      }),
    );
    expect(res.status).toBe(503);
  });

  it("challenges with WWW-Authenticate when no bearer token", async () => {
    envOn();
    const res = await handleMcpHttp(
      new Request("https://boared.online/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", host: "boared.online" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      }),
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("WWW-Authenticate")).toContain("resource_metadata=");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("rejects a disallowed Origin", async () => {
    envOn();
    const res = await handleMcpHttp(
      new Request("https://boared.online/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          host: "boared.online",
          origin: "https://evil.example",
        },
        body: "{}",
      }),
    );
    expect(res.status).toBe(403);
  });

  it("allows OPTIONS preflight without auth", async () => {
    envOn();
    const res = await handleMcpHttp(
      new Request("https://boared.online/api/mcp", {
        method: "OPTIONS",
        headers: { origin: "https://boared.online", host: "boared.online" },
      }),
    );
    expect(res.status).toBe(204);
  });
});
