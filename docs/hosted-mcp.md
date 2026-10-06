# Hosted MCP (Boared)

Endpoint: `https://boared.online/api/mcp`

Transport: MCP Streamable HTTP (SDK `@modelcontextprotocol/sdk` 1.30.0),
stateless (`sessionIdGenerator: undefined`, `enableJsonResponse: true`),
fresh server + transport per request.

## Connect

1. Enable with `MCP_ENABLED=true` and set the canonical origin/issuer/resource env vars (see `.env.example`).
2. Register a predefined OAuth client via `MCP_OAUTH_CLIENT_ID`, `MCP_OAUTH_REDIRECT_URIS`, and optional secret.
3. In your agent, add a remote MCP server pointing at `/api/mcp` (no secrets in the snippet).
4. The client opens `/oauth/authorize` → Boared login → `/oauth/consent`. Only **workspace admins** can approve.
5. Tokens are Boared-issued opaque values (`bmc_at_…` / `bmc_rt_…`), not Supabase JWTs or API keys.

## Discovery

| URL | Purpose |
| --- | --- |
| `/.well-known/oauth-protected-resource/api/mcp` | Protected resource metadata |
| `/.well-known/oauth-authorization-server` | Authorization server metadata |
| `/oauth/authorize` | Authorization endpoint |
| `/oauth/token` | Token endpoint (auth code + refresh) |
| `/oauth/revoke` | Revocation |
| `/api/mcp` | MCP Streamable HTTP |

Unauthenticated MCP calls receive `401` with `WWW-Authenticate: Bearer … resource_metadata=… scope="planner:read"`.

## Scopes

Hosted scopes are separate from legacy API-key scopes (`planner` / `account`):

- `planner:read` / `planner:write`
- `account:read` / `account:write`
- `github:read` / `github:write` / `github:merge`

Write scopes require the matching read. Tool requirements are enforced in `src/mcp/tool-policy.ts` via `ports.assertToolAllowed`.

## Security notes

- OAuth access tokens authenticate `/api/mcp` only — not `/api/planner` or `/api/v1` (those stay API-key).
- Hosted GitHub calls use `allowSharedFallback: false` (never silent `GITHUB_PAT`).
- `file_path` uploads are rejected on hosted HTTP.
- Admin membership is rechecked on every MCP request and on consent.
- Manage connections under **Agents & MCP → Connected agents** (list + revoke; tokens never shown).

## Local stdio (unchanged)

The classic `npx tsx src/mcp/server.ts` + `PLANNER_API_KEY` path remains for local agents.
