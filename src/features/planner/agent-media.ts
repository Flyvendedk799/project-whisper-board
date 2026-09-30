/**
 * What the agent API and the MCP server may see of a task's files.
 *
 * Only attachments with `shared_with_agents = true` ever leave the building,
 * and each comes with a signed URL that expires in an hour. The filter is in
 * the query, not applied afterwards, so a hidden file is never even read.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { attachmentKindOf, PLAN_ATTACHMENT_BUCKET, type PlanAttachmentKind } from "@/lib/upload";

type Admin = SupabaseClient<Database>;

export const AGENT_URL_SECONDS = 60 * 60;

export interface AgentAttachment {
  id: string;
  task_id: string;
  comment_id: string | null;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  kind: PlanAttachmentKind;
  marked_up: boolean;
  source_attachment_id: string | null;
  created_at: string;
  url: string | null;
  url_expires_in: number;
}

const COLUMNS =
  "id, task_id, comment_id, file_name, mime_type, size_bytes, source_attachment_id, created_at, storage_path";

export async function sharedAttachments(
  admin: Admin,
  filter: { planId?: string; taskId?: string; attachmentId?: string },
): Promise<AgentAttachment[]> {
  let query = admin
    .from("plan_task_attachments")
    .select(COLUMNS)
    .eq("shared_with_agents", true)
    .order("created_at", { ascending: true });
  if (filter.planId) query = query.eq("plan_id", filter.planId);
  if (filter.taskId) query = query.eq("task_id", filter.taskId);
  if (filter.attachmentId) query = query.eq("id", filter.attachmentId);

  const { data: rows, error } = await query;
  if (error) throw error;
  if (!rows?.length) return [];

  const { data: signed, error: signError } = await admin.storage
    .from(PLAN_ATTACHMENT_BUCKET)
    .createSignedUrls(
      rows.map((row) => row.storage_path),
      AGENT_URL_SECONDS,
    );
  if (signError) throw signError;
  const urls = new Map((signed ?? []).map((entry) => [entry.path, entry.signedUrl] as const));

  return rows.map(({ storage_path, ...row }) => ({
    ...row,
    kind: attachmentKindOf(row.mime_type),
    marked_up: Boolean(row.source_attachment_id),
    url: urls.get(storage_path) ?? null,
    url_expires_in: AGENT_URL_SECONDS,
  }));
}

/** Adds `attachments` (shared only) to each task of a plan, in place of a join. */
export async function withSharedAttachments<T extends { id: string }>(
  admin: Admin,
  planId: string,
  tasks: readonly T[],
): Promise<Array<T & { attachments: AgentAttachment[] }>> {
  const all = await sharedAttachments(admin, { planId });
  const byTask = new Map<string, AgentAttachment[]>();
  for (const attachment of all) {
    const list = byTask.get(attachment.task_id) ?? [];
    list.push(attachment);
    byTask.set(attachment.task_id, list);
  }
  return tasks.map((task) => ({ ...task, attachments: byTask.get(task.id) ?? [] }));
}

type PlanWithTasks = {
  id: string;
  plan_sections?: Array<{ plan_tasks?: Array<{ id: string }> | null }> | null;
};

/** Decorates a `plans?select=*,plan_sections(*,plan_tasks(*))` row with shared files. */
export async function decoratePlanForAgents<T extends PlanWithTasks>(admin: Admin, plan: T) {
  const all = await sharedAttachments(admin, { planId: plan.id });
  const byTask = new Map<string, AgentAttachment[]>();
  for (const attachment of all) {
    const list = byTask.get(attachment.task_id) ?? [];
    list.push(attachment);
    byTask.set(attachment.task_id, list);
  }
  return {
    ...plan,
    plan_sections: (plan.plan_sections ?? []).map((section) => ({
      ...section,
      plan_tasks: (section.plan_tasks ?? []).map((task) => ({
        ...task,
        attachments: byTask.get(task.id) ?? [],
      })),
    })),
  };
}
