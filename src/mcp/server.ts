/**
 * Stdio entry for the Boared planner MCP server (`npm run mcp`).
 * Hosted HTTP uses createPlannerMcpServer + in-process ports instead.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPlannerMcpServer } from "./create-server";
import { createStdioToolPorts, loadStdioEnv } from "./stdio-client";

loadStdioEnv();

const { server } = createPlannerMcpServer(createStdioToolPorts());

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Boared Planner MCP server running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
