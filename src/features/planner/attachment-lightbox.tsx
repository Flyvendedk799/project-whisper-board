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
import { useNarrowViewport } from "./use-narrow-viewport";
import { timeAgo } from "./plan-model";

const BAR_BUTTON =
  "inline-flex h-[34px] items-center rounded-lg border border-white/25 px-3.5 text-[13px] text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 disabled:opacity-50 max-md:h-11 max-md:flex-1 max-md:justify-center max-md:text-sm";

const SWIPE_MIN_PX = 56;

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
  const narrow = useNarrowViewport();
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
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

  // One finger swiping sideways walks to the next or previous file. Pinching
  // is left to the browser (touch-action: pinch-zoom), and a swipe while the
  // page is zoomed in is a pan, not a navigation.
  const swipeHandlers = {
    onPointerDown: (event: React.PointerEvent) => {
      const target = event.target as HTMLElement;
      if (event.pointerType !== "touch" || annotating || target.closest("video, audio")) return;
      swipe.current = swipe.current
        ? null
        : { id: event.pointerId, x: event.clientX, y: event.clientY };
    },
    onPointerUp: (event: React.PointerEvent) => {
      const start = swipe.current;
      swipe.current = null;
      if (!start || start.id !== event.pointerId) return;
      if ((window.visualViewport?.scale ?? 1) > 1.05) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
    },
    onPointerCancel: () => {
      swipe.current = null;
    },
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
          className="fixed inset-0 z-[80] flex flex-col bg-black/95 text-white focus:outline-none max-md:h-dvh"
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
              <div className="flex flex-wrap items-center gap-2.5 px-5 py-3 max-md:contents">
                <div className="min-w-[200px] flex-1 max-md:order-first max-md:min-w-0 max-md:flex-none max-md:pb-2 max-md:pl-4 max-md:pr-16 max-md:pt-[calc(0.75rem+var(--safe-top))]">
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

                <div className="md:contents max-md:order-last max-md:flex max-md:shrink-0 max-md:flex-wrap max-md:gap-2 max-md:border-t max-md:border-white/10 max-md:px-4 max-md:pb-[calc(0.75rem+var(--safe-bottom))] max-md:pt-3">
                  {annotating ? (
                    <>
                      <div
                        role="toolbar"
                        aria-label="Mark-up tools"
                        className="flex items-center gap-2 rounded-xl bg-white/10 p-1 max-md:w-full max-md:flex-col max-md:items-stretch"
                      >
                        <div className="contents max-md:grid max-md:grid-cols-2 max-md:gap-2">
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
                                "h-7 rounded-md px-3 text-xs max-md:h-11 max-md:text-sm",
                                tool === value
                                  ? "bg-white text-black"
                                  : "text-white/85 hover:bg-white/10",
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                        <div className="contents max-md:flex max-md:items-center max-md:justify-between max-md:gap-1">
                          <span
                            className="h-[18px] w-px bg-white/30 max-md:hidden"
                            aria-hidden="true"
                          />
                          {MARKUP_COLORS.map((swatch) => (
                            <button
                              key={swatch.value}
                              type="button"
                              aria-label={`${swatch.name} ink`}
                              aria-pressed={color === swatch.value}
                              onClick={() => setColor(swatch.value)}
                              className={cn(
                                "h-5 w-5 rounded-full max-md:h-9 max-md:w-9",
                                color === swatch.value &&
                                  "ring-2 ring-white ring-offset-2 ring-offset-black",
                              )}
                              style={{ backgroundColor: swatch.value }}
                            />
                          ))}
                          <span
                            className="h-[18px] w-px bg-white/30 max-md:hidden"
                            aria-hidden="true"
                          />
                          <button
                            type="button"
                            className="h-7 rounded-md px-2.5 text-xs text-white/90 hover:bg-white/10 disabled:opacity-40 max-md:h-11 max-md:px-3.5 max-md:text-sm"
                            disabled={strokeCount === 0}
                            onClick={() => markup.current?.undo()}
                          >
                            Undo
                          </button>
                          <button
                            type="button"
                            className="h-7 rounded-md px-2.5 text-xs text-white/90 hover:bg-white/10 disabled:opacity-40 max-md:h-11 max-md:px-3.5 max-md:text-sm"
                            disabled={strokeCount === 0}
                            onClick={() => markup.current?.clear()}
                          >
                            Clear
                          </button>
                        </div>
                      </div>
                      <button type="button" className={BAR_BUTTON} onClick={() => setImage(null)}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={saving || strokeCount === 0}
                        onClick={() => void saveMarkup()}
                        className="inline-flex h-[34px] items-center rounded-lg bg-primary px-4 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50 max-md:h-11 max-md:flex-[2] max-md:justify-center max-md:text-sm"
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
                          "inline-flex h-[34px] items-center rounded-lg px-3.5 text-[13px] max-md:h-11 max-md:flex-1 max-md:justify-center max-md:text-sm",
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
                </div>
                <DialogPrimitive.Close
                  aria-label="Close"
                  className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 max-md:absolute max-md:right-2 max-md:top-[calc(0.5rem+var(--safe-top))] max-md:z-20 max-md:h-11 max-md:w-11 max-md:rounded-full max-md:bg-white/15"
                >
                  <X className="h-[18px] w-[18px]" />
                </DialogPrimitive.Close>
              </div>

              <div className="relative flex min-h-0 flex-1 items-center justify-center gap-4 px-5 pb-5 max-md:gap-0 max-md:px-0 max-md:pb-7">
                {items.length > 1 ? (
                  <button
                    type="button"
                    aria-label="Previous file"
                    disabled={annotating}
                    onClick={() => go(-1)}
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40 max-md:absolute max-md:left-2 max-md:top-1/2 max-md:z-10 max-md:-translate-y-1/2 max-md:bg-black/45",
                      annotating && "max-md:hidden",
                    )}
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                ) : null}

                <div
                  {...swipeHandlers}
                  className={cn(
                    "flex h-full min-w-0 flex-1 items-center justify-center max-md:touch-pinch-zoom",
                    annotating && "max-md:[container-type:size]",
                  )}
                >
                  {annotating && image ? (
                    <div
                      className="relative overflow-hidden rounded-lg"
                      style={{
                        aspectRatio: `${image.naturalWidth} / ${image.naturalHeight}`,
                        width: narrow
                          ? `min(100%, calc(100cqh * ${image.naturalWidth / image.naturalHeight}))`
                          : `min(100%, calc((100vh - 150px) * ${image.naturalWidth / image.naturalHeight}))`,
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
                      className="max-h-full max-w-full rounded-lg object-contain max-md:rounded-none"
                    />
                  ) : kind === "video" && current.url ? (
                    <video
                      key={current.id}
                      src={current.url}
                      controls
                      autoPlay
                      className="max-h-full max-w-full rounded-lg max-md:max-h-[70%] max-md:w-full max-md:rounded-none"
                    />
                  ) : kind === "audio" && current.url ? (
                    <audio
                      key={current.id}
                      src={current.url}
                      controls
                      autoPlay
                      className="max-md:w-[calc(100%-2rem)]"
                    />
                  ) : (
                    <div className="flex flex-col items-center gap-3.5 rounded-2xl bg-white/10 p-10 max-md:mx-4 max-md:p-6 max-md:text-center">
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
                          className="text-[13px] text-primary underline max-md:py-3 max-md:text-sm"
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
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-40 max-md:absolute max-md:right-2 max-md:top-1/2 max-md:z-10 max-md:-translate-y-1/2 max-md:bg-black/45",
                      annotating && "max-md:hidden",
                    )}
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
