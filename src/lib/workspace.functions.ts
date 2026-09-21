import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { guard, requireFound } from "@/lib/server-errors";

function admin() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type WorkspaceSummary = {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  brand_color: string | null;
  support_email: string | null;
  website: string | null;
  invoice_prefix: string;
  role: "admin" | "client_admin" | "client";
};

export const listMyWorkspaces = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) =>
    guard("workspaces.list", async () => {
      const { supabase, userId } = context;
      const { data, error } = await supabase
        .from("workspace_members")
        .select(
          "role, workspace:workspaces(id, slug, name, logo_url, brand_color, support_email, website, invoice_prefix)",
        )
        .eq("user_id", userId);
      if (error) throw error;

      const workspaces: WorkspaceSummary[] = [];
      for (const row of data ?? []) {
        const ws = row.workspace as WorkspaceSummary | WorkspaceSummary[] | null;
        const workspace = Array.isArray(ws) ? ws[0] : ws;
        if (!workspace) continue;
        workspaces.push({
          id: workspace.id,
          slug: workspace.slug,
          name: workspace.name,
          logo_url: workspace.logo_url,
          brand_color: workspace.brand_color,
          support_email: workspace.support_email,
          website: workspace.website,
          invoice_prefix: workspace.invoice_prefix,
          role: row.role,
        });
      }
      workspaces.sort((a, b) => a.name.localeCompare(b.name));
      return { workspaces };
    }),
  );

export const createWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        name: z.string().min(1).max(120),
        slug: z.string().min(2).max(48).optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("workspaces.create", async () => {
      const { supabase } = context;
      const { data: ws, error } = await supabase.rpc("create_workspace", {
        _name: data.name,
        _slug: data.slug ?? null,
      });
      if (error) throw error;
      return { workspace: requireFound(ws, "workspace") };
    }),
  );

export const updateWorkspace = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        supportEmail: z.string().max(200).optional().nullable(),
        website: z.string().max(200).optional().nullable(),
        brandColor: z.string().max(32).optional().nullable(),
        invoicePrefix: z.string().min(1).max(12).optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("workspaces.update", async () => {
      const { supabase } = context;
      const blank = (v: string | null | undefined) =>
        v == null || v.trim() === "" ? null : v.trim();
      const { data: ws, error } = await supabase.rpc("update_workspace", {
        _workspace_id: data.workspaceId,
        _name: data.name ?? null,
        _support_email: blank(data.supportEmail),
        _website: blank(data.website),
        _brand_color: blank(data.brandColor),
        _invoice_prefix: data.invoicePrefix ?? null,
      });
      if (error) throw error;
      return { workspace: requireFound(ws, "workspace") };
    }),
  );

/** Ensure the caller is an admin of the given workspace (service-role check). */
export async function assertWorkspaceAdmin(userId: string, workspaceId: string) {
  const a = admin();
  const { data } = await a
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: admin only");
}

/** Admin or client_admin of the workspace. */
export async function assertWorkspaceInviter(userId: string, workspaceId: string) {
  const a = admin();
  const { data } = await a
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .in("role", ["admin", "client_admin"])
    .maybeSingle();
  if (!data) throw new Error("Forbidden: invite not allowed");
  return data.role as "admin" | "client_admin";
}
