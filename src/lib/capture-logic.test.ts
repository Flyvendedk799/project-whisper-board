import { describe, expect, it } from "vitest";
import {
  boundsOf,
  canRedo,
  canUndo,
  clamp01,
  commit,
  emptyDoc,
  hitTest,
  initHistory,
  isDegenerate,
  MAX_HISTORY,
  moveShape,
  normaliseRect,
  redactsContent,
  redo,
  undo,
  type AnnotationDoc,
  type AnnotationShape,
} from "@/features/capture/annotation-model";
import {
  elapsedMs,
  extensionFor,
  formatElapsed,
  initialRecorderState,
  MAX_DURATION_MS,
  pickMimeType,
  recorderReducer,
  shouldAutoStop,
  shouldWarn,
  type RecorderState,
} from "@/features/capture/recorder-machine";

const rect = (over: Partial<Extract<AnnotationShape, { kind: "rect" }>> = {}): AnnotationShape => ({
  kind: "rect",
  id: "r1",
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.2,
  color: "#000",
  width: 2,
  ...over,
});

describe("normaliseRect", () => {
  it("gives a positive size however the drag went", () => {
    const downRight = normaliseRect({ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.5 });
    const upLeft = normaliseRect({ x: 0.4, y: 0.5 }, { x: 0.1, y: 0.1 });
    expect(downRight).toEqual({ x: 0.1, y: 0.1, w: 0.30000000000000004, h: 0.4 });
    expect(upLeft).toEqual(downRight);
  });
});

describe("isDegenerate", () => {
  it("treats a click as a click, not a zero-sized shape", () => {
    expect(isDegenerate(rect({ w: 0.0001, h: 0.0001 }))).toBe(true);
    expect(isDegenerate(rect())).toBe(false);
  });

  it("rejects an arrow that goes nowhere and text with nothing in it", () => {
    expect(
      isDegenerate({
        kind: "arrow",
        id: "a",
        from: { x: 0.5, y: 0.5 },
        to: { x: 0.5, y: 0.5 },
        color: "#000",
        width: 2,
      }),
    ).toBe(true);
    expect(
      isDegenerate({
        kind: "text",
        id: "t",
        x: 0.1,
        y: 0.1,
        text: "   ",
        size: 16,
        color: "#000",
        width: 1,
      }),
    ).toBe(true);
    expect(
      isDegenerate({
        kind: "freehand",
        id: "f",
        points: [{ x: 0.1, y: 0.1 }],
        color: "#000",
        width: 2,
      }),
    ).toBe(true);
  });
});

describe("hitTest", () => {
  const doc: AnnotationDoc = {
    ...emptyDoc(1000, 800),
    shapes: [rect({ id: "under" }), rect({ id: "over", x: 0.15, y: 0.15 })],
  };

  it("finds the topmost shape under the point", () => {
    expect(hitTest(doc, { x: 0.2, y: 0.2 })?.id).toBe("over");
  });

  it("returns nothing when the point is on empty canvas", () => {
    expect(hitTest(doc, { x: 0.9, y: 0.9 })).toBeNull();
  });

  it("has enough padding that a thin line is still clickable", () => {
    const line: AnnotationDoc = {
      ...emptyDoc(1000, 800),
      shapes: [
        {
          kind: "arrow",
          id: "a",
          from: { x: 0.2, y: 0.2 },
          to: { x: 0.8, y: 0.2 },
          color: "#000",
          width: 2,
        },
      ],
    };
    expect(hitTest(line, { x: 0.5, y: 0.205 })?.id).toBe("a");
  });
});

describe("moveShape", () => {
  it("moves every kind by the same delta", () => {
    const moved = moveShape(rect(), 0.1, 0.05);
    expect(boundsOf(moved)).toMatchObject({ x: 0.2, y: 0.15000000000000002 });

    const arrow = moveShape(
      {
        kind: "arrow",
        id: "a",
        from: { x: 0.1, y: 0.1 },
        to: { x: 0.3, y: 0.3 },
        color: "#000",
        width: 2,
      },
      0.1,
      0,
    );
    expect(arrow).toMatchObject({ from: { x: 0.2 }, to: { x: 0.4 } });
  });

  it("cannot be pushed off the image", () => {
    expect(boundsOf(moveShape(rect({ x: 0.95 }), 0.5, 0)).x).toBe(1);
    expect(boundsOf(moveShape(rect({ x: 0.01 }), -0.5, 0)).x).toBe(0);
  });
});

describe("history", () => {
  const a = emptyDoc(100, 100);
  const b: AnnotationDoc = { ...a, shapes: [rect()] };
  const c: AnnotationDoc = { ...a, shapes: [rect(), rect({ id: "r2" })] };

  it("walks back and forward", () => {
    let h = initHistory(a);
    expect(canUndo(h)).toBe(false);

    h = commit(h, b);
    h = commit(h, c);
    expect(h.present).toBe(c);

    h = undo(h);
    expect(h.present).toBe(b);
    expect(canRedo(h)).toBe(true);

    h = redo(h);
    expect(h.present).toBe(c);
  });

  it("does nothing at either end rather than throwing", () => {
    const h = initHistory(a);
    expect(undo(h)).toBe(h);
    expect(redo(h)).toBe(h);
  });

  it("discards the redo branch once you draw again", () => {
    let h = commit(commit(initHistory(a), b), c);
    h = undo(h);
    h = commit(h, { ...a, shapes: [rect({ id: "different" })] });
    expect(canRedo(h)).toBe(false);
  });

  it("is bounded, so a long session cannot pin unbounded memory", () => {
    let h = initHistory(a);
    for (let i = 0; i < MAX_HISTORY + 20; i++) {
      h = commit(h, { ...a, shapes: [rect({ id: `r${i}` })] });
    }
    expect(h.past.length).toBeLessThanOrEqual(MAX_HISTORY);
  });
});

