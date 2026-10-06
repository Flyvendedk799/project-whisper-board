import { createFileRoute } from "@tanstack/react-router";
import { handleMcpHttp } from "@/mcp/http-handler";

export const Route = createFileRoute("/api/mcp")({
  server: {
    handlers: {
      GET: async ({ request }) => handleMcpHttp(request),
      POST: async ({ request }) => handleMcpHttp(request),
      DELETE: async ({ request }) => handleMcpHttp(request),
      OPTIONS: async ({ request }) => handleMcpHttp(request),
    },
  },
});
