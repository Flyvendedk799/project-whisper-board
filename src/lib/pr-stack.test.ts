import { describe, expect, it } from "vitest";
import {
  buildStack,
  methodWarning,
  nextMergeable,
  planMerge,
  pullKey,
  type PullInfo,
  type PullLookup,
  type StackTask,
} from "./pr-stack";

const REPO = "o/openbot";
const baseBranchOf = () => "master";

function pull(number: number, head: string, base: string, extra: Partial<PullInfo> = {}): PullInfo {
  return {
    number,
    url: `https://github.com/${REPO}/pull/${number}`,
    title: `PR ${number}`,
    state: "open",
    merged: false,
    draft: false,
    base,
    head,
    headSha: `sha${number}`,
    mergeable: true,
    mergeableState: "clean",
    checks: "success",
    ...extra,
  };
}

function task(
  id: string,
  prNumber: number,
  sectionPosition: number,
  position: number,
  title = `Task ${id}`,
): StackTask {
  return {
    id,
    title,
    repo: REPO,
    prNumber,
    prUrl: `https://github.com/${REPO}/pull/${prNumber}`,
    sectionPosition,
    position,
  };
}

const lookup = (...pulls: PullInfo[]) =>
  new Map<string, PullLookup>(pulls.map((p) => [pullKey(REPO, p.number), p]));

/** The shape of the v2 plan: six stacked phases, each branch based on the one before. */
const STACK = [
  pull(36, "phase-0", "master"),
  pull(37, "phase-1", "phase-0"),
  pull(38, "phase-2", "phase-1"),
  pull(39, "phase-3", "phase-2"),
  pull(40, "phase-4", "phase-3"),
  pull(41, "phase-5", "phase-4"),
];
const STACK_TASKS = [
  task("p0", 36, 11, 1),
  task("p1", 37, 11, 2),
  task("p2", 38, 11, 3),
  task("p3", 39, 11, 4),
  task("p4", 40, 11, 5),
  task("p5", 41, 11, 6),
];