describe("redactsContent", () => {
  /**
   * This decides whether the unblurred original is uploaded. Getting it wrong
   * silently defeats the blur tool, so it is worth its own test.
   */
  it("is true when anything is blurred", () => {
    expect(
      redactsContent({
        ...emptyDoc(10, 10),
        shapes: [
          {
            kind: "blur",
            id: "b",
            x: 0,
            y: 0,
            w: 0.5,
            h: 0.5,
            strength: 12,
            color: "#000",
            width: 0,
          },
        ],
      }),
    ).toBe(true);
  });

  it("is false for drawings that only point at things", () => {
    expect(redactsContent({ ...emptyDoc(10, 10), shapes: [rect()] })).toBe(false);
    expect(redactsContent(emptyDoc(10, 10))).toBe(false);
  });
});

describe("clamp01", () => {
  it("keeps coordinates inside the image", () => {
    expect(clamp01(-0.5)).toBe(0);
    expect(clamp01(1.5)).toBe(1);
    expect(clamp01(0.5)).toBe(0.5);
  });
});

describe("recorder machine", () => {
  const started = (at: number): RecorderState =>
    recorderReducer(recorderReducer(initialRecorderState, { type: "request", micEnabled: true }), {
      type: "started",
      at,
    });

  it("counts only the time it was actually recording", () => {
    let state = started(1000);
    expect(elapsedMs(state, 4000)).toBe(3000);

    state = recorderReducer(state, { type: "paused", at: 4000 });
    // Paused: the clock does not advance while nothing is being captured.
    expect(elapsedMs(state, 9000)).toBe(3000);

    state = recorderReducer(state, { type: "resumed", at: 9000 });
    expect(elapsedMs(state, 11_000)).toBe(5000);

    state = recorderReducer(state, { type: "stopping", at: 12_000 });
    expect(elapsedMs(state, 99_999)).toBe(6000);
  });

  it("ignores events that do not apply to the current state", () => {
    const idle = initialRecorderState;
    expect(recorderReducer(idle, { type: "paused", at: 1 })).toBe(idle);
    expect(recorderReducer(idle, { type: "resumed", at: 1 })).toBe(idle);
    expect(recorderReducer(idle, { type: "stopping", at: 1 })).toBe(idle);
  });

  it("records a refusal as an error rather than pretending to record", () => {
    const state = recorderReducer(started(0), {
      type: "failed",
      message: "Permission denied",
    });
    expect(state.status).toBe("error");
    expect(state.error).toBe("Permission denied");
    expect(state.runningSince).toBeNull();
  });

  it("warns before it stops, and stops at the cap", () => {
    const state = started(0);
    expect(shouldWarn(state, MAX_DURATION_MS * 0.5)).toBe(false);
    expect(shouldWarn(state, MAX_DURATION_MS * 0.85)).toBe(true);
    expect(shouldAutoStop(state, MAX_DURATION_MS * 0.85)).toBe(false);
    expect(shouldAutoStop(state, MAX_DURATION_MS + 1)).toBe(true);
  });

  it("stops on size as well as duration", () => {
    let state = started(0);
    state = recorderReducer(state, { type: "data", bytes: 201 * 1024 * 1024 });
    expect(shouldAutoStop(state, 1000)).toBe(true);
  });

  it("never auto-stops something that is not running", () => {
    expect(shouldAutoStop(initialRecorderState, Number.MAX_SAFE_INTEGER)).toBe(false);
  });

  it("keeps the mic choice across a reset", () => {
    const state = recorderReducer(started(0), { type: "reset" });
    expect(state.micEnabled).toBe(true);
    expect(state.status).toBe("idle");
  });
});

describe("codec selection", () => {
  it("prefers mp4, so recording works on Safari", () => {
    expect(pickMimeType((type) => type.startsWith("video/mp4"))).toBe(
      "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    );
  });

  it("falls back through webm", () => {
    expect(pickMimeType((type) => type === "video/webm;codecs=vp9,opus")).toBe(
      "video/webm;codecs=vp9,opus",
    );
    expect(pickMimeType((type) => type === "video/webm")).toBe("video/webm");
  });

  it("returns nothing when the browser supports none of them", () => {
    expect(pickMimeType(() => false)).toBeUndefined();
  });

  it("names the file after what is actually inside it", () => {
    expect(extensionFor("video/mp4;codecs=avc1")).toBe("mp4");
    expect(extensionFor("video/webm;codecs=vp9")).toBe("webm");
    expect(extensionFor(undefined)).toBe("webm");
  });
});

describe("formatElapsed", () => {
  it("reads like a stopwatch", () => {
    expect(formatElapsed(0)).toBe("0:00");
    expect(formatElapsed(9_000)).toBe("0:09");
    expect(formatElapsed(65_000)).toBe("1:05");
    expect(formatElapsed(600_000)).toBe("10:00");
  });
});
