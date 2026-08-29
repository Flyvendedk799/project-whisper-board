import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Circle,
  Droplets,
  Highlighter,
  MousePointer2,
  Pencil,
  Redo2,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  boundsOf,
  canRedo,
  canUndo,
  clamp01,
  commit,
  DEFAULT_COLOR,
  emptyDoc,
  hitTest,
  initHistory,
  isDegenerate,
  moveShape,
  newId,
  normaliseRect,
  PALETTE,
  redo,
  undo,
  type AnnotationDoc,
  type AnnotationShape,
  type Point,
  type ToolKind,
} from "./annotation-model";
import { drawBlurRegions, drawDocument, drawSelection } from "./annotation-canvas";

/**
 * The annotation editor.
 *
 * Written by hand rather than pulled from a canvas library. Two reasons:
 * neither Konva nor Fabric does region blur, which is the tool that actually
 * matters here — a client redacting their customers' names before sending you a
 * screenshot — and a canvas library gives no keyboard story at all. Every tool
 * here has a number key, shapes are reachable with Tab, and arrows nudge.
 */

const TOOLS: Array<{ kind: ToolKind; label: string; icon: typeof Square; key: string }> = [
  { kind: "select", label: "Select", icon: MousePointer2, key: "1" },
  { kind: "arrow", label: "Arrow", icon: ArrowUpRight, key: "2" },
  { kind: "rect", label: "Box", icon: Square, key: "3" },
  { kind: "ellipse", label: "Circle", icon: Circle, key: "4" },
  { kind: "freehand", label: "Pen", icon: Pencil, key: "5" },
  { kind: "text", label: "Text", icon: Type, key: "6" },
  { kind: "highlight", label: "Highlight", icon: Highlighter, key: "7" },
  { kind: "blur", label: "Blur out", icon: Droplets, key: "8" },
];

export interface AnnotatorProps {
  image: HTMLImageElement;
  initialDoc?: AnnotationDoc;
  onChange: (doc: AnnotationDoc) => void;
}

