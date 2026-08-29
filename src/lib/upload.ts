import { AppError, DataError } from "@/lib/errors";
import { captureError } from "@/lib/providers";
import { insertAttachment, removeStorageObject, uploadToStorage } from "@/data/mutations";
import type { TicketAttachment } from "@/data/types";

/**
 * Uploading an attachment, in one place, with three bugs fixed.
 *
 * 1. The storage policy requires the first path segment to be the uploader's
 *    id. Both existing call sites built `${projectId}/${ticketId}/…` and
 *    `${ticketId}/…`, so every upload by a non-admin was rejected — the client
 *    capture flow could not have worked.
 * 2. The metadata insert was unchecked at both call sites, so a failure left
 *    the file in the bucket with no row pointing at it and no way to find it.
 *    Here a failed insert removes the object it orphaned.
 * 3. There was no size or type validation anywhere, on any path.
 */

export type AttachmentBucket = "attachments" | "recordings";
export type AttachmentKind = "file" | "image" | "screenshot" | "recording" | "annotated";

export interface DraftAttachment {
  file: File;
  bucket: AttachmentBucket;
  kind: AttachmentKind;
  /** Object URL for local preview. Revoked by the owner of the draft. */
  previewUrl?: string;
  /** Annotation ops, kept so the drawing stays editable after upload. */
  annotations?: unknown;
  width?: number;
  height?: number;
  durationMs?: number;
  hasAudio?: boolean;
  /** Links an annotated copy back to the untouched original. */
  sourceDraftId?: string;
  id: string;
}

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_RECORDING_BYTES = 200 * 1024 * 1024;

const ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "video/webm",
  "video/mp4",
  "video/quicktime",
  "audio/webm",
  "audio/mpeg",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "application/zip",
  "application/x-zip-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Returns a sentence explaining the refusal, or null when the file is fine. */
export function validateFile(file: File, bucket: AttachmentBucket): string | null {
  const limit = bucket === "recordings" ? MAX_RECORDING_BYTES : MAX_FILE_BYTES;
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > limit) {
    return `${file.name} is ${formatBytes(file.size)} — the limit is ${formatBytes(limit)}.`;
  }
  // An empty type is what browsers report for some drag-and-drop sources;
  // rejecting those would block legitimate uploads for no real gain.
  if (file.type && !ALLOWED_MIME.includes(file.type)) {
    return `${file.name} is a ${file.type} file, which can't be attached.`;
  }
  return null;
}

/** Keeps the name recognisable in the bucket without letting it escape the path. */
export function slugifyFileName(name: string): string {
  const trimmed = name.slice(-120);
  return (
    trimmed
      .normalize("NFKD")
      .replace(/[^\w.-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^[-.]+/, "")
      .toLowerCase() || "file"
  );
}

/**
 * The first segment must be the uploader's id — that is what
 * `storage_upload_own` checks, and getting it wrong is why uploads failed.
 */
export function attachmentPath(userId: string, ticketId: string, fileName: string): string {
  return `${userId}/${ticketId}/${crypto.randomUUID()}-${slugifyFileName(fileName)}`;
}

export interface UploadOutcome {
  uploaded: TicketAttachment[];
  failed: Array<{ name: string; reason: string }>;
}

/** Three at a time: enough to use the connection, few enough to stay responsive. */
const CONCURRENCY = 3;

export async function uploadDrafts(
  ticketId: string,
  userId: string,
  drafts: DraftAttachment[],
  onProgress?: (done: number, total: number) => void,
): Promise<UploadOutcome> {
  const uploaded: TicketAttachment[] = [];
  const failed: UploadOutcome["failed"] = [];
  // Maps a draft's local id to the attachment row it became, so an annotated
  // copy can point at the original once both exist.
  const rowIdByDraftId = new Map<string, string>();
  let done = 0;

  // Originals first, so `source_attachment_id` can be resolved in one pass.
  const ordered = [...drafts].sort(
    (a, b) => Number(Boolean(a.sourceDraftId)) - Number(Boolean(b.sourceDraftId)),
  );

  const runOne = async (draft: DraftAttachment) => {
    const problem = validateFile(draft.file, draft.bucket);
    if (problem) {
      failed.push({ name: draft.file.name, reason: problem });
      return;
    }

    const path = attachmentPath(userId, ticketId, draft.file.name);

    const { error: uploadError } = await uploadToStorage(draft.bucket, path, draft.file);

    if (uploadError) {
      failed.push({ name: draft.file.name, reason: uploadError.message });
      return;
    }

    const { data, error: insertError } = await insertAttachment({
      ticket_id: ticketId,
      uploader_id: userId,
      storage_bucket: draft.bucket,
      storage_path: path,
      file_name: draft.file.name,
      mime_type: draft.file.type || null,
      size_bytes: draft.file.size,
      is_recording: draft.bucket === "recordings",
      kind: draft.kind,
      annotations: (draft.annotations ?? null) as never,
      width: draft.width ?? null,
      height: draft.height ?? null,
      duration_ms: draft.durationMs ?? null,
      has_audio: draft.hasAudio ?? null,
      source_attachment_id: draft.sourceDraftId
        ? (rowIdByDraftId.get(draft.sourceDraftId) ?? null)
        : null,
    });

    if (insertError || !data) {
      // The file is in the bucket but nothing references it. Take it back out
      // rather than leaving an orphan nobody can find or delete.
      const { error: cleanupError } = await removeStorageObject(draft.bucket, [path]);
      if (cleanupError) {
        captureError(new DataError("storage.remove", cleanupError), {
          scope: "upload",
          path,
          note: "orphaned object could not be removed",
        });
      }
      failed.push({
        name: draft.file.name,
        reason: insertError?.message ?? "Could not record the attachment.",
      });
      return;
    }

    rowIdByDraftId.set(draft.id, data.id);
    uploaded.push(data);
  };

  for (let i = 0; i < ordered.length; i += CONCURRENCY) {
    await Promise.all(ordered.slice(i, i + CONCURRENCY).map(runOne));
    done = Math.min(ordered.length, i + CONCURRENCY);
    onProgress?.(done, ordered.length);
  }

  return { uploaded, failed };
}

/** Reports partial failure honestly instead of a blanket success toast. */
export function describeOutcome(outcome: UploadOutcome): string | null {
  if (outcome.failed.length === 0) return null;
  if (outcome.uploaded.length === 0) {
    return outcome.failed.length === 1
      ? outcome.failed[0].reason
      : `None of the ${outcome.failed.length} files could be attached.`;
  }
  return `${outcome.uploaded.length} attached, ${outcome.failed.length} failed: ${outcome.failed[0].reason}`;
}

export function assertUploadable(drafts: DraftAttachment[]) {
  const problems = drafts
    .map((d) => validateFile(d.file, d.bucket))
    .filter((p): p is string => p !== null);
  if (problems.length) {
    throw new AppError("upload_invalid", problems[0], { context: { problems } });
  }
}

/** Local id for a draft, used to link an annotated copy to its original. */
export function newDraftId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `d-${Math.random().toString(36).slice(2)}`;
}
