import { describe, expect, it } from "vitest";
import type { GitHubPort } from "./github-port";
import { loadPlanPulls, mergePlanPulls, type PlanPullsDeps } from "./plan-pulls";
import type { MergeMethod, PullInfo } from "./pr-stack";

const REPO = "o/openbot";

/** A fake GitHub holding a stack of pull requests, which merges the way GitHub does. */
function fakeGitHub(
  initial: PullInfo[],
  opts: { canPush?: boolean; deleteBranchOnMerge?: boolean } = {},
) {
  const pulls = new Map(initial.map((p) => [p.number, { ...p }]));
  const calls: string[] = [];
  const mergeableAfterRetarget = new Map<number, number>(); // pull -> reads still returning null

  const port: GitHubPort = {
    async repoInfo() {
      return { defaultBranch: "master", canPush: opts.canPush ?? true };
    },
    async getPull(_repo, number) {
      const p = pulls.get(number);
      if (!p) throw Object.assign(new Error("Not Found"), { status: 404 });
      const pending = mergeableAfterRetarget.get(number) ?? 0;
      if (pending > 0) {
        mergeableAfterRetarget.set(number, pending - 1);
        return { ...p, mergeable: null, mergeableState: "unknown" };
      }
      return { ...p };
    },
    async checksFor(_repo, sha) {
      return pulls.get(Number(sha.replace("sha", "")))?.checks ?? "none";
    },
    async setBase(_repo, number, base) {
      calls.push(`setBase #${number} -> ${base}`);
      const p = pulls.get(number)!;
      p.base = base;
      mergeableAfterRetarget.set(number, 1);
    },
    async merge(_repo, number, method: MergeMethod) {
      calls.push(`merge #${number} (${method})`);
      const p = pulls.get(number)!;
      p.merged = true;
      p.state = "closed";
      if (opts.deleteBranchOnMerge) {
        for (const other of pulls.values()) if (other.base === p.head) other.base = "master";
      }
      return { merged: true, sha: `merge-${number}`, message: "Merged" };
    },
  };
  return { port, calls, pulls };
}

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

const stack = () => [
  pull(36, "phase-0", "master"),
  pull(37, "phase-1", "phase-0"),
  pull(38, "phase-2", "phase-1"),
];

