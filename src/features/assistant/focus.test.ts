import { describe, expect, it } from "vitest";
import { focusFromLocation, sameFocus } from "./focus";

const PLAN = "11111111-1111-4111-8111-111111111111";
const TASK = "22222222-2222-4222-8222-222222222222";

describe("focusFromLocation", () => {
  it("reads the plan and the open task from a plan address", () => {
    expect(focusFromLocation(`/app/planner/${PLAN}`, { task: TASK })).toEqual({
      planId: PLAN,
      taskId: TASK,
      projectId: null,
    });
  });

  it("reads a project, and nothing from other screens", () => {
    expect(focusFromLocation(`/app/projects/${PLAN}/updates`, {}).projectId).toBe(PLAN);
    expect(focusFromLocation("/app/tickets", {})).toEqual({
      planId: null,
      taskId: null,
      projectId: null,
    });
    expect(focusFromLocation("/app/planner", { task: TASK }).taskId).toBeNull();
  });

  it("ignores a task that is not an id", () => {
    expect(focusFromLocation(`/app/planner/${PLAN}`, { task: "nope" }).taskId).toBeNull();
    expect(focusFromLocation(`/app/planner/${PLAN}`, undefined).taskId).toBeNull();
    expect(focusFromLocation("/app/planner/not-a-plan", {}).planId).toBeNull();
  });

  it("compares focuses", () => {
    const a = focusFromLocation(`/app/planner/${PLAN}`, { task: TASK });
    expect(sameFocus(a, { ...a })).toBe(true);
    expect(sameFocus(a, { ...a, taskId: null })).toBe(false);
  });
});
