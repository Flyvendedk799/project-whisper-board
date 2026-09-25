import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { assertWorkspaceAdmin, assertWorkspaceInviter } from "@/lib/workspace.functions";

function admin() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const inviteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email(),
        workspaceId: z.string().uuid(),
        projectId: z.string().uuid().optional(),
        fullName: z.string().min(1).max(120).optional(),
        role: z.enum(["admin", "client", "client_admin"]).default("client"),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const a = admin();
    const inviterRole = await assertWorkspaceInviter(context.userId, data.workspaceId);

    if (data.role !== "client" && inviterRole !== "admin") {
      throw new Error("Forbidden: only admins can invite that role");
    }

    const origin = process.env.SITE_URL || "";
    const redirectTo = origin
      ? `${origin}/invite/accept${data.projectId ? `?project=${data.projectId}` : ""}`
      : undefined;

    const meta: Record<string, string> = {
      workspace_id: data.workspaceId,
      invite_role: data.role,
    };
    if (data.fullName) meta.full_name = data.fullName;
    if (data.projectId) meta.project_id = data.projectId;

    const { data: invited, error: inviteErr } = await a.auth.admin.inviteUserByEmail(data.email, {
      redirectTo,
      data: meta,
    });

    let userId = invited?.user?.id;
    if (inviteErr && !userId) {
      const { data: link, error: linkErr } = await a.auth.admin.generateLink({
        type: "magiclink",
        email: data.email,
        options: {
          redirectTo,
          data: meta,
        },
      });
      if (linkErr) throw new Error(linkErr.message);
      userId = link.user?.id;

      // Existing users: ensure membership now (invite email may not re-run trigger).
      if (userId) {
        await a
          .from("user_roles")
          .upsert(
            { user_id: userId, workspace_id: data.workspaceId, role: data.role },
            { onConflict: "user_id,workspace_id,role" },
          );
        await a
          .from("workspace_members")
          .upsert(
            { workspace_id: data.workspaceId, user_id: userId, role: data.role },
            { onConflict: "workspace_id,user_id" },
          );
      }
    }
    if (!userId) throw new Error("Could not invite user");

    // New invites get roles via handle_new_user; ensure membership for both paths.
    await a
      .from("user_roles")
      .upsert(
        { user_id: userId, workspace_id: data.workspaceId, role: data.role },
        { onConflict: "user_id,workspace_id,role" },
      );
    await a
      .from("workspace_members")
      .upsert(
        { workspace_id: data.workspaceId, user_id: userId, role: data.role },
        { onConflict: "workspace_id,user_id" },
      );

    if (data.projectId) {
      await a.from("project_members").upsert(
        {
          project_id: data.projectId,
          user_id: userId,
          role: data.role,
          workspace_id: data.workspaceId,
        },
        { onConflict: "project_id,user_id" },
      );
    }
    return { ok: true, userId };
  });

export const setProjectMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(["client", "client_admin"]),
        projectId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const a = admin();
    await assertWorkspaceAdmin(context.userId, data.workspaceId);

    await a
      .from("workspace_members")
      .upsert(
        { workspace_id: data.workspaceId, user_id: data.userId, role: data.role },
        { onConflict: "workspace_id,user_id" },
      );

    // Replace prior client roles for this workspace with the new one.
    await a
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("workspace_id", data.workspaceId)
      .in("role", ["client", "client_admin"]);
    await a.from("user_roles").insert({
      user_id: data.userId,
      workspace_id: data.workspaceId,
      role: data.role,
    });

    if (data.projectId) {
      await a
        .from("project_members")
        .update({ role: data.role })
        .eq("project_id", data.projectId)
        .eq("user_id", data.userId);
    }

    return { ok: true };
  });

export const setWorkspaceMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
        role: z.enum(["admin", "client", "client_admin"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_workspace_member_role", {
      _workspace_id: data.workspaceId,
      _user_id: data.userId,
      _role: data.role,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeWorkspaceMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("remove_workspace_member", {
      _workspace_id: data.workspaceId,
      _user_id: data.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const mergeOrganizations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        fromId: z.string().uuid(),
        toId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("merge_organizations", {
      _from_id: data.fromId,
      _to_id: data.toId,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const addProjectMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        projectId: z.string().uuid(),
        userId: z.string().uuid(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const a = admin();
    await assertWorkspaceInviter(context.userId, data.workspaceId);

    const { data: member, error } = await a
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", data.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!member) throw new Error("That person is not in this workspace");

    const { error: insertError } = await a.from("project_members").upsert(
      {
        project_id: data.projectId,
        user_id: data.userId,
        role: member.role,
        workspace_id: data.workspaceId,
      },
      { onConflict: "project_id,user_id" },
    );
    if (insertError) throw new Error(insertError.message);
    return { ok: true };
  });

export const signedAttachmentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ bucket: z.enum(["attachments", "recordings"]), path: z.string().min(1).max(500) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: row } = await supabase
      .from("ticket_attachments")
      .select("id")
      .eq("storage_bucket", data.bucket)
      .eq("storage_path", data.path)
      .maybeSingle();
    if (!row) throw new Error("Not found");
    const a = admin();
    const { data: signed, error } = await a.storage
      .from(data.bucket)
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });
