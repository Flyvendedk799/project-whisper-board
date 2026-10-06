import { authorizationServerMetadata, protectedResourceMetadata } from "./metadata";
import { getMcpOAuthConfig } from "./config";

/**
 * Dispatch well-known OAuth discovery paths.
 * Called at the top of src/server.ts so literal-dot paths work without routeTree hacks.
 */
export function handleMcpOAuthDiscovery(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;

  let pathname: string;
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return null;
  }

  const config = getMcpOAuthConfig();

  if (
    pathname === "/.well-known/oauth-protected-resource/api/mcp" ||
    pathname === "/.well-known/oauth-protected-resource"
  ) {
    return Response.json(protectedResourceMetadata(config), {
      headers: {
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  if (pathname === "/.well-known/oauth-authorization-server") {
    return Response.json(authorizationServerMetadata(config), {
      headers: {
        "Cache-Control": "public, max-age=60",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  return null;
}
