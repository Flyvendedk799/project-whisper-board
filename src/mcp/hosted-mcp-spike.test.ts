import { describe, expect, it } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

/**
 * Compile/import smoke for the hosted MCP transport assumptions.
 * No network, no credentials, no listen().
 */
describe("hosted MCP SDK 1.30.0 spike", () => {
  it("imports WebStandardStreamableHTTPServerTransport", () => {
    expect(typeof WebStandardStreamableHTTPServerTransport).toBe("function");
  });

  it("constructs a stateless JSON-response transport", () => {
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    expect(transport.sessionId).toBeUndefined();
  });

  it("can connect an McpServer to that transport without starting a listener", async () => {
    const server = new McpServer({ name: "spike", version: "0.0.0" });
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    await transport.close();
    await server.close();
  });
});
