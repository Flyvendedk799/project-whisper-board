import { describe, expect, it } from "vitest";
import {
  cardFace,
  collapseEmptySections,
  defaultBoardLayout,
  OUTLINE_SECTION_THRESHOLD,
  plainTitle,
} from "./board-view";

describe("plainTitle", () => {
  it("strips inline markers and keeps the words", () => {
    expect(plainTitle("**Ridge** and `bridge.z` stay")).toBe("Ridge and bridge.z stay");
  });
});

describe("cardFace", () => {
  it("keeps a short title whole", () => {
    expect(cardFace("Driver and gunner")).toEqual({
      headline: "Driver and gunner",
      detail: "",
    });
  });

  it("splits a prose title at the first real sentence", () => {
    expect(
      cardFace(
        "The battle step is 20 Hz (BATTLE_TICK_MS is 50). A fight nobody is standing in, and that nobody is spectating and striking, accumulates time.",
      ),
    ).toEqual({
      headline: "The battle step is 20 Hz (BATTLE_TICK_MS is 50).",
      detail:
        "A fight nobody is standing in, and that nobody is spectating and striking, accumulates time.",
    });
  });

  it("splits a long sentence on a word boundary", () => {
    expect(
      cardFace(
        "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november",
      ),
    ).toEqual({
      headline: "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike",
      detail: "november",
    });
  });

  it("cuts a solid token at the headline limit", () => {
    expect(cardFace("a".repeat(90))).toEqual({
      headline: "a".repeat(80),
      detail: "a".repeat(10),
    });
  });

  it("ignores an early abbreviation period", () => {
    const title =
      "Dr. alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november";
    expect(cardFace(title)).toEqual({
      headline: "Dr. alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima",
      detail: "mike november",
    });
  });
});

describe("defaultBoardLayout", () => {
  it("keeps a status board in columns and opens a long outline as outline", () => {
    expect(defaultBoardLayout(OUTLINE_SECTION_THRESHOLD - 1)).toBe("columns");
    expect(defaultBoardLayout(OUTLINE_SECTION_THRESHOLD)).toBe("outline");
    expect(defaultBoardLayout(12)).toBe("outline");
  });
});

describe("collapseEmptySections", () => {
  it("collapses empties only when the board also has cards", () => {
    expect(collapseEmptySections([0])).toBe(false);
    expect(collapseEmptySections([0, 0])).toBe(false);
    expect(collapseEmptySections([4, 0, 2])).toBe(true);
    expect(collapseEmptySections([3, 1])).toBe(false);
  });
});
