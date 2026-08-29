/**
 * The annotation document.
 *
 * Everything here is pure: no canvas, no DOM, no React. That is deliberate —
 * hit-testing, undo and coordinate maths are where a drawing tool actually goes
 * wrong, and none of it needs a browser to test.
 *
 * Every coordinate is normalised to 0..1 of the source image. A screenshot
 * annotated on a phone and reopened on a 4K monitor lands in the same place,
 * the document survives the image being re-encoded at a different size, and the
 * drawing stays editable rather than being burned into pixels.
 */

export type ToolKind =
  | "select"
  | "arrow"
  | "rect"
  | "ellipse"
  | "freehand"
  | "text"
  | "highlight"
  | "blur";

export interface Point {
  x: number;
  y: number;
}

interface Base {
  id: string;
  color: string;
  width: number;
}

export type AnnotationShape =
  | ({ kind: "arrow"; from: Point; to: Point } & Base)
  | ({ kind: "rect"; x: number; y: number; w: number; h: number } & Base)
  | ({ kind: "ellipse"; x: number; y: number; w: number; h: number } & Base)
  | ({ kind: "freehand"; points: Point[] } & Base)
  | ({ kind: "text"; x: number; y: number; text: string; size: number } & Base)
  | ({ kind: "highlight"; x: number; y: number; w: number; h: number } & Base)
  | ({ kind: "blur"; x: number; y: number; w: number; h: number; strength: number } & Base);

export interface AnnotationDoc {
  version: 1;
  sourceWidth: number;
  sourceHeight: number;
  shapes: AnnotationShape[];
}

export const DEFAULT_COLOR = "#dc2626";

export const PALETTE = [
  { value: "#dc2626", label: "Red" },
  { value: "#ea580c", label: "Orange" },
  { value: "#ca8a04", label: "Yellow" },
  { value: "#16a34a", label: "Green" },
  { value: "#2563eb", label: "Blue" },
  { value: "#171717", label: "Black" },
  { value: "#ffffff", label: "White" },
];

export function emptyDoc(sourceWidth: number, sourceHeight: number): AnnotationDoc {
  return { version: 1, sourceWidth, sourceHeight, shapes: [] };
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `s-${Math.random().toString(36).slice(2)}`;
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Dragging up and to the left produces a negative width. Every consumer would
 * otherwise have to remember that, so rectangles are normalised on creation.
 */
export function normaliseRect(a: Point, b: Point): { x: number; y: number; w: number; h: number } {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
}

/** Anything smaller than this was a click, not a drag. */
export const MIN_SHAPE_SIZE = 0.005;

export function isDegenerate(shape: AnnotationShape): boolean {
  switch (shape.kind) {
    case "rect":
    case "ellipse":
    case "highlight":
    case "blur":
      return shape.w < MIN_SHAPE_SIZE || shape.h < MIN_SHAPE_SIZE;
    case "arrow":
      return Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) < MIN_SHAPE_SIZE;
    case "freehand":
      return shape.points.length < 2;
    case "text":
      return shape.text.trim().length === 0;
  }
}

export function boundsOf(shape: AnnotationShape): { x: number; y: number; w: number; h: number } {
  switch (shape.kind) {
    case "rect":
    case "ellipse":
    case "highlight":
    case "blur":
      return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
    case "arrow":
      return normaliseRect(shape.from, shape.to);
    case "freehand": {
      const xs = shape.points.map((p) => p.x);
      const ys = shape.points.map((p) => p.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    case "text":
      // Approximate: text is measured on the canvas, but hit-testing only needs
      // a target big enough to click.
      return {
        x: shape.x,
        y: shape.y - shape.size,
        w: shape.text.length * shape.size * 0.5,
        h: shape.size * 1.2,
      };
  }
}

/** Padding so a one-pixel line is still clickable. */
const HIT_PADDING = 0.012;

export function hitTest(doc: AnnotationDoc, point: Point): AnnotationShape | null {
  // Topmost first: the shape drawn last is the one on top.
  for (let i = doc.shapes.length - 1; i >= 0; i--) {
    const shape = doc.shapes[i];
    const b = boundsOf(shape);
    if (
      point.x >= b.x - HIT_PADDING &&
      point.x <= b.x + b.w + HIT_PADDING &&
      point.y >= b.y - HIT_PADDING &&
      point.y <= b.y + b.h + HIT_PADDING
    ) {
      return shape;
    }
  }
  return null;
}

export function moveShape(shape: AnnotationShape, dx: number, dy: number): AnnotationShape {
  switch (shape.kind) {
    case "arrow":
      return {
        ...shape,
        from: { x: clamp01(shape.from.x + dx), y: clamp01(shape.from.y + dy) },
        to: { x: clamp01(shape.to.x + dx), y: clamp01(shape.to.y + dy) },
      };
    case "freehand":
      return {
        ...shape,
        points: shape.points.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) })),
      };
    default:
      return { ...shape, x: clamp01(shape.x + dx), y: clamp01(shape.y + dy) };
  }
}

/**
 * Undo history. Bounded, because a long freehand session should not be able to
 * pin an arbitrary amount of memory.
 */
export const MAX_HISTORY = 50;

export interface History {
  past: AnnotationDoc[];
  present: AnnotationDoc;
  future: AnnotationDoc[];
}

export function initHistory(doc: AnnotationDoc): History {
  return { past: [], present: doc, future: [] };
}

export function commit(history: History, next: AnnotationDoc): History {
  return {
    past: [...history.past, history.present].slice(-MAX_HISTORY),
    present: next,
    // A new edit after undoing discards the redo branch, as everywhere else.
    future: [],
  };
}

export function undo(history: History): History {
  const previous = history.past.at(-1);
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future].slice(0, MAX_HISTORY),
  };
}

export function redo(history: History): History {
  const [next, ...rest] = history.future;
  if (!next) return history;
  return {
    past: [...history.past, history.present].slice(-MAX_HISTORY),
    present: next,
    future: rest,
  };
}

export function canUndo(history: History): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History): boolean {
  return history.future.length > 0;
}

/**
 * Whether the document redacts anything.
 *
 * This decides whether the untouched original is uploaded alongside the
 * flattened copy. Shipping both when someone has blurred out their customers'
 * names would defeat the entire point of the tool, so a blur anywhere means the
 * original never leaves the browser.
 */
export function redactsContent(doc: AnnotationDoc): boolean {
  return doc.shapes.some((shape) => shape.kind === "blur");
}

export function describeDoc(doc: AnnotationDoc): string {
  if (doc.shapes.length === 0) return "No annotations";
  const counts = new Map<string, number>();
  for (const shape of doc.shapes) counts.set(shape.kind, (counts.get(shape.kind) ?? 0) + 1);
  return [...counts.entries()].map(([kind, n]) => `${n} ${kind}${n > 1 ? "s" : ""}`).join(", ");
}
