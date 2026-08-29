import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

function admin() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function assertAdmin(supabase: ReturnType<typeof admin>, userId: string) {
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Error("Forbidden: admin only");
}

export const inviteClient = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        email: z.string().email(),
        projectId: z.string().uuid().optional(),
        fullName: z.string().min(1).max(120).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const a = admin();
    await assertAdmin(a, context.userId);

    const origin = process.env.SITE_URL || "";
    const redirectTo = origin ? `${origin}/app` : undefined;

    // Try invite (sends email). If user exists, fall back to magic link.
    const { data: invited, error: inviteErr } = await a.auth.admin.inviteUserByEmail(data.email, {
      redirectTo,
      data: data.fullName ? { full_name: data.fullName } : undefined,
    });

    let userId = invited?.user?.id;
    if (inviteErr && !userId) {
      // Likely existing user — look them up via magic link generation
      const { data: link, error: linkErr } = await a.auth.admin.generateLink({
        type: "magiclink",
        email: data.email,
        options: { redirectTo },
      });
      if (linkErr) throw new Error(linkErr.message);
      userId = link.user?.id;
    }
    if (!userId) throw new Error("Could not invite user");

    // Ensure role
    await a
      .from("user_roles")
      .upsert({ user_id: userId, role: "client" }, { onConflict: "user_id,role" });

    if (data.projectId) {
      await a
        .from("project_members")
        .upsert(
          { project_id: data.projectId, user_id: userId, role: "client" },
          { onConflict: "project_id,user_id" },
        );
    }
    return { ok: true, userId };
  });

export const signedAttachmentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({ bucket: z.enum(["attachments", "recordings"]), path: z.string().min(1).max(500) })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    // Use the user-scoped client to verify access via RLS on ticket_attachments
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
