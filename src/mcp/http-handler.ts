/**
 * Authenticated Streamable HTTP MCP endpoint handler.
 * Fresh server + WebStandardStreamableHTTPServerTransport per request (stateless).
 */
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { getMcpOAuthConfig, isAllowedHost, isAllowedOrigin } from "@/lib/mcp-oauth/config";
import { wwwAuthenticateChallenge } from "@/lib/mcp-oauth/metadata";
import { validateAccessToken } from "@/lib/mcp-oauth/tokens";
import { createPlannerMcpServer } from "@/mcp/create-server";
import { createInProcessPorts } from "@/mcp/in-process-client";
import { assertHostedToolAllowed, InsufficientScopeError } from "@/mcp/tool-policy";

const MAX_BODY_BYTES = 12 * 1024 * 1024; // 12 MiB MCP envelope cap
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;

type RateBucket = { count: number; resetAt: number };
const rateByIp = new Map<string, RateBucket>();

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function rateLimit(ip: string): boolean {
  const now = Date.now();
  let bucket = rateByIp.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    rateByIp.set(ip, bucket);
  }
  bucket.count += 1;
  return bucket.count <= RATE_MAX;
}

function jsonError(
  status: number,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
  });
}

function unauthorized(): Response {
  return jsonError(
    401,
    { error: "unauthorized", error_description: "Bearer MCP access token required" },
    { "WWW-Authenticate": wwwAuthenticateChallenge() },
  );
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (origin && isAllowedOrigin(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, Mcp-Session-Id",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
  }
  return {};
}

async function readBodyCapped(
  request: Request,
): Promise<{ raw: string; parsed: unknown } | Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (request.method === "POST" && contentType && !contentType.includes("application/json")) {
    return jsonError(415, { error: "unsupported_media_type" });
  }

  const reader = request.body?.getReader();
  if (!reader) return { raw: "", parsed: undefined };

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        return jsonError(413, { error: "payload_too_large", max_bytes: MAX_BODY_BYTES });
      }
      chunks.push(value);
    }
  }
  const raw = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
  if (!raw) return { raw: "", parsed: undefined };
  try {
    return { raw, parsed: JSON.parse(raw) as unknown };
  } catch {
    return jsonError(400, { error: "invalid_json" });
  }
}

function extractToolCall(parsed: unknown): { name: string; args: Record<string, unknown> } | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const msg = parsed as Record<string, unknown>;
  if (msg.method !== "tools/call") return null;
  const params = msg.params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return null;
  const p = params as Record<string, unknown>;
  if (typeof p.name !== "string") return null;
  const args =
    p.arguments && typeof p.arguments === "object" && !Array.isArray(p.arguments)
      ? (p.arguments as Record<string, unknown>)
      : {};
  return { name: p.name, args };
}

/**
 * handleMcpHttp — order from COMMITS-3-6.md.
 * Does not use stdio singleton or PLANNER_API_KEY.
 */
export async function handleMcpHttp(request: Request): Promise<Response> {
  const cors = corsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...cors, "Cache-Control": "no-store" } });
  }

  if (request.method === "GET" || request.method === "DELETE") {
    return jsonError(405, { error: "method_not_allowed" }, { ...cors, Allow: "POST, OPTIONS" });
  }

  if (request.method !== "POST") {
    return jsonError(405, { error: "method_not_allowed" }, cors);
  }

  const config = getMcpOAuthConfig();
  if (!config.enabled) {
    return jsonError(
      503,
      { error: "mcp_unavailable", error_description: "Hosted MCP is disabled" },
      cors,
    );
  }

  const host = request.headers.get("host");
  if (host && !isAllowedHost(host)) {
    return jsonError(403, { error: "forbidden_host" }, cors);
  }

  const origin = request.headers.get("origin");
  if (origin && !isAllowedOrigin(origin)) {
    return jsonError(403, { error: "forbidden_origin" }, cors);
  }

  if (!rateLimit(clientIp(request))) {
    return jsonError(429, { error: "rate_limited" }, cors);
  }

  const bodyResult = await readBodyCapped(request);
  if (bodyResult instanceof Response) {
    const headers = new Headers(bodyResult.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(bodyResult.body, { status: bodyResult.status, headers });
  }

  let principal;
  try {
    principal = await validateAccessToken(request.headers.get("authorization"));
  } catch {
    return unauthorized();
  }
  if (!principal || principal.kind !== "mcp_oauth") {
    return unauthorized();
  }

  const toolCall = extractToolCall(bodyResult.parsed);
  if (toolCall) {
    try {
      assertHostedToolAllowed(toolCall.name, principal.scopes, toolCall.args);
    } catch (error) {
      if (error instanceof InsufficientScopeError) {
        return jsonError(
          403,
          {
            error: "insufficient_scope",
            error_description: error.message,
            required_scopes: error.requiredScopes,
            resource_metadata: `${config.publicOrigin}/.well-known/oauth-protected-resource/api/mcp`,
          },
          {
            ...cors,
            "WWW-Authenticate": `${wwwAuthenticateChallenge()}, scope="${error.requiredScopes.join(" ")}"`,
          },
        );
      }
      throw error;
    }
  }

  const ports = createInProcessPorts(principal);
  ports.assertToolAllowed = async (toolName) => {
    // register-tools calls this without args; merge scope upgrade happens on HTTP preflight above.
    assertHostedToolAllowed(toolName, principal.scopes, null);
  };

  const { server } = createPlannerMcpServer(ports);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request, {
      parsedBody: bodyResult.parsed,
    });
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store");
    for (const [k, v] of Object.entries(cors)) headers.set(k, v);
    return new Response(response.body, { status: response.status, headers });
  } finally {
    try {
      await transport.close();
    } catch {
      /* ignore */
    }
    try {
      await server.close();
    } catch {
      /* ignore */
    }
  }
}

/** Test helpers */
export const __testing = {
  extractToolCall,
  MAX_BODY_BYTES,
};
