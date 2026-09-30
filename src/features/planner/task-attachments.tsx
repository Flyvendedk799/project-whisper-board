import { useId, useState } from "react";
import type { TaskWithAgent } from "@/data";
import { PLAN_ATTACHMENT_ACCEPT_HINT } from "@/lib/upload";
import { cn } from "@/lib/utils";
import { AttachmentTile, UploadTile } from "./attachment-tile";
import { usePlanMedia } from "./plan-media";
import { hasFiles, pluralize } from "./plan-model";

/** Choose, drop or paste files onto a task, and see what is already attached. */
export function TaskAttachments({
  task,
  onOpenFile,
}: {
  task: TaskWithAgent;
  onOpenFile: (attachmentId: string) => void;
}) {
  const media = usePlanMedia();
  const inputId = useId();
  const [over, setOver] = useState(false);
  const files = media.byTask.get(task.id) ?? [];
  const uploading = media.uploads.filter((u) => u.taskId === task.id);

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`files-${task.id}`}>
      <div className="flex items-baseline gap-2.5">
        <h3 id={`files-${task.id}`} className="font-display text-[22px] leading-none">
          Attachments
        </h3>
        {files.length > 0 ? (
          <span className="text-xs text-muted-foreground">{pluralize(files.length, "file")}</span>
        ) : null}
        <span className="flex-1" />
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Shared files are included in the agent&rsquo;s task context
        </span>
      </div>

      <label
        htmlFor={inputId}
        onDragOver={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const dropped = Array.from(event.dataTransfer.files);
          if (dropped.length) void media.upload(task.id, dropped);
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center gap-1 rounded-xl border-[1.5px] border-dashed p-[18px] text-center transition-colors",
          over ? "border-primary bg-accent" : "border-input bg-background hover:bg-muted/40",
        )}
      >
        <span className="text-sm">
          <b className="font-medium">Choose files</b>, drop them here, or paste a screenshot
        </span>
        <span className="text-xs text-muted-foreground">{PLAN_ATTACHMENT_ACCEPT_HINT}</span>
        <input
          id={inputId}
          type="file"
          multiple
          className="sr-only"
          aria-label="Attach files"
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (picked.length) void media.upload(task.id, picked);
          }}
        />
      </label>

      {files.length > 0 || uploading.length > 0 ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3">
          {files.map((attachment) => (
            <li key={attachment.id}>
              <AttachmentTile attachment={attachment} onOpen={() => onOpenFile(attachment.id)} />
            </li>
          ))}
          {uploading.map((item) => (
            <li key={item.id}>
              <UploadTile item={item} onDismiss={() => media.dismissUpload(item.id)} />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
