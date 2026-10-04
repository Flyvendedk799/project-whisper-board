import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import {
  drawStrokes,
  extendStroke,
  isMeaningfulStroke,
  markupSize,
  toCanvasPoint,
  type MarkupStroke,
  type MarkupTool,
} from "./markup-model";

export interface MarkupHandle {
  undo: () => void;
  clear: () => void;
  hasStrokes: () => boolean;
  /** The image with the strokes burned in, as a PNG. */
  toBlob: () => Promise<Blob | null>;
}

/**
 * Pen and box drawing over an image. The canvas is the image's own resolution
 * (capped), sized to fit by CSS, so a stroke lands on the same pixel whatever
 * the window size.
 */
export const MarkupCanvas = forwardRef<
  MarkupHandle,
  { image: HTMLImageElement; tool: MarkupTool; color: string; onChange?: (count: number) => void }
>(function MarkupCanvas({ image, tool, color, onChange }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<MarkupStroke[]>([]);
  const current = useRef<MarkupStroke | null>(null);
  const { width, height } = markupSize(image.naturalWidth, image.naturalHeight);
  const [, rerender] = useState(0);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawStrokes(
      ctx,
      current.current ? [...strokes.current, current.current] : strokes.current,
      canvas.width,
    );
  }, []);

  useEffect(redraw);

  const changed = useCallback(() => {
    onChange?.(strokes.current.length);
    rerender((n) => n + 1);
  }, [onChange]);

  useImperativeHandle(
    ref,
    () => ({
      undo() {
        strokes.current.pop();
        redraw();
        changed();
      },
      clear() {
        strokes.current = [];
        redraw();
        changed();
      },
      hasStrokes: () => strokes.current.length > 0,
      toBlob() {
        const out = document.createElement("canvas");
        out.width = width;
        out.height = height;
        const ctx = out.getContext("2d");
        if (!ctx) return Promise.resolve(null);
        ctx.drawImage(image, 0, 0, width, height);
        drawStrokes(ctx, strokes.current, width);
        return new Promise((resolve) => out.toBlob(resolve, "image/png"));
      },
    }),
    [image, width, height, redraw, changed],
  );

  const point = (event: React.PointerEvent<HTMLCanvasElement>) =>
    toCanvasPoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), {
      width,
      height,
    });

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      aria-label="Draw on the image"
      className="absolute inset-0 h-full w-full cursor-crosshair touch-none select-none [-webkit-touch-callout:none]"
      onPointerDown={(event) => {
        // A second finger (a pinch, a palm) never starts or replaces a stroke.
        if (!event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        current.current = { tool, color, points: [point(event)] };
      }}
      onPointerMove={(event) => {
        if (!current.current || !event.isPrimary) return;
        current.current = extendStroke(current.current, point(event));
        redraw();
      }}
      onPointerUp={(event) => {
        if (!event.isPrimary || !current.current) return;
        const stroke = current.current;
        current.current = null;
        if (stroke && isMeaningfulStroke(stroke)) strokes.current.push(stroke);
        redraw();
        changed();
      }}
      onPointerCancel={() => {
        current.current = null;
        redraw();
      }}
    />
  );
});
