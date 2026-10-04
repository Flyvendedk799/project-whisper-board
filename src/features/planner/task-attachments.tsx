import type { TaskWithAgent } from "@/data";
import { AttachmentTile, UploadTile } from "./attachment-tile";
import { FileDropzone } from "./file-dropzone";
import { usePlanMedia } from "./plan-media";
import { pluralize } from "./plan-model";

/** Choose, drop or paste files onto a task, and see what is already attached. */
export function TaskAttachments({
  task,
  onOpenFile,
}: {
  task: TaskWithAgent;
  onOpenFile: (attachmentId: string) => void;
}) {
  const media = usePlanMedia();
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

      <FileDropzone
        onFiles={(picked) => void media.upload(task.id, picked)}
        prompt="drop them here, or paste a screenshot"
      />

      {files.length > 0 || uploading.length > 0 ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-3 max-md:grid-cols-2">
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