/** Just enough of Supabase's query builder for the four calls the module makes. */
function fakeDb(tasks: Array<{ id: string; title: string; position: number; pr: number }>) {
  const state = {
    taskStatus: new Map<string, string>(),
    events: [] as Array<Record<string, unknown>>,
  };
  const rows = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    position: t.position,
    pr_url: `https://github.com/${REPO}/pull/${t.pr}`,
    section: { position: 1 },
  }));
  const db = {
    from(table: string) {
      if (table === "plans") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({
            data: { id: "plan-1", workspace_id: "ws", github_repo: REPO, github_base: null },
          }),
        };
        return chain;
      }
      if (table === "plan_tasks") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          not: async () => ({ data: rows, error: null }),
          update: (patch: { pr_status?: string }) => ({
            in: async (_col: string, ids: string[]) => {
              for (const id of ids) state.taskStatus.set(id, patch.pr_status ?? "");
              return { error: null };
            },
          }),
        };
        return chain;
      }
      if (table === "plan_events") {
        return {
          insert: async (row: Record<string, unknown>) => {
            state.events.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { db: db as unknown as PlanPullsDeps["db"], state };
}

const TASKS = [
  { id: "t36", title: "Phase 0", position: 1, pr: 36 },
  { id: "t37", title: "Phase 1", position: 2, pr: 37 },
  { id: "t38", title: "Phase 2", position: 3, pr: 38 },
];

function setup(pulls: PullInfo[] = stack(), ghOpts = {}) {
  const gh = fakeGitHub(pulls, ghOpts);
  const database = fakeDb(TASKS);
  const deps: PlanPullsDeps = {
    db: database.db,
    github: gh.port,
    planId: "plan-1",
    actorId: "user-1",
    sleep: async () => {},
  };
  return { gh, database, deps };
}

describe("loadPlanPulls", () => {
  it("reads the stack from GitHub in merge order and works out the base branch", async () => {
    const { deps } = setup();
    const loaded = await loadPlanPulls(deps);
    expect(loaded.stack.map((e) => e.number)).toEqual([36, 37, 38]);
    expect(loaded.stack.map((e) => e.status)).toEqual(["ready", "waiting", "waiting"]);
    expect(loaded.baseBranches[REPO]).toBe("master");
    expect(loaded.orderIsGuess).toBe(false);
    expect(loaded.tokenCanMerge).toBe(true);
    expect(loaded.configured).toBe(true);
  });

  it("says so instead of failing when GitHub is not connected", async () => {
    const { deps } = setup();
    const loaded = await loadPlanPulls({ ...deps, github: null });
    expect(loaded.configured).toBe(false);
    expect(loaded.stack.every((e) => e.status === "unknown")).toBe(true);
    expect(loaded.stack[0].problems[0].message).toContain("not connected");
    expect(loaded.orderIsGuess).toBe(true);
    expect(loaded.stack.map((e) => e.number)).toEqual([36, 37, 38]);
  });

  it("reports a token that cannot write", async () => {
    const { deps } = setup(stack(), { canPush: false });
    expect((await loadPlanPulls(deps)).tokenCanMerge).toBe(false);
  });
});

describe("mergePlanPulls", () => {
  it("a dry run says what would happen and changes nothing", async () => {
    const { deps, gh, database } = setup();
    const result = await mergePlanPulls(deps, { dryRun: true });
    expect(result.dryRun).toBe(true);
    expect(result.steps.map((s) => [s.number, s.action, s.outcome])).toEqual([
      [36, "merge", "planned"],
      [37, "retarget_and_merge", "planned"],
      [38, "retarget_and_merge", "planned"],
    ]);
    expect(result.remaining).toBe(3);
    expect(gh.calls).toEqual([]);
    expect(database.state.events).toEqual([]);
  });

  it("merges the stack in order, pointing each one at the base once its parent is in", async () => {
    const { deps, gh, database } = setup();
    const result = await mergePlanPulls(deps, {});
    expect(gh.calls).toEqual([
      "merge #36 (merge)",
      "setBase #37 -> master",
      "merge #37 (merge)",
      "setBase #38 -> master",
      "merge #38 (merge)",
    ]);
    expect(result.steps.map((s) => s.outcome)).toEqual(["merged", "merged", "merged"]);
    expect(result.remaining).toBe(0);
    expect(result.stoppedAt).toBeNull();
    expect(database.state.taskStatus.get("t37")).toBe("merged");
    expect(database.state.events.map((e) => e.kind)).toEqual([
      "pr_merged",
      "pr_merged",
      "pr_merged",
    ]);
    expect(database.state.events[0].actor_id).toBe("user-1");
  });

  it("does not retarget what GitHub already retargeted when the branch was deleted", async () => {
    const { deps, gh } = setup(stack(), { deleteBranchOnMerge: true });
    await mergePlanPulls(deps, {});
    expect(gh.calls.filter((c) => c.startsWith("setBase"))).toEqual([]);
    expect(gh.calls.filter((c) => c.startsWith("merge"))).toHaveLength(3);
  });

  it("waits for GitHub to work out mergeability after a retarget", async () => {
    const { deps, gh } = setup();
    let slept = 0;
    await mergePlanPulls({ ...deps, sleep: async () => void (slept += 1) }, {});
    expect(slept).toBeGreaterThan(0);
    expect(gh.calls.filter((c) => c.startsWith("merge"))).toHaveLength(3);
  });

  it("stops at the first one that cannot be merged and leaves the rest alone", async () => {
    const pulls = stack();
    pulls[2] = pull(38, "phase-2", "phase-1", { mergeable: false, mergeableState: "dirty" });
    const { deps, gh } = setup(pulls);
    const result = await mergePlanPulls(deps, {});
    expect(result.stoppedAt).toBe(38);
    expect(result.steps.map((s) => s.outcome)).toEqual(["merged", "merged", "failed"]);
    expect(result.steps[2].message).toContain("conflicts");
    expect(gh.calls.filter((c) => c.startsWith("merge"))).toEqual([
      "merge #36 (merge)",
      "merge #37 (merge)",
    ]);
  });

  it("holds a merge back for failing or running checks, unless told to ignore them", async () => {
    const pulls = stack();
    pulls[0] = pull(36, "phase-0", "master", { checks: "pending" });
    const blocked = setup(pulls);
    const first = await mergePlanPulls(blocked.deps, {});
    expect(first.steps[0].outcome).toBe("failed");
    expect(blocked.gh.calls).toEqual([]);

    const forced = setup(pulls);
    const second = await mergePlanPulls(forced.deps, { ignoreChecks: true });
    expect(second.steps.map((s) => s.outcome)).toEqual(["merged", "merged", "merged"]);
  });

  it("is resumable: merged pull requests are skipped on a second run", async () => {
    const { deps, gh } = setup();
    await mergePlanPulls(deps, { max: 1 });
    expect(gh.calls).toEqual(["merge #36 (merge)"]);
    const second = await mergePlanPulls(deps, {});
    expect(second.steps.map((s) => s.outcome)).toEqual(["skipped", "merged", "merged"]);
    const third = await mergePlanPulls(deps, {});
    expect(third.steps.map((s) => s.outcome)).toEqual(["skipped", "skipped", "skipped"]);
    expect(third.remaining).toBe(0);
  });

  it("max 1 merges just the next one and reports the rest as pending", async () => {
    const { deps } = setup();
    const result = await mergePlanPulls(deps, { max: 1 });
    expect(result.steps.map((s) => s.outcome)).toEqual(["merged", "pending", "pending"]);
    expect(result.remaining).toBe(2);
    expect(result.stoppedAt).toBeNull();
  });

  it("only merges the named pull request when it is next in line", async () => {
    const { deps, gh } = setup();
    await expect(mergePlanPulls(deps, { only: `${REPO}#38` })).rejects.toThrow("Merge #36 first");
    expect(gh.calls).toEqual([]);
    const ok = await mergePlanPulls(deps, { only: `${REPO}#36` });
    expect(ok.steps.map((s) => s.outcome)).toEqual(["merged", "pending", "pending"]);
  });

  it("uses the method it is given", async () => {
    const { deps, gh } = setup();
    const result = await mergePlanPulls(deps, { method: "squash", max: 1 });
    expect(gh.calls).toEqual(["merge #36 (squash)"]);
    expect(result.warning).toContain("Squash");
  });

  it("refuses to merge a pull request that is stacked on one that is not merged", async () => {
    // #37 reports as stacked on #36, but #36 is closed unmerged: the plan stops there, nothing is touched.
    const pulls = stack();
    pulls[0] = pull(36, "phase-0", "master", { state: "closed" });
    const { deps, gh } = setup(pulls);
    const result = await mergePlanPulls(deps, {});
    expect(result.steps[0].outcome).toBe("failed");
    expect(result.steps[1].outcome).toBe("not_reached");
    expect(gh.calls).toEqual([]);
  });

  it("will not retarget a pull request that is not part of a stack", async () => {
    const pulls = [pull(36, "phase-0", "release-9")];
    const { deps, gh } = setup(pulls);
    const result = await mergePlanPulls(deps, {});
    expect(result.steps[0].outcome).toBe("failed");
    expect(result.steps[0].message).toContain("release-9");
    expect(gh.calls).toEqual([]);
  });

  it("will not merge with a token that cannot write, and says why", async () => {
    const { deps } = setup(stack(), { canPush: false });
    await expect(mergePlanPulls(deps, {})).rejects.toThrow("cannot write");
    // but a dry run still tells you what would happen
    await expect(mergePlanPulls(deps, { dryRun: true })).resolves.toBeTruthy();
  });

  it("turns a GitHub refusal into a message instead of throwing", async () => {
    const { deps, gh } = setup();
    gh.port.merge = async () => {
      throw Object.assign(new Error("Resource not accessible by personal access token"), {
        status: 403,
      });
    };
    const result = await mergePlanPulls(deps, {});
    expect(result.steps[0].outcome).toBe("failed");
    expect(result.steps[0].message).toContain("not allowed");
    expect(result.steps[0].message).not.toMatch(/ghp_|github_pat_/);
    expect(result.stoppedAt).toBe(36);
  });

  it("needs a connected GitHub", async () => {
    const { deps } = setup();
    await expect(mergePlanPulls({ ...deps, github: null }, {})).rejects.toThrow("not connected");
  });
});
