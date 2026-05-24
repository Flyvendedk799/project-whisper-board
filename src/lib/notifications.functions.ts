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

/** Notify everyone on a ticket (project members + assignee + reporter) about a new comment. */
export const notifyTicketComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ ticketId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const a = admin();

    const { data: t } = await a
      .from("tickets")
      .select("id,title,project_id,reporter_id,assignee_id")
      .eq("id", data.ticketId)
      .single();
    if (!t) return { ok: false };

    const { data: members } = await a
      .from("project_members")
      .select("user_id")
      .eq("project_id", t.project_id);

    const recipientSet = new Set<string>();
    members?.forEach((m) => recipientSet.add(m.user_id));
    if (t.reporter_id) recipientSet.add(t.reporter_id);
    if (t.assignee_id) recipientSet.add(t.assignee_id);
    recipientSet.delete(userId); // don't notify the author

    const { data: author } = await a.from("profiles").select("full_name,email").eq("id", userId).maybeSingle();
    const authorLabel = author?.full_name || author?.email || "Someone";

    const rows = Array.from(recipientSet).map((uid) => ({
      user_id: uid,
      kind: "comment" as const,
      title: `${authorLabel} replied`,
      body: `On "${t.title}"`,
      link: `/app/tickets/${t.id}`,
    }));
    if (rows.length) await a.from("notifications").insert(rows);
    return { ok: true, sent: rows.length };
  });
