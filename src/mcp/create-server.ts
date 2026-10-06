/**
 * Build a planner MCP server from injected ports.
 * No dotenv, no process.exit, no transport connect — callers own those.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_INSTRUCTIONS } from "./agent-guide";
import type { PlannerToolPorts } from "./ports";
import { registerPlannerTools } from "./register-tools";

export type CreatePlannerMcpServerResult = {
  server: McpServer;
  /** Tool names registered on this server instance. */
  registeredTools: string[];
};

export function createPlannerMcpServer(deps: PlannerToolPorts): CreatePlannerMcpServerResult {
  const server = new McpServer(
    { name: "consflow-planner", version: "2.1.0" },
    { instructions: MCP_INSTRUCTIONS },
  );
  const registeredTools = registerPlannerTools(server, deps);
  return { server, registeredTools };
}
