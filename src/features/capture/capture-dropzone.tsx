import { useId, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Paperclip, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBytes, validateFile, type DraftAttachment } from "@/lib/upload";
import { toast } from "sonner";

/**
 * Drag, drop, paste or pick.
 *
 * The version this replaces was a bare `<div tabIndex={0}>` with pointer
 * handlers and no role, label or key handler — reachable by Tab and then
 * completely inert, which is worse than not being focusable at all.
 */
export function CaptureDropzone({
  drafts,
  onAdd,
  onRemove,
  label = "Attachments",
}: {
  drafts: DraftAttachment[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  label?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const describedBy = useId();

  const accept = (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files);
    if (list.length === 0) return;

    // Rejected here rather than at upload, so the reason arrives while the
    // person is still looking at the file they picked.
    const rejected = list.filter((file) => validateFile(file, "attachments") !== null);
    rejected.forEach((file) => toast.error(validateFile(file, "attachments")!));

    const accepted = list.filter((file) => !rejected.includes(file));
    if (accepted.length) {
      onAdd(accepted);
      setAnnouncement(`${accepted.length} file${accepted.length > 1 ? "s" : ""} added`);
    }
  };

  const openPicker = () => inputRef.current?.click();

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        aria-label={`${label}. Press Enter to choose files, or drop them here.`}
        aria-describedby={describedBy}
        onClick={openPicker}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        onPaste={(event) => {
          const files = Array.from(event.clipboardData.files);
          if (files.length) {
            event.preventDefault();
            accept(files);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          accept(event.dataTransfer.files);
        }}
        className={`cursor-pointer rounded-lg border border-dashed p-4 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          dragActive ? "border-primary bg-accent/40" : "hover:border-foreground/30"
        }`}
      >
        <Paperclip className="mx-auto h-5 w-5 text-muted-foreground" aria-hidden="true" />
        <p className="mt-1.5 text-sm">
          <span className="font-medium">Choose files</span>, or drop them here
        </p>
        <p id={describedBy} className="mt-0.5 text-xs text-muted-foreground">
          Screenshots, recordings, PDFs. You can paste an image straight from your clipboard.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          accept(event.target.files);
          // Reset so re-picking the same file still fires a change.
          event.target.value = "";
        }}
      />

      {drafts.length > 0 && (
        <ul className="space-y-1.5">
          {drafts.map((draft) => (
            <li
              key={draft.id}
              className="flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-sm"
            >
              <DraftIcon draft={draft} />
              <span className="min-w-0 flex-1 truncate">{draft.file.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {formatBytes(draft.file.size)}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                aria-label={`Remove ${draft.file.name}`}
                onClick={() => {
                  onRemove(draft.id);
                  setAnnouncement(`${draft.file.name} removed`);
                }}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}

function DraftIcon({ draft }: { draft: DraftAttachment }) {
  const className = "h-4 w-4 shrink-0 text-muted-foreground";
  if (draft.file.type.startsWith("image/"))
    return <ImageIcon className={className} aria-hidden="true" />;
  if (draft.file.type.startsWith("video/"))
    return <Video className={className} aria-hidden="true" />;
  return <FileText className={className} aria-hidden="true" />;
}
