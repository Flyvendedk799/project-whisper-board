import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import type { PlanAttachmentWithUrl } from "@/data";
import {
  attachmentKindOf,
  canMarkUpMime,
  fileExtensionLabel,
  formatBytes,
  markedUpFileName,
} from "@/lib/upload";
import { cn } from "@/lib/utils";
import { MarkupCanvas, type MarkupHandle } from "./markup-canvas";
import { loadImage, MARKUP_COLORS, markupSize, type MarkupTool } from "./markup-model";
import { usePlanMedia } from "./plan-media";
import { timeAgo } from "./plan-model";

const BAR_BUTTON =
  "inline-flex h-[34px] items-center rounded-lg border border-white/25 px-3.5 text-[13px] text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50";

/**
 * Full-screen viewer for a task's files, with previous/next, sharing, download,
 * removal and the pen/box mark-up editor. Saving mark-up uploads a copy that
 * points at the original, so removing the copy brings the original back.
 */
export function AttachmentLightbox({
  items,
  openId,
  onOpenChange,
  contextFor,
}: {
  items: PlanAttachmentWithUrl[];
  openId: string | null;
  onOpenChange: (id: string | null) => void;
  /** What to show after the file details, e.g. the task's headline. */
  contextFor?: (attachment: PlanAttachmentWithUrl) => string;
}) {
  const media = usePlanMedia();
  const index = openId ? items.findIndex((a) => a.id === openId) : -1;
  const current = index >= 0 ? items[index] : null;
  const lastIndex = useRef(0);
  if (index >= 0) lastIndex.current = index;

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [tool, setTool] = useState<MarkupTool>("pen");
  const [color, setColor] = useState<string>(MARKUP_COLORS[0].value);
  const [strokeCount, setStrokeCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const markup = useRef<MarkupHandle>(null);
  const annotating = image !== null;

  // The open file went away (removed, or replaced by its marked-up copy).
  useEffect(() => {
    if (!openId || index >= 0) return;
    const fallback = items[Math.min(lastIndex.current, items.length - 1)];
    onOpenChange(fallback?.id ?? null);
  }, [openId, index, items, onOpenChange]);

  // Moving to another file ends any mark-up in progress.
  useEffect(() => {
    setImage(null);
    setStrokeCount(0);
  }, [openId]);

  const go = (delta: number) => {
    if (items.length < 2 || annotating) return;
    onOpenChange(items[(index + delta + items.length) % items.length].id);
  };

  const startMarkup = async () => {
    if (!current?.url) return;
    try {
      setImage(await loadImage(current.url));
      setStrokeCount(0);
    } catch {
      toast.error("Couldn't open the mark-up editor for that image.");
    }
  };

  const saveMarkup = async () => {
    if (!current || !image || !markup.current) return;
    setSaving(true);
    try {
      const blob = await markup.current.toBlob();
      if (!blob) throw new Error("no blob");
      const file = new File([blob], markedUpFileName(current.file_name), { type: "image/png" });
      const size = markupSize(image.naturalWidth, image.naturalHeight);
      const [id] = await media.upload(current.task_id, [file], {
        sourceAttachmentId: current.id,
        width: size.width,
        height: size.height,
      });
      setImage(null);
      if (id) {
        onOpenChange(id);
        toast.success("Saved as a marked-up copy. The original is kept.");
      }
    } catch {
      toast.error("The marked-up copy could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const kind = current ? attachmentKindOf(current.mime_type) : "doc";
  const uploader = current?.uploader?.full_name ?? current?.uploader?.email ?? "";

  return (
    <DialogPrimitive.Root
      open={Boolean(current)}
      onOpenChange={(open) => !open && onOpenChange(null)}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-[80] flex flex-col bg-black/95 text-white focus:outline-none"
          onEscapeKeyDown={(event) => {
            if (annotating) {
              event.preventDefault();
              setImage(null);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowRight") go(1);
            if (event.key === "ArrowLeft") go(-1);
          }}
        >
          {current ? (
            <>
              <div className="flex flex-wrap items-center gap-2.5 px-5 py-3">
                <div className="min-w-[200px] flex-1">
                  <DialogPrimitive.Title className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{current.file_name}</span>
                    {current.source_attachment_id ? (
                      <span className="shrink-0 rounded-full bg-info/30 px-2 py-0.5 text-[11px]">
                        Marked up
                      </span>
                    ) : null}
                  </DialogPrimitive.Title>
                  <p className="mt-0.5 text-xs text-white/70">
                    {[
                      current.size_bytes ? formatBytes(current.size_bytes) : null,
                      uploader || null,
                      timeAgo(current.created_at) || null,
                      contextFor?.(current) || null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>

                {annotating ? (
                  <>
                    <div
                      role="toolbar"
                      aria-label="Mark-up tools"
                      className="flex items-center gap-2 rounded-xl bg-white/10 p-1"
                    >
                      {(
                        [
                          ["pen", "Pen"],
                          ["box", "Box"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={tool === value}
                          onClick={() => setTool(value)}
                          className={cn(
                            "h-7 rounded-md px-3 text-xs",
                            tool === value
                              ? "bg-white text-black"
                              : "text-white/85 hover:bg-white/10",
                          )}
                        >
                          {label}
                        </button>
                      ))}
                      <span className="h-[18px] w-px bg-white/30" aria-hidden="true" />
                      {MARKUP_COLORS.map((swatch) => (
                        <button
                          key={swatch.value}
                          type="button"
                          aria-label={`${swatch.name} ink`}
                          aria-pressed={color === swatch.value}
                          onClick={() => setColor(swatch.value)}
                          className={cn(
                            "h-5 w-5 rounded-full",
                            color === swatch.value &&
                              "ring-2 ring-white ring-offset-2 ring-offset-black",
                          )}
                          style={{ backgroundColor: swatch.value }}
                        />
                      ))}
                      <span className="h-[18px] w-px bg-white/30" aria-hidden="true" />
                      <button
                        type="button"
                        className="h-7 rounded-md px-2.5 text-xs text-white/90 hover:bg-white/10 disabled:opacity-40"
                        disabled={strokeCount === 0}
                        onClick={() => markup.current?.undo()}
                      >
                        Undo
                      </button>
                      <button
                        type="button"
                        className="h-7 rounded-md px-2.5 text-xs text-white/90 hover:bg-white/10 disabled:opacity-40"
                        disabled={strokeCount === 0}
                        onClick={() => markup.current?.clear()}
                      >
                        Clear
                      </button>
                    </div>
                    <button type="button" className={BAR_BUTTON} onClick={() => setImage(null)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={saving || strokeCount === 0}
                      onClick={() => void saveMarkup()}
                      className="inline-flex h-[34px] items-center rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {saving ? "Saving…" : "Save marked-up copy"}
                    </button>
                  </>
                ) : (
                  <>
                    {canMarkUpMime(current.mime_type) && current.url ? (
                      <button
                        type="button"
                        className={BAR_BUTTON}
                        onClick={() => void startMarkup()}
                      >
                        Mark up
                      </button>
                    ) : null}
                    <button
                      type="button"
                      aria-pressed={current.shared_with_agents}
                      className={cn(
                        "inline-flex h-[34px] items-center rounded-lg px-3.5 text-[13px]",
                        current.shared_with_agents
                          ? "bg-chart-5/30 text-white"
                          : "bg-white/15 text-white/85",
                      )}
                      onClick={() => media.setShared(current, !current.shared_with_agents)}
                    >
                      {current.shared_with_agents ? "Shared with agents" : "Hidden from agents"}
                    </button>
                    <button
                      type="button"
                      className={BAR_BUTTON}
                      onClick={() => media.download(current)}
                    >
                      Download
                    </button>
                    <button
                      type="button"
                      className={cn(BAR_BUTTON, "text-red-300")}
                      onClick={() => media.remove(current)}
                    >
                      {current.source_attachment_id ? "Remove markup" : "Delete"}
                    </button>
                  </>
                )}
                <DialogPrimitive.Close
                  aria-label="Close"
                  className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-white/10 hover:bg-white/20"
                >
                  <X className="h-[18px] w-[18px]" />
                </DialogPrimitive.Close>
              </div>

              <div className="relative flex min-h-0 flex-1 items-center justify-center gap-4 px-5 pb-5">
                {items.length > 1 ? (
                  <button
                    type="button"
                    aria-label="Previous file"
                    disabled={annotating}
                    onClick={() => go(-1)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                ) : null}

                <div className="flex h-full min-w-0 flex-1 items-center justify-center">
                  {annotating && image ? (
                    <div
                      className="relative overflow-hidden rounded-lg"
                      style={{
                        aspectRatio: `${image.naturalWidth} / ${image.naturalHeight}`,
                        width: `min(100%, calc((100vh - 150px) * ${image.naturalWidth / image.naturalHeight}))`,
                        backgroundImage: `url("${current.url}")`,
                        backgroundSize: "100% 100%",
                      }}
                    >
                      <MarkupCanvas
                        ref={markup}
                        image={image}
                        tool={tool}
                        color={color}
                        onChange={setStrokeCount}
                      />
                    </div>
                  ) : kind === "image" && current.url ? (
                    <img
                      src={current.url}
                      alt={current.file_name}
                      className="max-h-full max-w-full rounded-lg object-contain"
                    />
                  ) : kind === "video" && current.url ? (
                    <video
                      key={current.id}
                      src={current.url}
                      controls
                      autoPlay
                      className="max-h-full max-w-full rounded-lg"
                    />
                  ) : kind === "audio" && current.url ? (
                    <audio key={current.id} src={current.url} controls autoPlay />
                  ) : (
                    <div className="flex flex-col items-center gap-3.5 rounded-2xl bg-white/10 p-10">
                      <span className="rounded-lg bg-white/15 px-5 py-2.5 font-mono font-medium">
                        {fileExtensionLabel(current.file_name)}
                      </span>
                      <span className="text-[13px] text-white/80">
                        No inline preview for this file type.
                      </span>
                      {current.url ? (
                        <a
                          href={current.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[13px] text-primary underline"
                        >
                          Open in a new tab
                        </a>
                      ) : null}
                    </div>
                  )}
                </div>

                {items.length > 1 ? (
                  <button
                    type="button"
                    aria-label="Next file"
                    disabled={annotating}
                    onClick={() => go(1)}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                ) : null}
                {items.length > 1 ? (
                  <span className="absolute bottom-0 left-1/2 -translate-x-1/2 text-xs text-white/70">
                    {index + 1} / {items.length}
                  </span>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
