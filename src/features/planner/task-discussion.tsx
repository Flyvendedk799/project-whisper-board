import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { X } from "lucide-react";
import { taskCommentsQuery } from "@/data/planner";
import { qk } from "@/data/keys";
import type { PlanAttachmentWithUrl } from "@/data";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { addTaskComment } from "@/lib/planner.functions";
import { useServerAction } from "@/lib/use-server-action";
import { attachmentKindOf, fileExtensionLabel } from "@/lib/upload";
import { initials, timeAgo } from "./plan-model";
import { usePlanMedia } from "./plan-media";

type Author = { full_name?: string | null; email?: string | null } | null | undefined;
type AgentRef = { name?: string | null } | null | undefined;

function FileChip({
  attachment,
  onOpen,
}: {
  attachment: PlanAttachmentWithUrl;
  onOpen: () => void;
}) {
  const image = attachmentKindOf(attachment.mime_type) === "image" && attachment.url;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex max-w-60 items-center gap-2 rounded-lg border bg-card py-1 pl-1 pr-2.5 text-xs hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[5px] bg-muted font-mono text-[10px]">
        {image ? (
          <img src={attachment.url!} alt="" className="h-full w-full object-cover" />
        ) : (
          fileExtensionLabel(attachment.file_name)
        )}
      </span>
      <span className="truncate">{attachment.file_name}</span>
    </button>
  );
}

/** Notes on a task. Files attached here belong to the note and to the task. */
export function TaskDiscussion({
  taskId,
  planId,
  onOpenFile,
  composerRef,
}: {
  taskId: string;
  planId: string;
  onOpenFile: (attachmentId: string) => void;
  /** The drawer pastes screenshots into this field. */
  composerRef: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const media = usePlanMedia();
  const comments = useQuery(taskCommentsQuery(taskId));
  const [body, setBody] = useState("");
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const inputId = useRef(`note-files-${taskId}`).current;

  const post = useServerAction(useServerFn(addTaskComment), {
    label: "comments.add",
    invalidate: [qk.taskComments(taskId), qk.planEvents(planId), qk.plan(planId)],
    onSuccess: () => {
      setBody("");
      setPendingIds([]);
    },
  });

  const pendingFiles = pendingIds
    .map((id) => media.lookup(id))
    .filter((a): a is PlanAttachmentWithUrl => Boolean(a));
  const composerUploads = media.uploads.filter((u) => u.taskId === taskId && u.composer);

  const filesByComment = useMemo(() => {
    const map = new Map<string, PlanAttachmentWithUrl[]>();
    for (const attachment of media.visible) {
      if (attachment.task_id !== taskId || !attachment.comment_id) continue;
      const list = map.get(attachment.comment_id) ?? [];
      list.push(attachment);
      map.set(attachment.comment_id, list);
    }
    return map;
  }, [media.visible, taskId]);

  const attachToNote = async (files: File[]) => {
    const ids = await media.upload(taskId, files, { composer: true });
    if (ids.length) setPendingIds((current) => [...current, ...ids]);
  };

  const submit = () => {
    if (post.busy) return;
    if (!body.trim() && pendingIds.length === 0) return;
    post.fire({
      taskId,
      body: body.trim() || (pendingIds.length ? "Attached files" : ""),
      attachmentIds: pendingIds,
    });
  };

  const rows = comments.data?.comments ?? [];

  return (
    <section
      className="flex flex-col gap-3.5 border-t pt-[22px]"
      aria-labelledby={`discussion-${taskId}`}
    >
      <h3 id={`discussion-${taskId}`} className="font-display text-[22px] leading-none">
        Discussion
      </h3>

      <ul className="flex flex-col gap-3.5">
        {rows.map((entry) => {
          const agent = entry.agent as AgentRef;
          const author = entry.author as Author;
          const name = agent?.name ?? author?.full_name ?? author?.email ?? "Someone";
          const files = filesByComment.get(entry.id) ?? [];
          const showBody =
            entry.body.trim().length > 0 && !(files.length > 0 && entry.body === "Attached files");
          return (
            <li key={entry.id} className="flex gap-2.5">
              <div
                aria-hidden="true"
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  agent ? "bg-chart-5/20" : "bg-accent"
                }`}
              >
                {agent ? "AI" : initials(name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs text-muted-foreground">
                  <b className="font-medium text-foreground">{name}</b> ·{" "}
                  {timeAgo(entry.created_at)}
                </div>
                {showBody ? (
                  <div className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed">
                    {entry.body}
                  </div>
                ) : null}
                {files.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {files.map((file) => (
                      <FileChip
                        key={file.id}
                        attachment={file}
                        onOpen={() => onOpenFile(file.id)}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      {rows.length === 0 && !comments.isPending ? (
        <p className="text-[13px] text-muted-foreground">
          No notes yet. Notes and their files are read by agents working on this task.
        </p>
      ) : null}

      <div className="flex flex-col gap-2">
        {pendingFiles.length > 0 || composerUploads.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5" aria-label="Files on this note">
            {pendingFiles.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-2 rounded-full bg-muted py-1 pl-2.5 pr-1.5 text-xs"
              >
                {file.file_name}
                <button
                  type="button"
                  aria-label={`Remove ${file.file_name}`}
                  className="px-1 text-sm leading-none"
                  onClick={() => {
                    setPendingIds((current) => current.filter((id) => id !== file.id));
                    media.remove(file);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {composerUploads
              .filter((u) => !u.attachmentId)
              .map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-2 rounded-full bg-muted px-2.5 py-1 text-xs"
                >
                  {item.name}
                  <span className="text-muted-foreground">
                    {item.status === "error" ? "failed" : `${item.progress}%`}
                  </span>
                </li>
              ))}
          </ul>
        ) : null}

        <div className="flex gap-2">
          <Textarea
            ref={composerRef}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            aria-label="Leave a note"
            placeholder="Leave a note. Paste a screenshot to attach it."
            className="min-h-[38px] flex-1 resize-y text-sm"
          />
          <label
            htmlFor={inputId}
            className="flex h-[38px] cursor-pointer items-center rounded-lg border px-3.5 text-[13px] hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring"
          >
            Attach
            <input
              id={inputId}
              type="file"
              multiple
              className="sr-only"
              aria-label="Attach files to this note"
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (picked.length) void attachToNote(picked);
              }}
            />
          </label>
          <Button
            type="button"
            className="h-[38px] bg-foreground px-4 text-[13px] text-background hover:bg-foreground/90"
            disabled={post.busy || (!body.trim() && pendingIds.length === 0)}
            onClick={submit}
          >
            {post.busy ? "Posting…" : "Post"}
          </Button>
        </div>
      </div>
    </section>
  );
}
