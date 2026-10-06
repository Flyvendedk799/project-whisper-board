/**
 * The agent attachment API: upload a file to a plan or a task, read a text file back,
 * and get a short-lived download link. Used by `routes/api.planner.$.ts`.
 *
 * Every rule about what is accepted lives in `attachment-policy.ts`; this module
 * decides who may do it and where it goes:
 *
 *  - The key's owner has to still be a member of the key's workspace. The file is
 *    uploaded as them (the first path segment), as the browser upload is.
 *  - The plan, or the task and its actual plan, is resolved inside the key's
 *    workspace before anything is written. Missing and not yours are the same 404.
 *  - The server picks the bucket and the path; the client never names either.
 *  - Reads only see files shared with agents, as every other agent read does.
 *
 * Storage and the database are reached through `AttachmentPorts`, so the policy can
 * be tested with an in-memory fake; `supabaseAttachmentPorts` is the real thing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { AppError } from "@/lib/errors";
import { isUuid } from "@/lib/agent-api-input";
import {
  attachmentKindOf,
  isPlanAttachmentPath,
  PLAN_ATTACHMENT_BUCKET,
  PLAN_LEVEL_SEGMENT,
  planAttachmentPath,
  slugifyFileName,
  type PlanAttachmentKind,
} from "@/lib/upload";
import {
  idempotentSegment,
  isTextAttachment,
  sameUpload,
  sha256Hex,
  utf8Page,
  type TextPage,
  type UploadIntent,
} from "@/lib/attachment-policy";

type Admin = SupabaseClient<Database>;
type AttachmentInsert = Database["public"]["Tables"]["plan_task_attachments"]["Insert"];

export const UPLOAD_URL_SECONDS = 60 * 60;
export const DOWNLOAD_URL_SECONDS = 5 * 60;

export interface AttachmentRow {
  id: string;
  plan_id: string;
  task_id: string | null;
  comment_id: string | null;
  uploader_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  shared_with_agents: boolean;
  source_attachment_id: string | null;
  created_at: string;
}

export interface AttachmentPorts {
  isMember(workspaceId: string, userId: string): Promise<boolean>;
  planInWorkspace(planId: string, workspaceId: string): Promise<{ id: string } | null>;
  taskInWorkspace(
    taskId: string,
    workspaceId: string,
  ): Promise<{ id: string; plan_id: string } | null>;
  attachmentById(id: string): Promise<AttachmentRow | null>;
  attachmentByPathPrefix(planId: string, prefix: string): Promise<AttachmentRow | null>;
  insertAttachment(row: AttachmentInsert): Promise<AttachmentRow>;
  logAttachmentAdded(event: {
    planId: string;
    taskId: string | null;
    actorId: string;
    fileName: string;
    metadata: Record<string, string | number | boolean | null>;
  }): Promise<void>;
  /** "exists" when an object is already at that path; nothing is overwritten. */
  upload(path: string, bytes: Buffer, contentType: string): Promise<"ok" | "exists">;
  download(path: string): Promise<Buffer>;
  remove(path: string): Promise<void>;
  sign(path: string, seconds: number, downloadAs?: string): Promise<string | null>;
}

export interface AttachmentDto {
  id: string;
  plan_id: string;
  /** The task it is on, or null for a file on the plan itself. */
  task_id: string | null;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  kind: PlanAttachmentKind;
  shared_with_agents: boolean;
  sha256: string;
  purpose: string | null;
  created_at: string;
  url: string | null;
  url_expires_in: number;
  /** True when an earlier upload with the same idempotency key was returned instead. */
  idempotent_replay: boolean;
}

export interface KeyContext {
  workspaceId: string;
  userId: string | null;
}

const NOT_FOUND_MESSAGE = "Plan or task not found.";
const notFound = (message = NOT_FOUND_MESSAGE) =>
  new AppError("not_found", message, { status: 404 });

