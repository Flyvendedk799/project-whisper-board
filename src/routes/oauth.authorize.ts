import { createFileRoute } from "@tanstack/react-router";
import { beginAuthorization } from "@/lib/mcp-oauth/authorization";

function cookieHeader(name: string, value: string, maxAge: number): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  return parts.join("; ");
}

export const Route = createFileRoute("/oauth/authorize")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const result = await beginAuthorization({
          client_id: url.searchParams.get("client_id"),
          redirect_uri: url.searchParams.get("redirect_uri"),
          response_type: url.searchParams.get("response_type"),
          scope: url.searchParams.get("scope"),
          state: url.searchParams.get("state"),
          code_challenge: url.searchParams.get("code_challenge"),
          code_challenge_method: url.searchParams.get("code_challenge_method"),
          resource: url.searchParams.get("resource"),
        });

        if (!result.ok) {
          if (result.redirectTo) {
            return Response.redirect(result.redirectTo, 302);
          }
          return Response.json(
            { error: result.error },
            { status: result.status, headers: { "Cache-Control": "no-store" } },
          );
        }

        const headers = new Headers({
          Location: result.consentPath,
          "Cache-Control": "no-store",
          "Set-Cookie": cookieHeader(result.cookie.name, result.cookie.value, result.cookie.maxAge),
        });
        return new Response(null, { status: 302, headers });
      },
    },
  },
});
