import { useEffect, useId, useRef, useState } from "react";
import { Camera, FileText, Image as ImageIcon, MonitorUp, Paperclip, Video, X } from "lucide-react";
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
  title,
  description,
  actions,
  accept: acceptAttr,
  compact = false,
  touchPicker = false,
  onCaptureScreen,
}: {
  drafts: DraftAttachment[];
  onAdd: (files: File[]) => void;
  onRemove: (id: string) => void;
  label?: string;
  /** Replaces the default "Choose files, or drop them here" heading. */
  title?: string;
  /** Replaces the default hint line. */
  description?: string;
  /** Extra controls rendered inside the box (they do not open the file picker). */
  actions?: React.ReactNode;
  /** `accept` attribute for the file picker, e.g. `image/*`. */
  accept?: string;
  /** Phone only: collapse the drop box to a single slim row (for composers). */
  compact?: boolean;
  /**
   * Phone only: swap the drop box for big camera / photo / file buttons, the
   * three things a thumb can actually do. Drop and paste keep working on
   * desktop, where the box is unchanged.
   */
  touchPicker?: boolean;
  /** Phone only, with `touchPicker`: a "capture this screen" button, shown only where the browser can. */
  onCaptureScreen?: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const describedBy = useId();
  const canCaptureScreen = useCanCaptureScreen();

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
        className={`cursor-pointer rounded-[14px] border-[1.5px] border-dashed bg-card p-[22px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          title ? "text-left" : "text-center"
        } ${dragActive ? "border-primary bg-accent/40" : "hover:border-foreground/30"} ${
          touchPicker ? "max-md:hidden" : ""
        } ${
          compact
            ? "max-md:flex max-md:min-h-12 max-md:items-center max-md:gap-2.5 max-md:p-3 max-md:text-left"
            : ""
        }`}
      >
        {title ? (
          <p className="font-medium">{title}</p>
        ) : (
          <>
            <Paperclip
              className={`mx-auto h-5 w-5 text-muted-foreground ${compact ? "max-md:mx-0 max-md:shrink-0" : ""}`}
              aria-hidden="true"
            />
            <p className={`mt-1.5 text-sm ${compact ? "max-md:mt-0" : ""}`}>
              <span className="font-medium">Choose files</span>
              <span className="max-md:hidden">, or drop them here</span>
            </p>
          </>
        )}
        <p
          id={describedBy}
          className={`text-muted-foreground ${title ? "mt-1 text-[13px]" : "mt-0.5 text-xs"} ${
            compact ? "max-md:hidden" : ""
          }`}
        >
          {description ?? (
            <>
              <span className="max-md:hidden">
                Screenshots, recordings, PDFs. You can paste an image straight from your clipboard.
              </span>
              <span className="md:hidden">Photos, screenshots, recordings or PDFs.</span>
            </>
          )}
        </p>
        {actions ? (
          <div
            className="mt-3 flex flex-wrap gap-2"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {actions}
          </div>
        ) : null}
      </div>

      {touchPicker && (
        <div className="grid grid-cols-2 gap-3 md:hidden">
          <PickTile
            icon={<Camera className="h-7 w-7" aria-hidden="true" />}
            label="Take a photo"
            hint="Opens your camera"
            accept="image/*"
            capture="environment"
            onFiles={accept}
          />
          <PickTile
            icon={<ImageIcon className="h-7 w-7" aria-hidden="true" />}
            label="Choose a photo"
            hint="Photos or screenshots"
            accept="image/*"
            multiple
            onFiles={accept}
          />
          {canCaptureScreen && onCaptureScreen && (
            <button
              type="button"
              onClick={onCaptureScreen}
              className="col-span-2 flex h-12 items-center justify-center gap-2 rounded-xl border bg-card text-sm font-medium active:bg-muted"
            >
              <MonitorUp className="h-4 w-4" aria-hidden="true" />
              Capture this screen
            </button>
          )}
          <PickTile
            icon={<Paperclip className="h-4 w-4" aria-hidden="true" />}
            label="Attach a file or video"
            accept={acceptAttr}
            multiple
            wide
            onFiles={accept}
          />
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={acceptAttr}
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
              className={`flex items-center gap-2 rounded-md bg-muted/50 px-2 py-1.5 text-sm max-md:py-0.5 max-md:pl-3 ${
                touchPicker && draft.file.type.startsWith("image/") ? "max-md:hidden" : ""
              }`}
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
                className="h-6 w-6 shrink-0 max-md:-mr-1"
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

/** Whether this browser can capture the screen. Phones cannot; ask the browser rather than guess. */
function useCanCaptureScreen() {
  const [can, setCan] = useState(false);
  useEffect(() => {
    setCan(typeof navigator.mediaDevices?.getDisplayMedia === "function");
  }, []);
  return can;
}

function PickTile({
  icon,
  label,
  hint,
  accept,
  capture,
  multiple,
  wide,
  onFiles,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  accept?: string;
  capture?: "environment" | "user";
  multiple?: boolean;
  wide?: boolean;
  onFiles: (files: FileList | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={
          wide
            ? "col-span-2 flex h-12 items-center justify-center gap-2 rounded-xl border bg-card text-sm font-medium active:bg-muted"
            : "flex min-h-28 flex-col items-center justify-center gap-1.5 rounded-xl border-[1.5px] border-dashed bg-card px-3 py-4 text-center active:bg-muted"
        }
      >
        <span className={wide ? "" : "text-primary"}>{icon}</span>
        <span className={wide ? "" : "text-sm font-medium"}>{label}</span>
        {hint && !wide ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        capture={capture}
        multiple={multiple}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(event) => {
          onFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </>
  );
}
