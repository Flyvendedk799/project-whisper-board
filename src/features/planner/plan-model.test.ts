import { describe, expect, it } from "vitest";
import type { PlanWithSections, TaskWithAgent } from "@/data";
import {
  advanceTip,
  applyTaskMove,
  attentionChips,
  boardOrder,
  countByStatus,
  eventKindForStatus,
  eventVerb,
  groupAttachmentsByTask,
  hasActiveFilters,
  initials,
  locateTask,
  matchesFileKind,
  matchesFilters,
  nextStatus,
  NO_FILTERS,
  placeTask,
  progressOf,
  sectionColor,
  SECTION_PALETTE,
  taskLink,
  taskTitleFromFileName,
  timeAgo,
  visibleAttachments,
  workingAgentCount,
} from "./plan-model";

function task(id: string, sectionId: string, position: number, extra: Partial<TaskWithAgent> = {}) {
  return {
    id,
    section_id: sectionId,
    position,
    title: `Task ${id}`,
    status: "available",
    priority: "medium",
    assigned_agent_id: null,
    assigned_user_id: null,
    created_at: "",
    ...extra,
  } as TaskWithAgent;
}

function planOf(columns: Record<string, TaskWithAgent[]>): PlanWithSections {
  return {
    id: "p",
    sections: Object.entries(columns).map(([id, tasks], index) => ({
      id,
      plan_id: "p",
      title: id,
      position: index,
      tasks,
    })),
  } as unknown as PlanWithSections;
}

const ids = (plan: PlanWithSections, section: string) =>
  plan.sections.find((s) => s.id === section)!.tasks.map((t) => `${t.id}@${t.position}`);

describe("status", () => {
  it("advances through the pipeline, reopens done and unblocks blocked", () => {
    expect(nextStatus("backlog")).toBe("available");
    expect(nextStatus("available")).toBe("claimed");
    expect(nextStatus("in_review")).toBe("done");
    expect(nextStatus("done")).toBe("available");
    expect(nextStatus("blocked")).toBe("in_progress");
    expect(advanceTip("done")).toBe("Reopen");
    expect(advanceTip("blocked")).toMatch(/Unblock/);
    expect(advanceTip("claimed")).toBe("Move to In progress");
  });

  it("picks the activity kind for a status change", () => {
    expect(eventKindForStatus("done")).toBe("task_completed");
    expect(eventKindForStatus("blocked")).toBe("task_blocked");
    expect(eventKindForStatus("in_progress")).toBe("task_started");
    expect(eventKindForStatus("in_review")).toBe("task_reviewed");
    expect(eventKindForStatus("available")).toBe("task_updated");
  });

  it("has a verb for every event the screen records", () => {
    for (const kind of ["task_moved", "attachment_added", "attachment_removed", "comment_added"]) {
      expect(eventVerb(kind)).not.toBe(kind);
    }
    expect(eventVerb("something_new")).toBe("something new");
  });
});

describe("counting", () => {
  const tasks = [
    task("a", "s", 1, { status: "done" }),
    task("b", "s", 2, { status: "in_review" }),
    task("c", "s", 3, { status: "blocked" }),
    task("d", "s", 4, { status: "in_review" }),
  ];

  it("reports progress as a whole percent", () => {
    expect(progressOf(tasks)).toEqual({ done: 1, total: 4, percent: 25 });
    expect(progressOf([])).toEqual({ done: 0, total: 0, percent: 0 });
  });

  it("counts by status and lists what needs a person", () => {
    expect(countByStatus(tasks).in_review).toBe(2);
    expect(attentionChips(tasks)).toEqual([
      { status: "in_review", label: "2 to review", count: 2 },
      { status: "blocked", label: "1 blocked", count: 1 },
    ]);
    expect(attentionChips([task("a", "s", 1)])).toEqual([]);
  });

  it("counts distinct agents that are actually at work", () => {
    expect(
      workingAgentCount([
        task("a", "s", 1, { assigned_agent_id: "x", status: "in_progress" }),
        task("b", "s", 2, { assigned_agent_id: "x", status: "claimed" }),
        task("c", "s", 3, { assigned_agent_id: "y", status: "done" }),
        task("d", "s", 4, { assigned_agent_id: "z", status: "in_review" }),
      ]),
    ).toBe(2);
  });

  it("cycles section colours but keeps a chosen one", () => {
    expect(sectionColor(null, 0)).toBe(SECTION_PALETTE[0]);
    expect(sectionColor(undefined, SECTION_PALETTE.length)).toBe(SECTION_PALETTE[0]);
    expect(sectionColor("red", 3)).toBe("red");
  });
});

