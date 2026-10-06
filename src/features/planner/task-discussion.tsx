import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Paperclip, X } from "lucide-react";
import { taskCommentsQuery } from "@/data/planner";
import { qk } from "@/data/keys";
import type { PlanAttachmentWithUrl } from "@/data";
import { Button } from "@/components/ui/button";
import { MentionTextarea, type MentionTextareaHandle } from "@/components/mention-input";
import { MentionText } from "@/components/mention-text";
import { PersonAvatar } from "@/components/person-avatar";
import { useAuth } from "@/components/auth-provider";
import { workspacePeopleQuery } from "@/data/projects";
import { addTaskComment } from "@/lib/planner.functions";
import { useServerAction } from "@/lib/use-server-action";
import { attachmentKindOf, fileExtensionLabel } from "@/lib/upload";
import { timeAgo } from "./plan-model";
import { usePlanMedia } from "./plan-media";

type Author =
  | { id?: string; full_name?: string | null; email?: string | null; avatar_url?: string | null }
  | null
  | undefined;
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
      className="flex max-w-60 items-center gap-2 rounded-lg border bg-card py-1 pl-1 pr-2.5 text-xs hover:border-primary/50 max-md:min-h-11 max-md:max-w-full max-md:text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
  composerRef: React.MutableRefObject<HTMLTextAreaElement | null>;
}) {
  const media = usePlanMedia();
  const comments = useQuery(taskCommentsQuery(taskId));
  const { user, workspaceId } = useAuth();
  const people = useQuery(workspacePeopleQuery(workspaceId));
  const names = useMemo(
    () =>
      new Map(
        (people.data ?? []).map((person) => [person.id, person.full_name || person.email || ""]),
      ),
    [people.data],
  );
  const composer = useRef<MentionTextareaHandle>(null);
  const [body, setBody] = useState("");
  const [pendingIds, setPendingIds] = useState<string[]>([]);
  const inputId = useRef(`note-files-${taskId}`).current;

  const post = useServerAction(useServerFn(addTaskComment), {
    label: "comments.add",
    invalidate: [qk.taskComments(taskId), qk.planEvents(planId), qk.plan(planId)],
    onSuccess: () => {
      setBody("");
      setPendingIds([]);
      composer.current?.reset();
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
    // "@Ada" for each picked teammate becomes "@[Ada](user:<id>)" in the note.
    const text = (composer.current?.encoded() ?? body).trim();
    post.fire({
      taskId,
      body: text || (pendingIds.length ? "Attached files" : ""),
      attachmentIds: pendingIds,
    });
  };

  const rows = comments.data?.comments ?? [];

  return (
    <section
      className="flex flex-col gap-3.5 border-t pt-[22px] max-md:contents"
      aria-labelledby={`discussion-${taskId}`}
    >
      <div className="contents max-md:flex max-md:flex-col max-md:gap-3.5 max-md:border-t max-md:pt-5">
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
              entry.body.trim().length > 0 &&
              !(files.length > 0 && entry.body === "Attached files");
            return (
              <li key={entry.id} className="flex gap-2.5">
                {agent ? (
                  <div
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-chart-5/20 text-[10px] font-semibold"
                  >
                    AI
                  </div>
                ) : (
                  <PersonAvatar person={author} size="md" className="h-7 w-7 text-[10px]" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">
                    <b className="font-medium text-foreground">{name}</b> ·{" "}
                    {timeAgo(entry.created_at)}
                  </div>
                  {showBody ? (
                    <div className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed max-md:break-words">
                      <MentionText text={entry.body} names={names} />
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
      </div>

      <div className="flex flex-col gap-2 max-md:sticky max-md:bottom-0 max-md:z-10 max-md:-mx-4 max-md:border-t max-md:bg-background/95 max-md:px-4 max-md:pb-[calc(0.75rem+var(--safe-bottom))] max-md:pt-3 max-md:backdrop-blur">
        {pendingFiles.length > 0 || composerUploads.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5 max-md:gap-2" aria-label="Files on this note">
            {pendingFiles.map((file) => (
              <li
                key={file.id}
                className="flex items-center gap-2 rounded-full bg-muted py-1 pl-2.5 pr-1.5 text-xs max-md:max-w-full"
              >
                <span className="max-md:min-w-0 max-md:truncate">{file.file_name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.file_name}`}
                  className="px-1 text-sm leading-none max-md:-my-2.5 max-md:-mr-2 max-md:grid max-md:h-10 max-md:w-10 max-md:shrink-0 max-md:place-items-center"
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
                  className="flex items-center gap-2 rounded-full bg-muted px-2.5 py-1 text-xs max-md:max-w-full"
                >
                  <span className="max-md:min-w-0 max-md:truncate">{item.name}</span>
                  <span className="text-muted-foreground">
                    {item.status === "error" ? "failed" : `${item.progress}%`}
                  </span>
                </li>
              ))}
          </ul>
        ) : null}

        <div className="flex gap-2 max-md:items-end">
          <MentionTextarea
            ref={composer}
            textareaRef={composerRef}
            value={body}
            onValueChange={setBody}
            people={people.data ?? []}
            excludeId={user?.id}
            wrapperClassName="min-w-0 flex-1"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            aria-label="Leave a note"
            enterKeyHint="send"
            placeholder="Leave a note. Type @ to mention a teammate; paste a screenshot to attach it."
            className="min-h-[38px] w-full resize-y text-sm max-md:max-h-40 max-md:min-h-11 max-md:resize-none max-md:[field-sizing:content]"
          />
          <label
            htmlFor={inputId}
            className="flex h-[38px] cursor-pointer items-center rounded-lg border px-3.5 text-[13px] hover:bg-muted/60 focus-within:ring-2 focus-within:ring-ring max-md:h-11 max-md:w-11 max-md:shrink-0 max-md:justify-center max-md:px-0"
          >
            <Paperclip className="h-5 w-5 md:hidden" aria-hidden="true" />
            <span className="max-md:sr-only">Attach</span>
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
            className="h-[38px] bg-foreground px-4 text-[13px] text-background hover:bg-foreground/90 max-md:shrink-0"
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
