import { describe, expect, it } from "vitest";
import {
  extendStroke,
  isMeaningfulStroke,
  markupLineWidth,
  markupSize,
  toCanvasPoint,
  MARKUP_COLORS,
  MARKUP_MAX_EDGE,
  type MarkupStroke,
} from "./markup-model";

describe("mark-up model", () => {
  it("offers four colours", () => {
    expect(MARKUP_COLORS).toHaveLength(4);
  });

  it("scales line weight with the image, never below 4px", () => {
    expect(markupLineWidth(400)).toBe(4);
    expect(markupLineWidth(2200)).toBe(10);
  });

  it("caps the saved size on the longest edge and keeps the ratio", () => {
    expect(markupSize(1280, 800)).toEqual({ width: 1280, height: 800 });
    const big = markupSize(8192, 4096);
    expect(big).toEqual({ width: MARKUP_MAX_EDGE, height: MARKUP_MAX_EDGE / 2 });
    expect(markupSize(1000, 5000).height).toBe(MARKUP_MAX_EDGE);
  });

  it("maps a pointer position into canvas pixels", () => {
    const rect = { left: 100, top: 50, width: 400, height: 200 };
    expect(toCanvasPoint(300, 150, rect, { width: 1280, height: 640 })).toEqual([640, 320]);
  });

  it("grows a pen stroke and moves a box's far corner", () => {
    const pen: MarkupStroke = { tool: "pen", color: "#000", points: [[0, 0]] };
    expect(extendStroke(pen, [1, 1]).points).toEqual([
      [0, 0],
      [1, 1],
    ]);
    const box: MarkupStroke = { tool: "box", color: "#000", points: [[0, 0]] };
    const dragged = extendStroke(extendStroke(box, [5, 5]), [9, 9]);
    expect(dragged.points).toEqual([
      [0, 0],
      [9, 9],
    ]);
  });

  it("drops clicks that never became a mark", () => {
    expect(isMeaningfulStroke({ tool: "pen", color: "x", points: [[1, 1]] })).toBe(false);
    expect(
      isMeaningfulStroke({
        tool: "pen",
        color: "x",
        points: [
          [1, 1],
          [2, 2],
        ],
      }),
    ).toBe(true);
    expect(isMeaningfulStroke({ tool: "box", color: "x", points: [[1, 1]] })).toBe(false);
    expect(
      isMeaningfulStroke({
        tool: "box",
        color: "x",
        points: [
          [1, 1],
          [2, 2],
        ],
      }),
    ).toBe(false);
    expect(
      isMeaningfulStroke({
        tool: "box",
        color: "x",
        points: [
          [1, 1],
          [40, 30],
        ],
      }),
    ).toBe(true);
  });
});
