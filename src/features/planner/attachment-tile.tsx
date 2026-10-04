import { Play } from "lucide-react";
import type { PlanAttachmentWithUrl } from "@/data";
import { attachmentKindOf, fileExtensionLabel, formatBytes } from "@/lib/upload";
import { cn } from "@/lib/utils";
import type { UploadItem } from "./use-plan-uploads";

/** The picture part of a tile: image, first frame of a video, or an extension chip. */
export function AttachmentPreview({
  name,
  mime,
  url,
  className,
}: {
  name: string;
  mime: string | null;
  url: string | null;
  className?: string;
}) {
  const kind = attachmentKindOf(mime);
  return (
    <div
      className={cn(
        "relative flex aspect-[16/10] items-center justify-center overflow-hidden bg-muted/60",
        className,
      )}
    >
      {kind === "image" && url ? (
        <img src={url} alt={name} loading="lazy" className="h-full w-full object-cover" />
      ) : kind === "video" && url ? (
        <>
          <video
            src={`${url}#t=0.1`}
            preload="metadata"
            muted
            playsInline
            className="h-full w-full object-cover"
          />
          <span className="absolute flex h-10 w-10 items-center justify-center rounded-full bg-foreground/65 pl-0.5 text-background">
            <Play className="h-4 w-4 fill-current" aria-hidden="true" />
          </span>
        </>
      ) : (
        <span className="rounded-md bg-secondary px-3 py-1.5 font-mono text-xs font-medium">
          {fileExtensionLabel(name)}
        </span>
      )}
    </div>
  );
}

export function SharedPill({ shared }: { shared: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-px text-[11px] text-accent-foreground max-md:text-xs",
        shared ? "bg-chart-5/20" : "bg-muted",
      )}
    >
      {shared ? "Agents can see" : "Hidden from agents"}
    </span>
  );
}

export function AttachmentTile({
  attachment,
  onOpen,
  roomy = false,
}: {
  attachment: PlanAttachmentWithUrl;
  onOpen: () => void;
  /** The Files layout uses larger captions than the drawer. */
  roomy?: boolean;
}) {
  const uploader = attachment.uploader?.full_name ?? attachment.uploader?.email ?? "";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group overflow-hidden rounded-xl border bg-card text-left transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative">
        <AttachmentPreview
          name={attachment.file_name}
          mime={attachment.mime_type}
          url={attachment.url}
        />
        {attachment.source_attachment_id ? (
          <span className="absolute left-2 top-2 rounded-full bg-info/20 px-2 py-0.5 text-[11px] font-medium text-foreground">
            Marked up
          </span>
        ) : null}
      </div>
      <div className={cn("flex flex-col gap-0.5", roomy ? "px-3 py-2.5" : "px-2.5 py-2")}>
        <span className="truncate text-[13px] font-medium">{attachment.file_name}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground max-md:flex-col max-md:items-start max-md:gap-1 max-md:text-xs">
          <span className="min-w-0 flex-1 truncate max-md:w-full max-md:flex-none">
            {attachment.size_bytes ? formatBytes(attachment.size_bytes) : ""}
            {uploader ? ` · ${uploader}` : ""}
          </span>
          <SharedPill shared={attachment.shared_with_agents} />
        </span>
      </div>
    </button>
  );
}

export function UploadTile({ item, onDismiss }: { item: UploadItem; onDismiss?: () => void }) {
  const failed = item.status === "error";
  return (
    <div className="overflow-hidden rounded-xl border bg-card" aria-live="polite">
      <div className="relative">
        <AttachmentPreview name={item.name} mime={item.type} url={item.previewUrl ?? null} />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-card/70 text-xs">
          {failed ? (
            <>
              <span className="px-3 text-center text-destructive">{item.error}</span>
              {onDismiss ? (
                <button
                  type="button"
                  className="underline max-md:min-h-11 max-md:px-4"
                  onClick={onDismiss}
                >
                  Dismiss
                </button>
              ) : null}
            </>
          ) : (
            <>
              <span>{item.status === "saving" ? "Saving" : `Uploading ${item.progress}%`}</span>
              <span
                role="progressbar"
                aria-valuenow={item.progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`Uploading ${item.name}`}
                className="h-1 w-[70%] overflow-hidden rounded-full bg-border"
              >
                <span
                  className="block h-full bg-primary transition-[width]"
                  style={{ width: `${item.progress}%` }}
                />
              </span>
            </>
          )}
        </div>
      </div>
      <div className="px-2.5 py-2">
        <span className="block truncate text-[13px] font-medium">{item.name}</span>
        <span className="text-[11px] text-muted-foreground">{formatBytes(item.size)}</span>
      </div>
    </div>
  );
}