/** The key's owner, who must still be in the workspace: files are uploaded as them. */
export async function requireKeyOwner(ports: AttachmentPorts, key: KeyContext): Promise<string> {
  if (!key.userId) {
    throw new AppError(
      "forbidden",
      "This API key has no owner, so there is nobody to upload as. Create a key while signed in.",
      { status: 403 },
    );
  }
  if (!(await ports.isMember(key.workspaceId, key.userId))) {
    throw new AppError(
      "forbidden",
      "The person who created this API key is no longer a member of its workspace.",
      { status: 403 },
    );
  }
  return key.userId;
}

/** The plan, or the task and the plan it is really on, inside the key's workspace. */
export async function resolveTarget(
  ports: AttachmentPorts,
  workspaceId: string,
  intent: Pick<UploadIntent, "target" | "workspaceId">,
): Promise<{ planId: string; taskId: string | null }> {
  if (intent.workspaceId && intent.workspaceId !== workspaceId.toLowerCase()) throw notFound();
  if (intent.target.taskId) {
    const task = await ports.taskInWorkspace(intent.target.taskId, workspaceId);
    if (!task) throw notFound();
    return { planId: task.plan_id, taskId: task.id };
  }
  const plan = await ports.planInWorkspace(intent.target.planId!, workspaceId);
  if (!plan) throw notFound();
  return { planId: plan.id, taskId: null };
}

/** Stored with a charset so a browser opening the signed URL reads the text as UTF-8. */
function contentTypeFor(mime: string): string {
  return mime.startsWith("text/") ? `${mime}; charset=utf-8` : mime;
}

async function toDto(
  ports: AttachmentPorts,
  row: AttachmentRow,
  extra: { sha256: string; purpose: string | null; replay: boolean },
): Promise<AttachmentDto> {
  return {
    id: row.id,
    plan_id: row.plan_id,
    task_id: row.task_id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    kind: attachmentKindOf(row.mime_type),
    shared_with_agents: row.shared_with_agents,
    sha256: extra.sha256,
    purpose: extra.purpose,
    created_at: row.created_at,
    url: row.shared_with_agents ? await ports.sign(row.storage_path, UPLOAD_URL_SECONDS) : null,
    url_expires_in: UPLOAD_URL_SECONDS,
    idempotent_replay: extra.replay,
  };
}

const idempotencyConflict = () =>
  new AppError(
    "idempotency_conflict",
    "This idempotency_key was already used for a different file on this target. Use a new key.",
    { status: 409 },
  );

/**
 * Stores the file and records it. With an idempotency key, the same key, target and
 * content returns the attachment made the first time (200, `idempotent_replay`); the
 * same key with anything different is a 409.
 */