describe("filters", () => {
  const mine = task("a", "s", 1, { assigned_user_id: "me", title: "Fix Safari upload" });
  const agent = task("b", "s", 2, {
    assigned_agent_id: "bot",
    priority: "high",
    status: "blocked",
  });
  const nobody = task("c", "s", 3);

  it("combines status, priority, assignee and search", () => {
    expect(matchesFilters(mine, NO_FILTERS, "me")).toBe(true);
    expect(matchesFilters(mine, { ...NO_FILTERS, who: "me" }, "me")).toBe(true);
    expect(matchesFilters(agent, { ...NO_FILTERS, who: "me" }, "me")).toBe(false);
    expect(matchesFilters(agent, { ...NO_FILTERS, who: "agents" }, "me")).toBe(true);
    expect(matchesFilters(nobody, { ...NO_FILTERS, who: "none" }, "me")).toBe(true);
    expect(matchesFilters(mine, { ...NO_FILTERS, who: "none" }, "me")).toBe(false);
    expect(
      matchesFilters(agent, { ...NO_FILTERS, status: "blocked", priority: "high" }, "me"),
    ).toBe(true);
    expect(matchesFilters(agent, { ...NO_FILTERS, priority: "low" }, "me")).toBe(false);
    expect(matchesFilters(mine, { ...NO_FILTERS, q: "  safari " }, "me")).toBe(true);
    expect(matchesFilters(mine, { ...NO_FILTERS, q: "billing" }, "me")).toBe(false);
  });

  it("'Mine' matches nothing when nobody is signed in", () => {
    expect(matchesFilters(mine, { ...NO_FILTERS, who: "me" }, null)).toBe(false);
  });

  it("knows when a filter is active", () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, q: " " })).toBe(false);
    expect(hasActiveFilters({ ...NO_FILTERS, who: "agents" })).toBe(true);
  });

  it("lists tasks in reading order after filtering, for previous/next", () => {
    const plan = planOf({
      one: [task("a", "one", 2), task("b", "one", 1, { status: "blocked" })],
      two: [task("c", "two", 1, { status: "blocked" })],
    });
    expect(boardOrder(plan, NO_FILTERS, "me")).toEqual(["b", "a", "c"]);
    expect(boardOrder(plan, { ...NO_FILTERS, status: "blocked" }, "me")).toEqual(["b", "c"]);
  });
});

