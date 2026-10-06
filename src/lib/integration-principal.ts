/**
 * Who is calling a shared planner/account handler.
 * API keys authenticate /api/planner and /api/v1; hosted MCP OAuth uses mcp_oauth
 * only through the in-process MCP adapters (never as a Bearer on those REST routes).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { AppError } from "@/lib/errors";

export type ApiKeyPrincipal = {
  kind: "api_key";
  keyId: string;
  workspaceId: string;
  scopes: string[];
  /** Who made the key. Null for legacy keys with no owner. */
  userId: string | null;
};

export type McpOAuthPrincipal = {
  kind: "mcp_oauth";
  grantId: string;
  clientId: string;
  workspaceId: string;
  /** Always set for hosted OAuth; grants are user-bound. */
  userId: string;
  scopes: string[];
};

export type IntegrationPrincipal = ApiKeyPrincipal | McpOAuthPrincipal;

export function isApiKeyPrincipal(p: IntegrationPrincipal): p is ApiKeyPrincipal {
  return p.kind === "api_key";
}

export function isMcpOAuthPrincipal(p: IntegrationPrincipal): p is McpOAuthPrincipal {
  return p.kind === "mcp_oauth";
}

export function principalWorkspaceId(p: IntegrationPrincipal): string {
  return p.workspaceId;
}

export function principalUserId(p: IntegrationPrincipal): string | null {
  return p.userId;
}

export function principalScopes(p: IntegrationPrincipal): readonly string[] {
  return p.scopes;
}

/** KeyContext-shaped view for attachment helpers that only need workspace + actor. */
export function principalAsKeyContext(p: IntegrationPrincipal): {
  workspaceId: string;
  userId: string | null;
} {
  return { workspaceId: p.workspaceId, userId: p.userId };
}

type Admin = SupabaseClient<Database>;

function adminClient(): Admin {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Hosted MCP OAuth grants are admin-only for this release.
 * Recheck on every request: a role change must revoke access even if the grant row remains.
 * codey2's HTTP handler and consent flow call this.
 */
export async function isWorkspaceAdmin(
  workspaceId: string,
  userId: string,
  admin: Admin = adminClient(),
): Promise<boolean> {
  const { data } = await admin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.role === "admin";
}

export async function assertHostedMcpAdminGrant(
  workspaceId: string,
  userId: string,
  admin: Admin = adminClient(),
): Promise<void> {
  const ok = await isWorkspaceAdmin(workspaceId, userId, admin);
  if (!ok) {
    throw new AppError(
      "forbidden",
      "Hosted MCP is limited to workspace admins. Ask an admin to connect, or use a local API key over stdio.",
      { status: 403 },
    );
  }
}

/**
 * Build an api_key principal from verifyApiKey's result.
 * OAuth tokens must never be passed through verifyApiKey into REST routes.
 */
export function apiKeyPrincipal(auth: {
  keyId: string;
  workspaceId: string;
  scopes: string[];
  userId: string | null;
}): ApiKeyPrincipal {
  return {
    kind: "api_key",
    keyId: auth.keyId,
    workspaceId: auth.workspaceId,
    scopes: auth.scopes,
    userId: auth.userId,
  };
}
