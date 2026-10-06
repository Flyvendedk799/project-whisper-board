import { createFileRoute } from "@tanstack/react-router";
import { verifyApiKey } from "@/lib/api-auth";
import { allowsPlanner } from "@/lib/api-scopes";
import { apiKeyPrincipal } from "@/lib/integration-principal";
import { handlePlannerRequest } from "@/lib/planner-api";

/**
 * Catch-all /api/planner/*. API-key only — hosted MCP OAuth tokens must not
 * authenticate this route; they go through /api/mcp + in-process handlers.
 */
export const Route = createFileRoute("/api/planner/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => handle(request, params._splat),
      POST: async ({ request, params }) => handle(request, params._splat),
    },
  },
});

async function handle(request: Request, splat?: string) {
  const auth = await verifyApiKey(request.headers.get("authorization"));
  if (!auth) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!allowsPlanner(auth.scopes)) {
    return new Response(JSON.stringify({ error: "Forbidden: requires planner scope" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }
  return handlePlannerRequest(request, apiKeyPrincipal(auth), splat);
}
