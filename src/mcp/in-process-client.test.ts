import { describe, expect, it } from "vitest";
import { createInProcessPorts } from "./in-process-client";
import { createPlannerMcpServer } from "./create-server";
import type { McpOAuthPrincipal } from "@/lib/integration-principal";

const oauthPrincipal: McpOAuthPrincipal = {
  kind: "mcp_oauth",
  grantId: "g1",
  clientId: "c1",
  workspaceId: "00000000-0000-0000-0000-000000000001",
  userId: "00000000-0000-0000-0000-000000000002",
  scopes: ["planner:read"],
};

describe("in-process MCP ports", () => {
  it("builds http-mode ports without local upload or claim memory", () => {
    const ports = createInProcessPorts(oauthPrincipal);
    expect(ports.mode).toBe("http");
    expect(ports.readLocalUpload).toBeUndefined();
    ports.rememberClaim("agent-1");
    expect(ports.resolveAgent()).toBeUndefined();
    expect(ports.resolveAgent("agent-9")).toBe("agent-9");
  });

  it("registers the same tools as stdio via createPlannerMcpServer", () => {
    const { registeredTools } = createPlannerMcpServer(createInProcessPorts(oauthPrincipal));
    expect(registeredTools).toContain("claim_task");
    expect(registeredTools).toContain("get_workspace");
    expect(new Set(registeredTools).size).toBe(registeredTools.length);
  });
});
