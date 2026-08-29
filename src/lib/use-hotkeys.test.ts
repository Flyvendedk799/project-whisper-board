// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { describeEvent } from "./use-hotkeys";

/**
 * The reducer-shaped part of the hotkey system. Chord and typing behaviour are
 * exercised through the DOM in use-hotkeys.dom.test.tsx; this covers the
 * normalisation every binding is matched against.
 */
describe("describeEvent", () => {
  const press = (init: KeyboardEventInit) => describeEvent(new KeyboardEvent("keydown", init));

  it("lowercases single characters so Shift+G still matches g", () => {
    expect(press({ key: "G" })).toBe("g");
    expect(press({ key: "g" })).toBe("g");
  });

  it("treats cmd and ctrl as the same modifier, so bindings work on both", () => {
    expect(press({ key: "k", metaKey: true })).toBe("mod+k");
    expect(press({ key: "k", ctrlKey: true })).toBe("mod+k");
  });

  it("keeps named keys as they are", () => {
    expect(press({ key: "Escape" })).toBe("Escape");
    expect(press({ key: "Enter" })).toBe("Enter");
    expect(press({ key: "ArrowDown" })).toBe("ArrowDown");
  });

  it("only records shift for named keys — for letters the case already says it", () => {
    expect(press({ key: "J", shiftKey: true })).toBe("j");
    expect(press({ key: "Tab", shiftKey: true })).toBe("shift+Tab");
  });

  it("orders modifiers consistently, so a binding string is unambiguous", () => {
    expect(press({ key: "k", metaKey: true, altKey: true })).toBe("mod+alt+k");
  });
});
