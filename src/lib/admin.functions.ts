import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { assertWorkspaceAdmin, assertWorkspaceInviter } from "@/lib/workspace.functions";
import { appUrl } from "@/lib/app-origin";
import { inviteAcceptPath, inviteEmail } from "@/lib/invite-email";
import { sendAccountEmail } from "@/lib/notifications.functions";

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

    // Always explicit: without it Supabase Auth falls back to its own SITE_URL,
    // which on a self-hosted stack defaults to localhost.
    const redirectTo = appUrl(inviteAcceptPath(data.projectId));

    const meta: Record<string, string> = {
      workspace_id: data.workspaceId,
      invite_role: data.role,
    };
    if (data.fullName) meta.full_name = data.fullName;
    if (data.projectId) meta.project_id = data.projectId;

    const { data: inviter } = await a
      .from("profiles")
      .select("full_name, email")
      .eq("id", context.userId)
      .maybeSingle();
    meta.inviter_name = inviter?.full_name || inviter?.email || "Someone";

    const { data: workspace } = await a
      .from("workspaces")
      .select("name")
      .eq("id", data.workspaceId)
      .maybeSingle();
    meta.workspace_name = workspace?.name || "a workspace";

    if (data.projectId) {
      const { data: project } = await a
        .from("projects")
        .select("title")
        .eq("id", data.projectId)
        .maybeSingle();
      if (project?.title) {
        meta.project_name = project.title;
      }
    }

    const { data: invited, error: inviteErr } = await a.auth.admin.inviteUserByEmail(data.email, {
      redirectTo,
      data: meta,
    });

    let userId = invited?.user?.id;
    // Set when Auth did not mail anyone (an existing account), so the app must.
    let existingAccount = false;
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
      // generateLink never sends mail; it is used here to resolve the account.
      existingAccount = Boolean(userId);

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

      // A client invited onto a company's project belongs to that company.
      if (data.role !== "admin") {
        const { data: project } = await a
          .from("projects")
          .select("organization_id")
          .eq("id", data.projectId)
          .maybeSingle();
        if (project?.organization_id) {
          await a.from("organization_members").upsert(
            {
              organization_id: project.organization_id,
              user_id: userId,
              workspace_id: data.workspaceId,
            },
            { onConflict: "organization_id,user_id" },
          );
        }
      }
    }

    // Membership is in place, so the link works the moment it is opened.
    const emailed = existingAccount
      ? await emailExistingAccount(a, {
          email: data.email,
          userId,
          inviterId: context.userId,
          workspaceId: data.workspaceId,
          projectId: data.projectId,
          url: redirectTo,
        })
      : true;
    return { ok: true, userId, emailed };
  });

/**
 * Supabase Auth mails only accounts it creates. Someone who already has a login
 * gets the invitation from the app instead, through the notification provider
 * and the Outbox. The link is the app's own accept page, not a one-time magic
 * link: they can sign in as usual, it does not expire or get used up by a mail
 * scanner, and its host is the app's, not the Auth service's public URL.
 */
