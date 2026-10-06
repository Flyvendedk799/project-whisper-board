import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BINDING_COOKIE } from "@/lib/mcp-oauth/config";
import {
  approveConsent,
  cancelConsent,
  loadConsentContext,
  OAuthError,
} from "@/lib/mcp-oauth/authorization";
import {
  listGrantsForUser,
  listGrantsForWorkspace,
  mcpOAuthAdmin,
  revokeGrant,
} from "@/lib/mcp-oauth/store";

function bindingCookie(): string | undefined {
  try {
    return getCookie(BINDING_COOKIE);
  } catch {
    return undefined;
  }
}

export const getMcpConsentContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    try {
      const ctx = await loadConsentContext({
        requestId: data.requestId,
        bindingCookie: bindingCookie(),
        userId: context.userId,
      });
      return {
        clientName: ctx.client.client_name,
        clientId: ctx.client.client_id,
        scopes: ctx.scopes,
        resource: ctx.resource,
        workspaces: ctx.workspaces,
      };
    } catch (error) {
      if (error instanceof OAuthError) {
        throw new Error(error.message);
      }
      throw error;
    }
  });

export const approveMcpConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        requestId: z.string().uuid(),
        workspaceId: z.string().uuid(),
        scopes: z.array(z.string()).min(1),
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    try {
      return await approveConsent({
        requestId: data.requestId,
        bindingCookie: bindingCookie(),
        userId: context.userId,
        workspaceId: data.workspaceId,
        scopes: data.scopes,
      });
    } catch (error) {
      if (error instanceof OAuthError) throw new Error(error.message);
      throw error;
    }
  });

export const cancelMcpConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ requestId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    try {
      return await cancelConsent({
        requestId: data.requestId,
        bindingCookie: bindingCookie(),
        userId: context.userId,
      });
    } catch (error) {
      if (error instanceof OAuthError) throw new Error(error.message);
      throw error;
    }
  });

export type McpConnectionRow = {
  id: string;
  clientName: string;
  clientId: string;
  workspaceId: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
};

function mapGrant(row: {
  id: string;
  client_id: string;
  workspace_id: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  mcp_oauth_clients: { client_name: string } | null;
}): McpConnectionRow {
  return {
    id: row.id,
    clientName: row.mcp_oauth_clients?.client_name ?? row.client_id,
    clientId: row.client_id,
    workspaceId: row.workspace_id,
    scopes: row.scopes,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  };
}

export const listMcpConnections = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ workspaceId: z.string().uuid().optional() }).optional().parse(input),
  )
  .handler(async ({ context, data }) => {
    const admin = mcpOAuthAdmin();
    if (data?.workspaceId) {
      const { data: member } = await admin
        .from("workspace_members")
        .select("role")
        .eq("workspace_id", data.workspaceId)
        .eq("user_id", context.userId)
        .maybeSingle();
      if (!member || member.role !== "admin") {
        throw new Error("Only workspace admins can list workspace connections");
      }
      const rows = await listGrantsForWorkspace(data.workspaceId, admin);
      return rows.map(mapGrant);
    }
    const rows = await listGrantsForUser(context.userId, admin);
    return rows.map(mapGrant);
  });

export const revokeMcpConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ grantId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    await revokeGrant(data.grantId, context.userId);
    return { ok: true as const };
  });
