import { describe, expect, it } from "vitest";
import { patchSetProblem } from "./plan-patch-check";

describe("patch delivery verification", () => {
  it("accepts a complete fast-forward bundle", () => {
    expect(patchSetProblem(["a", "b"], ["a", "b"], "ahead", true)).toBeNull();
  });

  it("rejects unrelated or missing commits before moving the base", () => {
    expect(patchSetProblem(["a"], ["a", "b"], "ahead", true)).toMatch(/Register every commit/);
    expect(patchSetProblem(["a"], ["a"], "diverged", true)).toMatch(/fast-forward/);
  });

  it("allows a diverged branch to enter PR review", () => {
    expect(patchSetProblem(["a"], ["a"], "diverged", false)).toBeNull();
  });
});
