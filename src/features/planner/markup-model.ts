/**
 * Mark-up strokes, kept separate from the canvas so the drawing rules are
 * testable and the editor component stays small.
 */
export type MarkupTool = "pen" | "box";

export interface MarkupStroke {
  tool: MarkupTool;
  color: string;
  /** Pen: every sampled point. Box: the two opposite corners. */
  points: Array<[number, number]>;
}

/** The four colours on offer, as CSS variables so dark mode keeps them legible. */
export const MARKUP_COLORS = [
  { name: "Red", value: "#e5484d" },
  { name: "Yellow", value: "#f5c542" },
  { name: "Green", value: "#30a46c" },
  { name: "Blue", value: "#3b82f6" },
] as const;

/** Line weight that looks the same on a 600 px and a 3000 px screenshot. */
export function markupLineWidth(canvasWidth: number): number {
  return Math.max(4, canvasWidth / 220);
}

/** Longest edge the copy is saved at; bigger screenshots are scaled down. */
export const MARKUP_MAX_EDGE = 4096;

export function markupSize(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MARKUP_MAX_EDGE) return { width, height };
  const scale = MARKUP_MAX_EDGE / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Converts a pointer position to canvas pixels. */
export function toCanvasPoint(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  canvas: { width: number; height: number },
): [number, number] {
  return [
    ((clientX - rect.left) * canvas.width) / rect.width,
    ((clientY - rect.top) * canvas.height) / rect.height,
  ];
}

/** Adds a point to the stroke being drawn (pen appends, box moves its far corner). */
export function extendStroke(stroke: MarkupStroke, point: [number, number]): MarkupStroke {
  if (stroke.tool === "pen") return { ...stroke, points: [...stroke.points, point] };
  return { ...stroke, points: [stroke.points[0], point] };
}

/** A click with no drag leaves nothing worth keeping. */
export function isMeaningfulStroke(stroke: MarkupStroke): boolean {
  if (stroke.tool === "pen") return stroke.points.length > 1;
  if (stroke.points.length < 2) return false;
  const [a, b] = stroke.points;
  return Math.abs(a[0] - b[0]) > 2 || Math.abs(a[1] - b[1]) > 2;
}

export function drawStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: readonly MarkupStroke[],
  width: number,
) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = markupLineWidth(width);
  for (const stroke of strokes) {
    ctx.strokeStyle = stroke.color;
    ctx.beginPath();
    if (stroke.tool === "pen") {
      stroke.points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    } else if (stroke.points.length > 1) {
      const [a, b] = stroke.points;
      ctx.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
    }
    ctx.stroke();
  }
}

/** Loads with CORS on, so the canvas can be read back after drawing the photo on it. */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("The image could not be loaded."));
    image.src = url;
  });
}