async function emailExistingAccount(
  a: ReturnType<typeof admin>,
  input: {
    email: string;
    userId: string;
    inviterId: string;
    workspaceId: string;
    projectId?: string;
    url: string;
  },
): Promise<boolean> {
  try {
    const [{ data: inviter }, { data: workspace }, { data: project }] = await Promise.all([
      a.from("profiles").select("full_name, email").eq("id", input.inviterId).maybeSingle(),
      a.from("workspaces").select("name").eq("id", input.workspaceId).maybeSingle(),
      input.projectId
        ? a.from("projects").select("title").eq("id", input.projectId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    const message = inviteEmail({
      inviterName: inviter?.full_name || inviter?.email,
      workspaceName: workspace?.name,
      projectTitle: project?.title,
      url: input.url,
    });
    return await sendAccountEmail({
      to: input.email,
      toUserId: input.userId,
      ...message,
      template: "invite_existing_user",
      relatedType: input.projectId ? "project" : "workspace",
      relatedId: input.projectId ?? input.workspaceId,
      workspaceId: input.workspaceId,
    });
  } catch (e) {
    // The invite itself succeeded; a mail failure must not undo it.
    console.error("[invite] email to existing account failed:", e);
    return false;
  }
}

/**
 * Send someone's invitation again, for a teammate who never signed in (the
 * first email went to spam, or the link expired). Only for pending invites: a
 * person who has signed in uses "Forgot password" like everyone else.
 */
export const resendInvite = createServerFn({ method: "POST" })
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
    const a = admin();
    const inviterRole = await assertWorkspaceInviter(context.userId, data.workspaceId);

    const { data: member } = await a
      .from("workspace_members")
      .select("role")
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", data.userId)
      .maybeSingle();
    if (!member) throw new Error("Not found: that person is not in this workspace");
    if (member.role !== "client" && inviterRole !== "admin") {
      throw new Error("Forbidden: only admins can re-invite that role");
    }

    const { data: found, error: userErr } = await a.auth.admin.getUserById(data.userId);
    if (userErr || !found?.user?.email) throw new Error("Not found: no email for that person");
    const user = found.user;
    if (user.last_sign_in_at) {
      throw new Error(
        "They have already joined. They can reset their password from the sign-in page.",
      );
    }

    const redirectTo = appUrl("/invite/accept");
    const meta: Record<string, string> = {
      workspace_id: data.workspaceId,
      invite_role: member.role,
    };

    // An unconfirmed invitee gets the invitation again. Someone whose account
    // exists but who never signed in (confirmed through another path) gets a
    // set-password link instead, which lands on the same page.
    const { error: inviteErr } = await a.auth.admin.inviteUserByEmail(user.email!, {
      redirectTo,
      data: meta,
    });
    if (!inviteErr) return { ok: true, via: "invite" as const };

    const { error: resetErr } = await a.auth.resetPasswordForEmail(user.email!, { redirectTo });
    if (resetErr) throw new Error(resetErr.message);
    return { ok: true, via: "password_link" as const };
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

/**
 * Puts a client login at one company (or at none). Replaces any earlier company
 * for that person: the UI models "their company", and project access is a
 * separate thing that stays untouched.
 */
export const setClientOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        workspaceId: z.string().uuid(),
        userId: z.string().uuid(),
        organizationId: z.string().uuid().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertWorkspaceAdmin(context.userId, data.workspaceId);
    const a = admin();

    if (data.organizationId) {
      const { data: org, error: orgError } = await a
        .from("organizations")
        .select("id")
        .eq("id", data.organizationId)
        .eq("workspace_id", data.workspaceId)
        .maybeSingle();
      if (orgError) throw new Error(orgError.message);
      if (!org) throw new Error("That client is not in this workspace");

      const { error } = await a.from("organization_members").upsert(
        {
          organization_id: data.organizationId,
          user_id: data.userId,
          workspace_id: data.workspaceId,
        },
        { onConflict: "organization_id,user_id" },
      );
      if (error) throw new Error(error.message);
    }

    let cleanup = a
      .from("organization_members")
      .delete()
      .eq("workspace_id", data.workspaceId)
      .eq("user_id", data.userId);
    if (data.organizationId) cleanup = cleanup.neq("organization_id", data.organizationId);
    const { error: cleanupError } = await cleanup;
    if (cleanupError) throw new Error(cleanupError.message);

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

    if (member.role !== "admin") {
      const { data: project } = await a
        .from("projects")
        .select("organization_id")
        .eq("id", data.projectId)
        .maybeSingle();
      if (project?.organization_id) {
        await a.from("organization_members").upsert(
          {
            organization_id: project.organization_id,
            user_id: data.userId,
            workspace_id: data.workspaceId,
          },
          { onConflict: "organization_id,user_id" },
        );
      }
    }
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
