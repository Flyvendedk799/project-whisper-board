import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { actorName, deliver, type NotifyTarget } from "@/lib/notifications.functions";
import { excerptOf } from "@/lib/notify-targets";

/**
 * Tells the other side about the client-facing questions of a plan: the client
 * when a question is put to them, the agency when the client answers or asks.
 * Shared by the app and by the REST/MCP handlers so an agent sending a question
 * to the client notifies them exactly as a person clicking the button does.
 * Never throws: a question that saved must not fail because a notice could not.
 */

function adminDb() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Where a notice about a task opens: the client view, on that task. */
export function clientTaskLink(planId: string, taskId?: string | null) {
  const query = new URLSearchParams({ view: "client" });
  if (taskId) query.set("task", taskId);
  return `/app/planner/${planId}?${query.toString()}`;
}

async function planContext(planId: string) {
  const db = adminDb();
  const { data: plan } = await db
    .from("plans")
    .select("id, title, workspace_id, project_id")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) return null;
  const [{ data: members }, { data: projectMembers }] = await Promise.all([
    db.from("workspace_members").select("user_id, role").eq("workspace_id", plan.workspace_id),
    plan.project_id
      ? db.from("project_members").select("user_id, role").eq("project_id", plan.project_id)
      : Promise.resolve({ data: [] as Array<{ user_id: string; role: string }> }),
  ]);
  const admins = (members ?? []).filter((m) => m.role === "admin").map((m) => m.user_id);
  const clients = (projectMembers ?? [])
    .filter((m) => m.role === "client" || m.role === "client_admin")
    .map((m) => m.user_id);
  return { plan, admins, clients };
}

/** A question was put to the client: tell the clients of the project. */
export async function notifyClientQuestion(input: {
  actorId: string | null;
  planId: string;
  taskId: string;
  clientBody: string;
}): Promise<void> {
  try {
    const ctx = await planContext(input.planId);
    if (!ctx) return;
    const recipients = [...new Set(ctx.clients)].filter((id) => id !== input.actorId);
    if (recipients.length === 0) return;
    const excerpt = excerptOf(input.clientBody);
    const targets: NotifyTarget[] = recipients.map((userId) => ({
      userId,
      workspaceId: ctx.plan.workspace_id,
      actorId: input.actorId,
      kind: "comment",
      title: `Du har et spørgsmål i planen ${ctx.plan.title}`,
      body: excerpt || null,
      link: clientTaskLink(input.planId, input.taskId),
      emailSubject: `Spørgsmål til dig i ${ctx.plan.title}`,
      emailBody: excerpt || undefined,
      template: "plan_client_question",
      relatedType: "plan",
      relatedId: input.planId,
    }));
    await deliver(targets);
  } catch (error) {
    console.error("[client-plan] question notice failed:", error);
  }
}

/** The client answered a question or asked one: tell the agency. */
export async function notifyClientReply(input: {
  actorId: string;
  planId: string;
  taskId: string;
  kind: "answered" | "asked";
  text: string;
}): Promise<void> {
  try {
    const ctx = await planContext(input.planId);
    if (!ctx) return;
    const recipients = [...new Set(ctx.admins)].filter((id) => id !== input.actorId);
    if (recipients.length === 0) return;
    const who = await actorName(input.actorId);
    const excerpt = excerptOf(input.text);
    const verb = input.kind === "answered" ? "answered a question" : "asked a question";
    const targets: NotifyTarget[] = recipients.map((userId) => ({
      userId,
      workspaceId: ctx.plan.workspace_id,
      actorId: input.actorId,
      kind: "comment",
      title: `${who} ${verb} on ${ctx.plan.title}`,
      body: excerpt || null,
      link: clientTaskLink(input.planId, input.taskId),
      emailSubject: `${who} ${verb} on ${ctx.plan.title}`,
      emailBody: excerpt || undefined,
      template: "plan_client_reply",
      relatedType: "plan",
      relatedId: input.planId,
    }));
    await deliver(targets);
  } catch (error) {
    console.error("[client-plan] reply notice failed:", error);
  }
}
