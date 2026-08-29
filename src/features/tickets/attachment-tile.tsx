import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { FileText, Play, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";
import { signedAttachmentUrl } from "@/lib/admin.functions";
import { formatBytes } from "@/lib/upload";
import type { TicketAttachment } from "@/data/types";

/**
 * Attachments open in place.
 *
 * Previously each tile fired its own signing request from a bare useEffect with
 * no error handling and no caching, and clicking opened a raw signed URL in a
 * new tab. Watching a two-minute recording of your own product should not mean
 * leaving the ticket.
 */
export function AttachmentGrid({ attachments }: { attachments: TicketAttachment[] }) {
  const [open, setOpen] = useState<TicketAttachment | null>(null);

  // An annotated copy supersedes its original; showing both is just confusing.
  const superseded = new Set(
    attachments.map((a) => a.source_attachment_id).filter((id): id is string => Boolean(id)),
  );
  const visible = attachments.filter((a) => !superseded.has(a.id) && a.kind !== "thumbnail");

  if (visible.length === 0) return null;

  return (
    <>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {visible.map((attachment) => (
          <li key={attachment.id}>
            <AttachmentTile attachment={attachment} onOpen={() => setOpen(attachment)} />
          </li>
        ))}
      </ul>

      <Dialog open={Boolean(open)} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="max-w-4xl">
          <DialogTitle className="truncate text-base">{open?.file_name}</DialogTitle>
          {open && <AttachmentViewer attachment={open} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function useSignedUrl(attachment: TicketAttachment) {
  const sign = useServerFn(signedAttachmentUrl);
  return useQuery({
    queryKey: ["attachment-url", attachment.id],
    // Signed for ten minutes server-side; refresh a little before that.
    staleTime: 8 * 60_000,
    queryFn: async () => {
      const { url } = await sign({
        data: {
          bucket: attachment.storage_bucket as "attachments" | "recordings",
          path: attachment.storage_path,
        },
      });
      return url;
    },
  });
}

function AttachmentTile({
  attachment,
  onOpen,
}: {
  attachment: TicketAttachment;
  onOpen: () => void;
}) {
  const { data: url, isPending, isError } = useSignedUrl(attachment);
  const isImage = attachment.mime_type?.startsWith("image/") ?? false;
  const isVideo = attachment.mime_type?.startsWith("video/") || attachment.is_recording;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="relative grid aspect-video place-items-center overflow-hidden rounded-md border bg-muted">
        {isPending ? (
          <Skeleton className="h-full w-full" />
        ) : isError || !url ? (
          <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        ) : isImage ? (
          <img src={url} alt={attachment.file_name} className="h-full w-full object-cover" />
        ) : isVideo ? (
          <>
            <video src={url} className="h-full w-full object-cover" preload="metadata" />
            <span className="absolute inset-0 grid place-items-center bg-foreground/25">
              <Play className="h-7 w-7 fill-current text-background" aria-hidden="true" />
            </span>
          </>
        ) : (
          <FileText className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
        )}

        {attachment.kind === "annotated" && (
          <span className="absolute left-1.5 top-1.5">
            <StatusPill tone="info">Marked up</StatusPill>
          </span>
        )}
        {attachment.has_audio && (
          <span className="absolute right-1.5 top-1.5">
            <StatusPill tone="default">
              <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />
              Narrated
            </StatusPill>
          </span>
        )}
      </div>

      <div className="mt-1 truncate text-xs group-hover:text-primary">{attachment.file_name}</div>
      <div className="text-xs text-muted-foreground">
        {attachment.size_bytes ? formatBytes(attachment.size_bytes) : ""}
      </div>
    </button>
  );
}

function AttachmentViewer({ attachment }: { attachment: TicketAttachment }) {
  const { data: url, isPending, isError } = useSignedUrl(attachment);

  if (isPending) return <Skeleton className="aspect-video w-full" />;
  if (isError || !url) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Couldn&rsquo;t open that file.
      </p>
    );
  }

  if (attachment.mime_type?.startsWith("image/")) {
    return (
      <img src={url} alt={attachment.file_name} className="max-h-[70vh] w-full object-contain" />
    );
  }

  if (attachment.mime_type?.startsWith("video/") || attachment.is_recording) {
    return <video src={url} controls autoPlay className="max-h-[70vh] w-full" />;
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="block py-8 text-center text-sm underline"
    >
      Open {attachment.file_name}
    </a>
  );
}
