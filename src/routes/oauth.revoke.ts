import { createFileRoute } from "@tanstack/react-router";
import { handleRevokeRequest } from "@/lib/mcp-oauth/tokens";

export const Route = createFileRoute("/oauth/revoke")({
  server: {
    handlers: {
      POST: async ({ request }) => handleRevokeRequest(request),
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Authorization, Content-Type",
            "Access-Control-Max-Age": "86400",
          },
        }),
    },
  },
});
