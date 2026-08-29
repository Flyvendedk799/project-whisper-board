import type { AnnotationDoc, AnnotationShape } from "./annotation-model";

/**
 * Drawing an annotation document onto a canvas.
 *
 * Separate from the React component so it can be used for both the live
 * overlay and the flattened export without either drifting from the other —
 * what you saw when you drew it is exactly what gets uploaded.
 */

const ARROW_HEAD_RATIO = 3.5;

/** Normalised (0..1) to device pixels. */
function px(value: number, size: number): number {
  return value * size;
}

export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: AnnotationShape,
  width: number,
  height: number,
  scale: number,
) {
  ctx.save();
  ctx.strokeStyle = shape.color;
  ctx.fillStyle = shape.color;
  ctx.lineWidth = shape.width * scale;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  switch (shape.kind) {
    case "rect":
      ctx.strokeRect(
        px(shape.x, width),
        px(shape.y, height),
        px(shape.w, width),
        px(shape.h, height),
      );
      break;

    case "ellipse": {
      const rx = px(shape.w, width) / 2;
      const ry = px(shape.h, height) / 2;
      ctx.beginPath();
      ctx.ellipse(px(shape.x, width) + rx, px(shape.y, height) + ry, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }

    case "highlight":
      // Multiply keeps the underlying pixels readable through the wash.
      ctx.globalAlpha = 0.35;
      ctx.globalCompositeOperation = "multiply";
      ctx.fillRect(
        px(shape.x, width),
        px(shape.y, height),
        px(shape.w, width),
        px(shape.h, height),
      );
      break;

    case "arrow": {
      const x1 = px(shape.from.x, width);
      const y1 = px(shape.from.y, height);
      const x2 = px(shape.to.x, width);
      const y2 = px(shape.to.y, height);
      const head = Math.max(8 * scale, shape.width * scale * ARROW_HEAD_RATIO);
      const angle = Math.atan2(y2 - y1, x2 - x1);

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      // Stop the shaft short so it does not poke through the head.
      ctx.lineTo(x2 - Math.cos(angle) * head * 0.6, y2 - Math.sin(angle) * head * 0.6);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(
        x2 - head * Math.cos(angle - Math.PI / 7),
        y2 - head * Math.sin(angle - Math.PI / 7),
      );
      ctx.lineTo(
        x2 - head * Math.cos(angle + Math.PI / 7),
        y2 - head * Math.sin(angle + Math.PI / 7),
      );
      ctx.closePath();
      ctx.fill();
      break;
    }

    case "freehand":
      if (shape.points.length < 2) break;
      ctx.beginPath();
      ctx.moveTo(px(shape.points[0].x, width), px(shape.points[0].y, height));
      for (let i = 1; i < shape.points.length; i++) {
        ctx.lineTo(px(shape.points[i].x, width), px(shape.points[i].y, height));
      }
      ctx.stroke();
      break;

    case "text": {
      const size = shape.size * scale;
      ctx.font = `600 ${size}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = "top";
      const metrics = ctx.measureText(shape.text);
      const pad = size * 0.25;
      // A plate behind the text, so red on a red screenshot is still readable.
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.fillRect(
        px(shape.x, width) - pad,
        px(shape.y, height) - pad,
        metrics.width + pad * 2,
        size * 1.25 + pad * 2,
      );
      ctx.fillStyle = shape.color;
      ctx.fillText(shape.text, px(shape.x, width), px(shape.y, height));
      break;
    }

    case "blur":
      // Handled by drawBlurRegions, which needs the source image.
      break;
  }

  ctx.restore();
}

/**
 * Redaction, applied to the base layer.
 *
 * `ctx.filter` is the good path. Where it is unavailable the region is
 * downscaled to a handful of pixels and drawn back with smoothing off, which
 * pixelates it beyond recovery — the important part is that the original pixels
 * are genuinely gone from the exported image either way.
 */
export function drawBlurRegions(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  doc: AnnotationDoc,
  width: number,
  height: number,
) {
  const regions = doc.shapes.filter(
    (s): s is Extract<AnnotationShape, { kind: "blur" }> => s.kind === "blur",
  );
  if (regions.length === 0) return;

  // Feature detection without `in`, which would narrow ctx to never in the
  // fallback branch below.
  const supportsFilter = typeof ctx.filter === "string";

  for (const region of regions) {
    const x = px(region.x, width);
    const y = px(region.y, height);
    const w = px(region.w, width);
    const h = px(region.h, height);
    if (w < 1 || h < 1) continue;

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();

    if (supportsFilter) {
      ctx.filter = `blur(${Math.max(4, region.strength)}px)`;
      ctx.drawImage(source, 0, 0, width, height);
      ctx.filter = "none";
    } else {
      const scratch = document.createElement("canvas");
      const factor = 12;
      scratch.width = Math.max(1, Math.round(w / factor));
      scratch.height = Math.max(1, Math.round(h / factor));
      const scratchCtx = scratch.getContext("2d");
      if (scratchCtx) {
        scratchCtx.drawImage(source, x, y, w, h, 0, 0, scratch.width, scratch.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(scratch, 0, 0, scratch.width, scratch.height, x, y, w, h);
        ctx.imageSmoothingEnabled = true;
      }
    }

    ctx.restore();
  }
}

export function drawDocument(
  ctx: CanvasRenderingContext2D,
  doc: AnnotationDoc,
  width: number,
  height: number,
  scale: number,
) {
  for (const shape of doc.shapes) {
    if (shape.kind !== "blur") drawShape(ctx, shape, width, height, scale);
  }
}

/** A dashed outline around the shape under the cursor or keyboard focus. */
export function drawSelection(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
) {
  ctx.save();
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  const pad = 4;
  ctx.strokeRect(
    px(bounds.x, width) - pad,
    px(bounds.y, height) - pad,
    px(bounds.w, width) + pad * 2,
    px(bounds.h, height) + pad * 2,
  );
  ctx.restore();
}

/**
 * Composites the source and the document into one image at full resolution.
 * Blur is baked into the base before anything is drawn over it, so a redacted
 * area cannot be recovered from the exported file.
 */
export async function flattenToBlob(
  source: CanvasImageSource,
  doc: AnnotationDoc,
  type = "image/webp",
  quality = 0.92,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = doc.sourceWidth;
  canvas.height = doc.sourceHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is unavailable in this browser.");

  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  drawBlurRegions(ctx, source, doc, canvas.width, canvas.height);
  drawDocument(ctx, doc, canvas.width, canvas.height, canvas.width / 1000);

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, type, quality);
  });
  // Safari historically returned null for webp; PNG is universally supported.
  if (!blob) {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (png) => (png ? resolve(png) : reject(new Error("Could not export the image."))),
        "image/png",
      );
    });
  }
  return blob;
}