export function ScreenshotAnnotator({ image, initialDoc, onChange }: AnnotatorProps) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const [history, setHistory] = useState(() =>
    initHistory(initialDoc ?? emptyDoc(image.naturalWidth, image.naturalHeight)),
  );
  const [tool, setTool] = useState<ToolKind>("arrow");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [strokeWidth, setStrokeWidth] = useState(3);
  const [draft, setDraft] = useState<AnnotationShape | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const doc = history.present;

  const setDoc = useCallback(
    (next: AnnotationDoc) => {
      setHistory((h) => commit(h, next));
      onChange(next);
    },
    [onChange],
  );

  // The base layer only changes when a blur region does, so it is redrawn
  // separately from the overlay, which repaints on every pointer move.
  useEffect(() => {
    const canvas = baseRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = doc.sourceWidth;
    canvas.height = doc.sourceHeight;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    drawBlurRegions(ctx, image, doc, canvas.width, canvas.height);
  }, [image, doc]);

  useEffect(() => {
    const canvas = overlayRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    canvas.width = doc.sourceWidth;
    canvas.height = doc.sourceHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const scale = canvas.width / 1000;
    drawDocument(ctx, doc, canvas.width, canvas.height, scale);
    if (draft && draft.kind !== "blur") {
      drawDocument(ctx, { ...doc, shapes: [draft] }, canvas.width, canvas.height, scale);
    }
    if (draft?.kind === "blur") {
      drawSelection(ctx, boundsOf(draft), canvas.width, canvas.height);
    }

    const selected = doc.shapes.find((s) => s.id === selectedId);
    if (selected) drawSelection(ctx, boundsOf(selected), canvas.width, canvas.height);
  }, [doc, draft, selectedId]);

  /** Pointer position as a fraction of the image, whatever it is displayed at. */
  const pointFromEvent = useCallback((event: React.PointerEvent): Point => {
    const rect = overlayRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    };
  }, []);

  const startRef = useRef<Point | null>(null);

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    (event.target as Element).setPointerCapture(event.pointerId);
    const point = pointFromEvent(event);

    if (tool === "select") {
      setSelectedId(hitTest(doc, point)?.id ?? null);
      return;
    }

    if (tool === "text") {
      const text = window.prompt("Label");
      if (text?.trim()) {
        setDoc({
          ...doc,
          shapes: [
            ...doc.shapes,
            {
              kind: "text",
              id: newId(),
              x: point.x,
              y: point.y,
              text: text.trim(),
              size: 20,
              color,
              width: 1,
            },
          ],
        });
        setAnnouncement("Label added");
      }
      return;
    }

    startRef.current = point;
    setSelectedId(null);
    setDraft(makeShape(tool, point, point, color, strokeWidth));
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const start = startRef.current;
    if (!start || !draft) return;
    const point = pointFromEvent(event);

    setDraft((current) => {
      if (!current) return current;
      if (current.kind === "freehand") {
        return { ...current, points: [...current.points, point] };
      }
      return makeShape(tool, start, point, color, strokeWidth, current.id);
    });
  };

  const onPointerUp = () => {
    startRef.current = null;
    if (!draft) return;
    if (!isDegenerate(draft)) {
      setDoc({ ...doc, shapes: [...doc.shapes, draft] });
      setAnnouncement(`${draft.kind} added`);
    }
    setDraft(null);
  };

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    setDoc({ ...doc, shapes: doc.shapes.filter((s) => s.id !== selectedId) });
    setSelectedId(null);
    setAnnouncement("Removed");
  }, [doc, selectedId, setDoc]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const meta = event.metaKey || event.ctrlKey;

    if (meta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      setHistory((h) => {
        const next = event.shiftKey ? redo(h) : undo(h);
        onChange(next.present);
        return next;
      });
      setAnnouncement(event.shiftKey ? "Redone" : "Undone");
      return;
    }

    const toolForKey = TOOLS.find((t) => t.key === event.key);
    if (toolForKey) {
      event.preventDefault();
      setTool(toolForKey.kind);
      setAnnouncement(`${toolForKey.label} selected`);
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeSelected();
      return;
    }

    if (event.key === "Tab" && doc.shapes.length > 0) {
      event.preventDefault();
      const index = doc.shapes.findIndex((s) => s.id === selectedId);
      const next =
        doc.shapes[(index + (event.shiftKey ? -1 : 1) + doc.shapes.length) % doc.shapes.length];
      setSelectedId(next.id);
      setTool("select");
      setAnnouncement(`${next.kind} selected`);
      return;
    }

    if (selectedId && event.key.startsWith("Arrow")) {
      event.preventDefault();
      const step = event.shiftKey ? 0.05 : 0.005;
      const dx = event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
      const dy = event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
      setDoc({
        ...doc,
        shapes: doc.shapes.map((s) => (s.id === selectedId ? moveShape(s, dx, dy) : s)),
      });
    }
  };

  const aspect = useMemo(
    () => `${doc.sourceWidth} / ${doc.sourceHeight}`,
    [doc.sourceWidth, doc.sourceHeight],
  );

  return (
    <div className="space-y-2">
      <div
        className="flex flex-wrap items-center gap-1.5"
        role="toolbar"
        aria-label="Annotation tools"
      >
        {TOOLS.map((item) => (
          <Button
            key={item.kind}
            type="button"
            size="icon"
            variant={tool === item.kind ? "default" : "outline"}
            onClick={() => setTool(item.kind)}
            aria-pressed={tool === item.kind}
            aria-label={`${item.label} (${item.key})`}
            title={`${item.label} — press ${item.key}`}
            className="h-8 w-8"
          >
            <item.icon className="h-4 w-4" aria-hidden="true" />
          </Button>
        ))}

        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        {PALETTE.map((swatch) => (
          <button
            key={swatch.value}
            type="button"
            onClick={() => setColor(swatch.value)}
            aria-label={swatch.label}
            aria-pressed={color === swatch.value}
            style={{ backgroundColor: swatch.value }}
            className={`h-6 w-6 rounded-full border transition-transform ${
              color === swatch.value ? "scale-110 ring-2 ring-ring ring-offset-1" : ""
            }`}
          />
        ))}

        <label className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="sr-only sm:not-sr-only">Thickness</span>
          <input
            type="range"
            min={1}
            max={10}
            value={strokeWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            aria-label="Line thickness"
            className="w-16"
          />
        </label>

        <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          disabled={!canUndo(history)}
          aria-label="Undo"
          onClick={() =>
            setHistory((h) => {
              const next = undo(h);
              onChange(next.present);
              return next;
            })
          }
        >
          <Undo2 className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          disabled={!canRedo(history)}
          aria-label="Redo"
          onClick={() =>
            setHistory((h) => {
              const next = redo(h);
              onChange(next.present);
              return next;
            })
          }
        >
          <Redo2 className="h-4 w-4" aria-hidden="true" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          disabled={!selectedId}
          aria-label="Delete selected"
          onClick={removeSelected}
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div
        ref={wrapRef}
        role="application"
        aria-label="Screenshot annotator. Number keys pick a tool, Tab cycles shapes, arrows move the selected one."
        tabIndex={0}
        onKeyDown={onKeyDown}
        className="relative overflow-hidden rounded-lg border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ aspectRatio: aspect, touchAction: "none" }}
      >
        <canvas ref={baseRef} className="absolute inset-0 h-full w-full" />
        <canvas
          ref={overlayRef}
          className="absolute inset-0 h-full w-full"
          style={{ cursor: tool === "select" ? "default" : "crosshair" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <p className="text-xs text-muted-foreground">
        Drag to draw. Use <strong>Blur out</strong> to hide anything private before sending — the
        original is never uploaded once you do.
      </p>
    </div>
  );
}

function makeShape(
  tool: ToolKind,
  from: Point,
  to: Point,
  color: string,
  width: number,
  id = newId(),
): AnnotationShape {
  switch (tool) {
    case "arrow":
      return { kind: "arrow", id, from, to, color, width };
    case "freehand":
      return { kind: "freehand", id, points: [from], color, width };
    case "ellipse":
      return { kind: "ellipse", id, ...normaliseRect(from, to), color, width };
    case "highlight":
      return { kind: "highlight", id, ...normaliseRect(from, to), color, width };
    case "blur":
      return { kind: "blur", id, ...normaliseRect(from, to), strength: 14, color, width: 0 };
    default:
      return { kind: "rect", id, ...normaliseRect(from, to), color, width };
  }
}