export async function uploadAgentAttachment(
  ports: AttachmentPorts,
  key: KeyContext,
  intent: UploadIntent,
): Promise<{ attachment: AttachmentDto; created: boolean }> {
  const userId = await requireKeyOwner(ports, key);
  const { planId, taskId } = await resolveTarget(ports, key.workspaceId, intent);
  const sha256 = sha256Hex(intent.bytes);
  const scope = taskId ?? PLAN_LEVEL_SEGMENT;

  let path: string;
  if (intent.idempotencyKey) {
    const segment = idempotentSegment(intent.idempotencyKey, {
      workspaceId: key.workspaceId,
      userId,
      planId,
      taskId,
    });
    const prefix = `${userId}/${planId}/${scope}/${segment}-`;
    const existing = await ports.attachmentByPathPrefix(planId, prefix);
    if (existing) {
      const stored = await ports.download(existing.storage_path);
      const storedSha = sha256Hex(stored);
      if (
        !sameUpload(
          { file_name: existing.file_name, mime_type: existing.mime_type, sha256: storedSha },
          intent,
          sha256,
        )
      ) {
        throw idempotencyConflict();
      }
      return {
        attachment: await toDto(ports, existing, { sha256, purpose: null, replay: true }),
        created: false,
      };
    }
    path = `${prefix}${slugifyFileName(intent.fileName)}`;
  } else {
    path = planAttachmentPath(userId, planId, taskId, intent.fileName);
  }

  // The path is built here, but check it the way registration does before writing.
  if (!isPlanAttachmentPath(path, { userId, planId, taskId })) {
    throw new AppError("upload_invalid", "Could not build a storage path for that file.", {
      status: 500,
    });
  }

  const stored = await ports.upload(path, intent.bytes, contentTypeFor(intent.mimeType));
  if (stored === "exists") {
    // Only an idempotent path can collide: another request with the same key is mid-upload.
    throw new AppError(
      "idempotency_conflict",
      "An upload with this idempotency_key is still in progress. Retry in a moment.",
      { status: 409 },
    );
  }

  let row: AttachmentRow;
  try {
    row = await ports.insertAttachment({
      plan_id: planId,
      task_id: taskId,
      uploader_id: userId,
      storage_bucket: PLAN_ATTACHMENT_BUCKET,
      storage_path: path,
      file_name: intent.fileName,
      mime_type: intent.mimeType,
      size_bytes: intent.bytes.length,
      shared_with_agents: intent.sharedWithAgents,
    });
  } catch (error) {
    // Nothing points at the object: take it back out rather than leave an orphan.
    await ports.remove(path).catch(() => undefined);
    throw error;
  }

  await ports.logAttachmentAdded({
    planId,
    taskId,
    actorId: userId,
    fileName: intent.fileName,
    metadata: {
      via: "api",
      attachment_id: row.id,
      sha256,
      size_bytes: intent.bytes.length,
      mime_type: intent.mimeType,
      purpose: intent.purpose,
    },
  });

  return {
    attachment: await toDto(ports, row, { sha256, purpose: intent.purpose, replay: false }),
    created: true,
  };
}

/** A file agents may read, in the key's workspace. Anything else is the same 404. */
async function sharedAttachmentInWorkspace(
  ports: AttachmentPorts,
  workspaceId: string,
  attachmentId: string,
): Promise<AttachmentRow> {
  const missing = () => notFound("Attachment not found.");
  if (!isUuid(attachmentId)) throw missing();
  const row = await ports.attachmentById(attachmentId.toLowerCase());
  if (!row || !row.shared_with_agents) throw missing();
  if (!(await ports.planInWorkspace(row.plan_id, workspaceId))) throw missing();
  return row;
}

export interface AttachmentText extends TextPage {
  id: string;
  plan_id: string;
  task_id: string | null;
  file_name: string;
  mime_type: string | null;
  /** Of the whole file, so a reader can check it got every page. */
  sha256: string;
}

/** `GET attachments/:id/text`: a page of a Markdown or plain-text file, as text. */
export async function readAttachmentText(
  ports: AttachmentPorts,
  key: KeyContext,
  attachmentId: string,
  range: { offset: number; limit: number },
): Promise<AttachmentText> {
  await requireKeyOwner(ports, key);
  const row = await sharedAttachmentInWorkspace(ports, key.workspaceId, attachmentId);
  if (!isTextAttachment(row.mime_type, row.file_name)) {
    throw new AppError(
      "not_text",
      `${row.file_name} is not a text file (${row.mime_type ?? "unknown type"}). Use the download link instead.`,
      { status: 415 },
    );
  }
  const bytes = await ports.download(row.storage_path);
  return {
    id: row.id,
    plan_id: row.plan_id,
    task_id: row.task_id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    sha256: sha256Hex(bytes),
    ...utf8Page(bytes, range.offset, range.limit),
  };
}

