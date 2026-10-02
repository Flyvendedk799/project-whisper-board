import { describe, expect, it } from "vitest";
import {
  AUTO_ENRICH_MAX_ERRORS,
  AUTO_ENRICH_SESSION_CAP,
  enrichQueue,
  mayContinue,
  planRepo,
  readAssessment,
  selectNextTask,
  shouldAddContext,
  type EnrichPlan,
  type EnrichTask,
} from "./auto-enrich";

const task = (id: string, over: Partial<EnrichTask> = {}): EnrichTask => ({
  id,
  title: `Task ${id}`,
  status: "available",
  priority: "medium",
  position: 1,
  ai_assessed_at: null,
  ...over,
});

const plan = (sections: EnrichPlan["sections"], over: Partial<EnrichPlan> = {}): EnrichPlan => ({
  id: "p",
  sections,
  ...over,
});

describe("enrichQueue", () => {
  it("leaves out done, already assessed, already tried and untitled tasks", () => {
    const queue = enrichQueue(
      plan([
        {
          position: 1,
          tasks: [
            task("a"),
            task("done", { status: "done" }),
            task("seen", { ai_assessed_at: "2026-10-01T00:00:00Z" }),
            task("tried"),
            task("blank", { title: "  " }),
          ],
        },
      ]),
      new Set(["tried"]),
    );
    expect(queue.map((t) => t.id)).toEqual(["a"]);
  });

  it("takes work in progress first, then urgent before idle, then board order", () => {
    const queue = enrichQueue(
      plan([
        {
          position: 2,
          tasks: [task("late", { position: 1 })],
        },
        {
          position: 1,
          tasks: [
            task("backlog", { status: "backlog", priority: "critical" }),
            task("low", { priority: "low", position: 2 }),
            task("high", { priority: "high", position: 3 }),
            task("first", { position: 1 }),
            task("doing", { status: "in_progress", priority: "low", position: 4 }),
          ],
        },
      ]),
    );
    expect(queue.map((t) => t.id)).toEqual(["doing", "high", "first", "late", "low", "backlog"]);
  });

  it("returns the next task, or null when the plan is caught up", () => {
    const p = plan([{ position: 1, tasks: [task("a"), task("b")] }]);
    expect(selectNextTask(p)?.id).toBe("a");
    expect(selectNextTask(p, new Set(["a"]))?.id).toBe("b");
    expect(selectNextTask(p, new Set(["a", "b"]))).toBeNull();
    expect(selectNextTask(plan(null))).toBeNull();
  });
});

describe("limits", () => {
  it("stops at the page-load cap and after repeated failures", () => {
    expect(mayContinue({ processed: 0, consecutiveErrors: 0 })).toBe(true);
    expect(mayContinue({ processed: AUTO_ENRICH_SESSION_CAP - 1, consecutiveErrors: 0 })).toBe(
      true,
    );
    expect(mayContinue({ processed: AUTO_ENRICH_SESSION_CAP, consecutiveErrors: 0 })).toBe(false);
    expect(mayContinue({ processed: 1, consecutiveErrors: AUTO_ENRICH_MAX_ERRORS })).toBe(false);
  });
});

describe("context", () => {
  it("finds the repository on the plan or its project", () => {
    expect(planRepo({ github_repo: " acme/app ", project: null })).toBe("acme/app");
    expect(planRepo({ github_repo: null, project: { github_repo: "acme/web" } })).toBe("acme/web");
    expect(planRepo({ github_repo: "", project: { github_repo: null } })).toBeNull();
  });

  it("is added only when asked for and there is a repository to read", () => {
    const withRepo = { github_repo: "acme/app", project: null };
    const without = { github_repo: null, project: null };
    expect(shouldAddContext({ needs: ["context", "steps"] }, withRepo)).toBe(true);
    expect(shouldAddContext({ needs: ["steps"] }, withRepo)).toBe(false);
    expect(shouldAddContext({ needs: ["context"] }, without)).toBe(false);
    expect(shouldAddContext(null, withRepo)).toBe(false);
  });
});

describe("readAssessment", () => {
  it("reads what assessTask stored and nothing else", () => {
    expect(readAssessment({ needs: ["steps", "bogus", "context"], note: "Big." })).toEqual({
      needs: ["context", "steps"],
      note: "Big.",
    });
    expect(readAssessment(null)).toBeNull();
    expect(readAssessment([])).toBeNull();
    expect(readAssessment({ needs: "context" })).toEqual({ needs: [], note: "" });
  });
});
