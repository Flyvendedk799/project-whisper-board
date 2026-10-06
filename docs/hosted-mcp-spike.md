# Hosted MCP spike — SDK 1.30.0 Streamable HTTP

Verified against `@modelcontextprotocol/sdk@1.30.0` (pinned in `package.json`).
No production credentials or deployment were used for this spike.

## Target transport

Hosted Boared MCP will serve Streamable HTTP at `https://boared.online/api/mcp`
using the **web-standard** transport:

```ts
import { WebStandardStreamableHTTPServerTransport } from
  "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
```

TanStack Start / Nitro handlers already work with the Fetch `Request`/`Response`
pair, so prefer `WebStandardStreamableHTTPServerTransport` over the Node
`StreamableHTTPServerTransport` wrapper (which bridges via `@hono/node-server`).

## Verified constructor options (stateless + JSON)

```ts
const transport = new WebStandardStreamableHTTPServerTransport({
  // Stateless: omit / set undefined — disables session IDs and session checks.
  sessionIdGenerator: undefined,
  // Prefer a single JSON response over an SSE stream for request/response tools.
  enableJsonResponse: true,
});
```

From the 1.30.0 typings (`webStandardStreamableHttp.d.ts`):

| Option | Spike choice | Notes |
| --- | --- | --- |
| `sessionIdGenerator` | `undefined` | Stateless mode; no `Mcp-Session-Id` |
| `enableJsonResponse` | `true` | JSON body instead of SSE stream |
| `eventStore` | omit | No resumability in v1 hosted |
| `allowedHosts` / `allowedOrigins` | omit on transport | Host/Origin allowlists are enforced in our HTTP handler (SDK marks these as deprecated) |
| `keepAliveMs` / `retryInterval` | default / omit | Irrelevant when `enableJsonResponse` is true |

`handleRequest(req: Request, options?: { parsedBody?, authInfo? }): Promise<Response>`
accepts a pre-parsed body — useful once the route has already consumed the stream
for size/type checks.

## Fresh server + transport per request

In 1.25+ (still true on 1.30.0), a **stateless** transport is effectively
single-use for non-initialize traffic. Reusing one transport across POSTs can
yield empty 500s ([typescript-sdk#1994](https://github.com/modelcontextprotocol/typescript-sdk/issues/1994)).

Hosted pattern (Commit 5 / codey2):

1. Authenticate and freeze the principal.
2. Build request-local tool ports (`createInProcessPorts(principal)`).
3. `createPlannerMcpServer(ports)` → new `McpServer`.
4. New `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })`.
5. `await server.connect(transport)` then `return transport.handleRequest(request, { parsedBody })`.
6. Release; do not cache the transport or server across callers.

Stdio keeps a long-lived server + `StdioServerTransport` (unchanged).

## Methods and CORS

- Primary: `POST /api/mcp` with JSON-RPC MCP messages.
- `GET` / `DELETE` may return 405 in the first hosted cut (no standalone SSE, no session DELETE).
- `OPTIONS` is answered by our route for public CORS preflight; not by the SDK transport.

## Auth boundary (this half vs codey2)

- CODEy (Commits 0–2): extract reusable MCP core + `IntegrationPrincipal` + in-process adapters. No OAuth routes or migrations.
- codey2 (Commits 3–6): OAuth storage, discovery/consent, authenticated `/api/mcp`, tool-policy, hosted upload/GitHub restrictions.

API-key stdio and `/api/planner` + `/api/v1` keep working; OAuth access tokens must **not** authenticate those REST routes.

## Smoke test

`src/mcp/hosted-mcp-spike.test.ts` imports the 1.30.0 symbols and constructs a
stateless JSON transport without network I/O or credentials.