describe("moving tasks", () => {
  it("places a task before another, at the end, or where it already was", () => {
    expect(placeTask(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(placeTask(["a", "b", "c"], "a")).toEqual(["b", "c", "a"]);
    expect(placeTask(["a", "b"], "x", "b")).toEqual(["a", "x", "b"]);
    expect(placeTask(["a", "b"], "x", "gone")).toEqual(["a", "b", "x"]);
    expect(placeTask(["a", "b", "c"], "b", "b")).toEqual(["a", "c", "b"]);
  });

  it("renumbers the target column and removes the task from its old one", () => {
    const plan = planOf({
      one: [task("a", "one", 1), task("b", "one", 5)],
      two: [task("c", "two", 3), task("d", "two", 3)],
    });
    const moved = applyTaskMove(plan, "a", "two", "d");
    expect(ids(moved, "one")).toEqual(["b@5"]);
    expect(ids(moved, "two")).toEqual(["c@1", "a@2", "d@3"]);
    expect(moved.sections[1].tasks[1].section_id).toBe("two");
  });

  it("reorders inside a section and ignores a section that does not exist", () => {
    const plan = planOf({ one: [task("a", "one", 1), task("b", "one", 2), task("c", "one", 3)] });
    expect(ids(applyTaskMove(plan, "c", "one", "a"), "one")).toEqual(["c@1", "a@2", "b@3"]);
    expect(applyTaskMove(plan, "a", "missing")).toBe(plan);
    expect(applyTaskMove(plan, "missing", "one")).toBe(plan);
  });

  it("remembers where a task was so a move can be undone", () => {
    const plan = planOf({ one: [task("a", "one", 1), task("b", "one", 2)], two: [] });
    expect(locateTask(plan, "a")).toEqual({ sectionId: "one", beforeId: "b" });
    expect(locateTask(plan, "b")).toEqual({ sectionId: "one", beforeId: null });
    expect(locateTask(plan, "x")).toBeNull();

    const there = locateTask(plan, "a")!;
    const moved = applyTaskMove(plan, "a", "two");
    const back = applyTaskMove(moved, "a", there.sectionId, there.beforeId);
    expect(ids(back, "one")).toEqual(["a@1", "b@2"]);
  });
});

describe("attachments", () => {
  const rows = [
    { id: "1", task_id: "t", mime_type: "image/png", source_attachment_id: null },
    { id: "2", task_id: "t", mime_type: "image/png", source_attachment_id: "1" },
    { id: "3", task_id: "u", mime_type: "video/mp4", source_attachment_id: null },
  ];

  it("shows a marked-up copy instead of its original", () => {
    expect(visibleAttachments(rows).map((r) => r.id)).toEqual(["2", "3"]);
    // Removing the copy brings the original back.
    expect(visibleAttachments(rows.filter((r) => r.id !== "2")).map((r) => r.id)).toEqual([
      "1",
      "3",
    ]);
  });

  it("groups what is visible by task", () => {
    const grouped = groupAttachmentsByTask(rows as never);
    expect([...grouped.keys()]).toEqual(["t", "u"]);
    expect(grouped.get("t")!.map((r) => r.id)).toEqual(["2"]);
  });

  it("filters by kind, keeping audio with documents", () => {
    expect(matchesFileKind("image/png", "image")).toBe(true);
    expect(matchesFileKind("image/png", "video")).toBe(false);
    expect(matchesFileKind("audio/mpeg", "docs")).toBe(true);
    expect(matchesFileKind("application/pdf", "docs")).toBe(true);
    expect(matchesFileKind("video/mp4", "docs")).toBe(false);
    expect(matchesFileKind(null, "all")).toBe(true);
  });

  it("makes a task title from a dropped file name", () => {
    expect(taskTitleFromFileName("Onboarding-checklist_v2.png")).toBe("Onboarding checklist v2");
    expect(taskTitleFromFileName(".png")).toBe("New task");
    expect(taskTitleFromFileName("notes")).toBe("notes");
  });
});

describe("words", () => {
  const now = new Date("2026-09-30T12:00:00Z").getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("says how long ago, like the design", () => {
    expect(timeAgo(ago(10_000), now)).toBe("Just now");
    expect(timeAgo(ago(25 * 60_000), now)).toBe("25 minutes ago");
    expect(timeAgo(ago(60 * 60_000), now)).toBe("1 hour ago");
    expect(timeAgo(ago(2 * 3600_000), now)).toBe("2 hours ago");
    expect(timeAgo(ago(30 * 3600_000), now)).toBe("Yesterday");
    expect(timeAgo(ago(3 * 86400_000), now)).toBe("3 days ago");
    expect(timeAgo(null, now)).toBe("");
    expect(timeAgo("nonsense", now)).toBe("");
  });

  it("makes initials and task links", () => {
    expect(initials("Maja Lindqvist")).toBe("ML");
    expect(initials("jonas")).toBe("J");
    expect(initials(null)).toBe("?");
    expect(taskLink("https://app.test", "p1", "t1")).toBe(
      "https://app.test/app/planner/p1?task=t1",
    );
  });
});