/** `POST attachments/:id/download`: a link that downloads the file and expires in five minutes. */
export async function signAttachmentDownload(
  ports: AttachmentPorts,
  key: KeyContext,
  attachmentId: string,
) {
  await requireKeyOwner(ports, key);
  const row = await sharedAttachmentInWorkspace(ports, key.workspaceId, attachmentId);
  const url = await ports.sign(row.storage_path, DOWNLOAD_URL_SECONDS, row.file_name);
  if (!url) throw new AppError("storage_error", "Could not sign a download link.", { status: 502 });
  return {
    id: row.id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    size_bytes: row.size_bytes,
    url,
    expires_in: DOWNLOAD_URL_SECONDS,
  };
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

const ROW_COLUMNS =
  "id, plan_id, task_id, comment_id, uploader_id, storage_path, file_name, mime_type, size_bytes, shared_with_agents, source_attachment_id, created_at";

function isAlreadyExists(error: { message?: string; statusCode?: string | number }): boolean {
  return (
    String(error.statusCode ?? "") === "409" ||
    /already exists|duplicate/i.test(error.message ?? "")
  );
}

/** The ports over the service-role client. Every query here is scoped by the caller. */
export function supabaseAttachmentPorts(admin: Admin): AttachmentPorts {
  const bucket = () => admin.storage.from(PLAN_ATTACHMENT_BUCKET);
  return {
    async isMember(workspaceId, userId) {
      const { data, error } = await admin
        .from("workspace_members")
        .select("user_id")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async planInWorkspace(planId, workspaceId) {
      const { data, error } = await admin
        .from("plans")
        .select("id")
        .eq("id", planId)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async taskInWorkspace(taskId, workspaceId) {
      const { data, error } = await admin
        .from("plan_tasks")
        .select("id, plan_id, plans!inner(workspace_id)")
        .eq("id", taskId)
        .eq("plans.workspace_id", workspaceId)
        .maybeSingle();
      if (error) throw error;
      return data ? { id: data.id, plan_id: data.plan_id } : null;
    },
    async attachmentById(id) {
      const { data, error } = await admin
        .from("plan_task_attachments")
        .select(ROW_COLUMNS)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async attachmentByPathPrefix(planId, prefix) {
      const { data, error } = await admin
        .from("plan_task_attachments")
        .select(ROW_COLUMNS)
        .eq("plan_id", planId)
        .like("storage_path", `${prefix}%`)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async insertAttachment(row) {
      const { data, error } = await admin
        .from("plan_task_attachments")
        .insert(row)
        .select(ROW_COLUMNS)
        .single();
      if (error) throw error;
      return data;
    },
    async logAttachmentAdded(event) {
      const { error } = await admin.from("plan_events").insert({
        plan_id: event.planId,
        task_id: event.taskId,
        actor_id: event.actorId,
        kind: "attachment_added",
        new_value: event.fileName,
        metadata: event.metadata,
      });
      // The file is already saved; a missing feed entry is not worth failing the upload over.
      if (error) console.error("Planner API attachment event:", error.message);
    },
    async upload(path, bytes, contentType) {
      const { error } = await bucket().upload(path, bytes, {
        contentType,
        upsert: false,
        cacheControl: "3600",
      });
      if (!error) return "ok";
      if (isAlreadyExists(error as { message?: string; statusCode?: string })) return "exists";
      throw new AppError("storage_error", `Storage refused the file: ${error.message}`, {
        status: 502,
      });
    },
    async download(path) {
      const { data, error } = await bucket().download(path);
      if (error || !data) {
        throw new AppError("storage_error", "The stored file could not be read.", {
          status: 502,
        });
      }
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(path) {
      const { error } = await bucket().remove([path]);
      if (error) console.error("Planner API attachment cleanup:", error.message);
    },
    async sign(path, seconds, downloadAs) {
      const { data, error } = await bucket().createSignedUrl(
        path,
        seconds,
        downloadAs ? { download: downloadAs } : undefined,
      );
      if (error) return null;
      return data?.signedUrl ?? null;
    },
  };
}