describe("buildStack", () => {
  it("orders a stack parents first, and numbers it from 1", () => {
    const stack = buildStack({ tasks: STACK_TASKS, pulls: lookup(...STACK), baseBranchOf });
    expect(stack.map((e) => e.number)).toEqual([36, 37, 38, 39, 40, 41]);
    expect(stack.map((e) => e.order)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(stack.map((e) => e.parent)).toEqual([
      null,
      pullKey(REPO, 36),
      pullKey(REPO, 37),
      pullKey(REPO, 38),
      pullKey(REPO, 39),
      pullKey(REPO, 40),
    ]);
  });

  it("follows the branches, not the plan's own order, when they disagree", () => {
    // The tasks sit in the plan the other way round; the branches say #37 sits on #36.
    const tasks = [task("late", 36, 5, 1), task("early", 37, 1, 1)];
    const stack = buildStack({
      tasks,
      pulls: lookup(pull(36, "a", "master"), pull(37, "b", "a")),
      baseBranchOf,
    });
    expect(stack.map((e) => e.number)).toEqual([36, 37]);
  });

  it("breaks ties between independent pull requests by where the task is in the plan", () => {
    const tasks = [task("b", 51, 2, 1), task("a", 50, 3, 1), task("c", 52, 2, 2)];
    const stack = buildStack({
      tasks,
      pulls: lookup(pull(50, "x", "master"), pull(51, "y", "master"), pull(52, "z", "master")),
      baseBranchOf,
    });
    // section 2 first (task position 1, then 2), then section 3
    expect(stack.map((e) => e.number)).toEqual([51, 52, 50]);
  });

  it("puts tasks that share a pull request on one entry", () => {
    const tasks = [
      task("a", 40, 11, 5, "Phase 4"),
      task("b", 40, 3, 1, "Fixes"),
      task("c", 41, 11, 6),
    ];
    const stack = buildStack({
      tasks,
      pulls: lookup(pull(40, "p4", "master"), pull(41, "p5", "p4")),
      baseBranchOf,
    });
    expect(stack).toHaveLength(2);
    expect(stack[0].tasks.map((t) => t.title)).toEqual(["Phase 4", "Fixes"]);
  });

  it("calls the first open pull request ready and the ones above it waiting", () => {
    const stack = buildStack({ tasks: STACK_TASKS, pulls: lookup(...STACK), baseBranchOf });
    expect(stack.map((e) => e.status)).toEqual([
      "ready",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(nextMergeable(stack)?.number).toBe(36);
  });

  it("makes the next one ready once its parent is merged", () => {
    const merged = [
      pull(36, "phase-0", "master", { merged: true, state: "closed" }),
      ...STACK.slice(1),
    ];
    const stack = buildStack({ tasks: STACK_TASKS, pulls: lookup(...merged), baseBranchOf });
    expect(stack.map((e) => e.status)).toEqual([
      "merged",
      "ready",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(nextMergeable(stack)?.number).toBe(37);
  });

  it("flags what is in the way", () => {
    const pulls = [
      pull(36, "phase-0", "master", { draft: true }),
      pull(37, "phase-1", "phase-0", { mergeable: false, mergeableState: "dirty" }),
      pull(38, "phase-2", "phase-1", { checks: "failure" }),
      pull(39, "phase-3", "phase-2", { checks: "pending" }),
      pull(40, "phase-4", "phase-3", { state: "closed" }),
      pull(41, "phase-5", "phase-4"),
    ];
    const stack = buildStack({ tasks: STACK_TASKS, pulls: lookup(...pulls), baseBranchOf });
    const codes = stack.map((e) => e.problems.map((p) => p.code));
    expect(codes[0]).toEqual(["draft"]);
    expect(codes[1]).toEqual(["conflicts"]);
    expect(codes[2]).toEqual(["checks_failing"]);
    expect(codes[3]).toEqual(["checks_pending"]);
    expect(codes[4]).toEqual(["closed"]);
    expect(codes[5]).toEqual(["parent_closed"]);
    expect(stack.map((e) => e.status)).toEqual([
      "blocked",
      "blocked",
      "blocked",
      "blocked",
      "closed",
      "blocked",
    ]);
  });

  it("flags a base that is neither the plan's base nor another pull request of the plan", () => {
    const stack = buildStack({
      tasks: [task("a", 60, 1, 1)],
      pulls: lookup(pull(60, "feature", "release-9")),
      baseBranchOf,
    });
    expect(stack[0].problems.map((p) => p.code)).toEqual(["base_unexpected"]);
    expect(stack[0].problems[0].message).toContain("release-9");
  });

  it("does not hang on a cycle, and says so", () => {
    const stack = buildStack({
      tasks: [task("a", 70, 1, 1), task("b", 71, 1, 2)],
      pulls: lookup(pull(70, "a", "b"), pull(71, "b", "a")),
      baseBranchOf,
    });
    expect(stack).toHaveLength(2);
    expect(stack.every((e) => e.problems.some((p) => p.code === "cycle"))).toBe(true);
  });

  it("keeps a pull request GitHub could not be read for, as unknown", () => {
    const stack = buildStack({
      tasks: [task("a", 80, 1, 1)],
      pulls: new Map<string, PullLookup>([[pullKey(REPO, 80), { error: "Not Found" }]]),
      baseBranchOf,
    });
    expect(stack[0].status).toBe("unknown");
    expect(stack[0].problems[0].message).toBe("Not Found");
  });

  it("keeps repositories apart", () => {
    const other: StackTask = { ...task("x", 36, 1, 1), repo: "o/other" };
    const pulls = new Map<string, PullLookup>([
      [pullKey(REPO, 36), pull(36, "phase-0", "master")],
      [
        pullKey("o/other", 36),
        { ...pull(36, "phase-0", "master"), url: "https://github.com/o/other/pull/36" },
      ],
    ]);
    const stack = buildStack({ tasks: [task("a", 36, 1, 1), other], pulls, baseBranchOf });
    expect(stack).toHaveLength(2);
    expect(stack.map((e) => e.key).sort()).toEqual(
      [pullKey(REPO, 36), pullKey("o/other", 36)].sort(),
    );
  });
});

describe("planMerge", () => {
  it("plans a stack in order, retargeting each one stacked on a branch that will be merged away", () => {
    const stack = buildStack({ tasks: STACK_TASKS, pulls: lookup(...STACK), baseBranchOf });
    const steps = planMerge(stack, baseBranchOf);
    expect(steps.map((s) => [s.number, s.action])).toEqual([
      [36, "merge"],
      [37, "retarget_and_merge"],
      [38, "retarget_and_merge"],
      [39, "retarget_and_merge"],
      [40, "retarget_and_merge"],
      [41, "retarget_and_merge"],
    ]);
    expect(steps[1].retargetTo).toBe("master");
    expect(steps[0].retargetTo).toBeUndefined();
  });

  it("skips what is merged, and does not retarget a pull request GitHub already retargeted", () => {
    const pulls = [
      pull(36, "phase-0", "master", { merged: true, state: "closed" }),
      pull(37, "phase-1", "master"), // branch deleted on merge: GitHub moved it
      ...STACK.slice(2),
    ];
    const stack = buildStack({ tasks: STACK_TASKS, pulls: lookup(...pulls), baseBranchOf });
    const steps = planMerge(stack, baseBranchOf);
    expect(steps[0].action).toBe("already_merged");
    expect(steps[1].action).toBe("merge");
    expect(steps[2].action).toBe("retarget_and_merge");
  });

  it("stops at the first pull request that cannot be merged and does not go past the gap", () => {
    const pulls = [
      ...STACK.slice(0, 2),
      pull(38, "phase-2", "phase-1", { mergeable: false, mergeableState: "dirty" }),
      ...STACK.slice(3),
    ];
    const stack = buildStack({ tasks: STACK_TASKS, pulls: lookup(...pulls), baseBranchOf });
    const steps = planMerge(stack, baseBranchOf);
    expect(steps.map((s) => s.action)).toEqual([
      "merge",
      "retarget_and_merge",
      "blocked",
      "not_reached",
      "not_reached",
      "not_reached",
    ]);
    expect(steps[2].reason).toContain("conflicts");
    expect(steps[3].reason).toContain("#38");
  });
});

describe("methodWarning", () => {
  it("warns about squash and rebase on a stack, not about a merge commit or a single PR", () => {
    expect(methodWarning("merge", 6)).toBeNull();
    expect(methodWarning("squash", 1)).toBeNull();
    expect(methodWarning("squash", 6)).toContain("conflict");
    expect(methodWarning("rebase", 2)).toContain("Rebase");
  });
});
