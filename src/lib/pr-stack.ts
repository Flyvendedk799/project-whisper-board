/**
 * Pull requests of a plan, in the order they have to be merged.
 *
 * A plan built phase by phase produces a STACK: phase 1's branch is based on phase 0's, and so on, so
 * merging them out of order drags unreviewed commits along or leaves conflicts. This works the order
 * out from the branches themselves (a PR whose base is another PR's head comes after it), breaking
 * ties by where the task sits in the plan, and says what is in the way of each merge.
 *
 * Pure: it is given what GitHub said and returns a description. Nothing here talks to GitHub.
 */

export type ChecksState = "success" | "failure" | "pending" | "none";

/** What GitHub says about one pull request right now. */
export type PullInfo = {
  number: number;
  url: string;
  title: string;
  state: "open" | "closed";
  merged: boolean;
  draft: boolean;
  /** Branch it merges into. */
  base: string;
  /** Branch it comes from. */
  head: string;
  /** Latest commit on the head branch, which checks are reported against. */
  headSha: string;
  /** null while GitHub is still working it out. */
  mergeable: boolean | null;
  mergeableState: string | null;
  checks: ChecksState;
};

/** A plan task that points at a pull request. */
export type StackTask = {
  id: string;
  title: string;
  repo: string;
  prNumber: number;
  prUrl: string;
  sectionPosition: number;
  position: number;
};

export type ProblemCode =
  | "unreadable"
  | "closed"
  | "parent_closed"
  | "draft"
  | "conflicts"
  | "checks_failing"
  | "checks_pending"
  | "base_unexpected"
  | "cycle";

export type Problem = { code: ProblemCode; message: string };

export type StackStatus =
  /** Already merged. */
  | "merged"
  /** Can be merged now. */
  | "ready"
  /** Fine, but an earlier pull request in the stack has to go first. */
  | "waiting"
  /** Something has to be fixed before it can merge. */
  | "blocked"
  /** Closed without merging. */
  | "closed"
  /** GitHub could not be read for it. */
  | "unknown";

export type StackEntry = {
  /** `owner/name#123`, unique across repositories. */
  key: string;
  repo: string;
  number: number;
  url: string;
  tasks: Array<{ id: string; title: string }>;
  /** Null when GitHub could not be read. */
  info: PullInfo | null;
  /** The entry this one is stacked on (its base is that one's head), if any. */
  parent: string | null;
  /** 1-based position in the merge order. */
  order: number;
  status: StackStatus;
  problems: Problem[];
};

export type PullLookup = PullInfo | { error: string };

export const pullKey = (repo: string, number: number) => `${repo}#${number}`;

const isError = (value: PullLookup | undefined): value is { error: string } =>
  Boolean(value) && "error" in (value as object);

type Draft = {
  key: string;
  repo: string;
  number: number;
  url: string;
  tasks: Array<{ id: string; title: string }>;
  info: PullInfo | null;
  readError: string | null;
  sectionPosition: number;
  position: number;
};

/**
 * Collapse tasks to pull requests (two tasks can share one) and attach what GitHub said. The position
 * of a pull request is the earliest of its tasks, so the plan's own order is what breaks ties.
 */
function draftsFrom(tasks: StackTask[], pulls: ReadonlyMap<string, PullLookup>): Draft[] {
  const drafts = new Map<string, Draft>();
  for (const task of tasks) {
    const key = pullKey(task.repo, task.prNumber);
    const known = pulls.get(key);
    const existing = drafts.get(key);
    if (existing) {
      existing.tasks.push({ id: task.id, title: task.title });
      if (
        task.sectionPosition < existing.sectionPosition ||
        (task.sectionPosition === existing.sectionPosition && task.position < existing.position)
      ) {
        existing.sectionPosition = task.sectionPosition;
        existing.position = task.position;
      }
      continue;
    }
    drafts.set(key, {
      key,
      repo: task.repo,
      number: task.prNumber,
      url: task.prUrl,
      tasks: [{ id: task.id, title: task.title }],
      info: known && !isError(known) ? known : null,
      readError: isError(known) ? known.error : known ? null : "GitHub was not asked about it.",
      sectionPosition: task.sectionPosition,
      position: task.position,
    });
  }
  return [...drafts.values()];
}

/** The pull request this one is stacked on: another draft whose head is this one's base. */
function parentsOf(drafts: Draft[]): Map<string, string | null> {
  const parents = new Map<string, string | null>();
  for (const draft of drafts) {
    if (!draft.info) {
      parents.set(draft.key, null);
      continue;
    }
    const candidates = drafts
      .filter(
        (other) =>
          other.key !== draft.key &&
          other.repo === draft.repo &&
          other.info?.head === draft.info?.base,
      )
      // Prefer one still in play over a closed leftover on the same branch name.
      .sort(
        (a, b) =>
          Number(a.info?.state === "closed" && !a.info.merged) -
            Number(b.info?.state === "closed" && !b.info.merged) || a.number - b.number,
      );
    parents.set(draft.key, candidates[0]?.key ?? null);
  }
  return parents;
}

/** Parents first; among those free to go, the plan's own order. A cycle is appended, flagged by the caller. */
function mergeOrder(drafts: Draft[], parents: Map<string, string | null>) {
  const byKey = new Map(drafts.map((d) => [d.key, d]));
  const done = new Set<string>();
  const order: Draft[] = [];
  const rank = (a: Draft, b: Draft) =>
    a.sectionPosition - b.sectionPosition ||
    a.position - b.position ||
    a.repo.localeCompare(b.repo) ||
    a.number - b.number;

  let remaining = [...drafts];
  while (remaining.length > 0) {
    const free = remaining.filter((d) => {
      const parent = parents.get(d.key);
      return !parent || done.has(parent) || !byKey.has(parent);
    });
    if (free.length === 0) break;
    free.sort(rank);
    const next = free[0];
    order.push(next);
    done.add(next.key);
    remaining = remaining.filter((d) => d.key !== next.key);
  }
  const cyclic = remaining.sort(rank);
  return { order, cyclic: new Set(cyclic.map((d) => d.key)), all: [...order, ...cyclic] };
}

/**
 * Describe the stack. `baseBranchOf` says which branch each repository's work should end up on
 * (the plan's base branch, or the repository's default).
 */
export function buildStack(input: {
  tasks: StackTask[];
  pulls: ReadonlyMap<string, PullLookup>;
  baseBranchOf: (repo: string) => string;
}): StackEntry[] {
  const drafts = draftsFrom(input.tasks, input.pulls);
  const parents = parentsOf(drafts);
  const { all, cyclic } = mergeOrder(drafts, parents);
  const byKey = new Map(drafts.map((d) => [d.key, d]));

  const isMerged = (d: Draft | undefined) => Boolean(d?.info?.merged);
  const isDeadEnd = (d: Draft | undefined) =>
    Boolean(d?.info && d.info.state === "closed" && !d.info.merged);

  /** Walk up the stack: is any ancestor closed without merging? */
  const deadAncestor = (d: Draft): Draft | null => {
    const seen = new Set<string>();
    let at = parents.get(d.key);
    while (at && !seen.has(at)) {
      seen.add(at);
      const parent = byKey.get(at);
      if (isDeadEnd(parent)) return parent ?? null;
      at = parents.get(at) ?? null;
    }
    return null;
  };

  return all.map((draft, index): StackEntry => {
    const info = draft.info;
    const parentKey = parents.get(draft.key) ?? null;
    const parent = parentKey ? byKey.get(parentKey) : undefined;
    const problems: Problem[] = [];
    const base: Omit<StackEntry, "status" | "problems"> = {
      key: draft.key,
      repo: draft.repo,
      number: draft.number,
      url: info?.url ?? draft.url,
      tasks: draft.tasks,
      info,
      parent: parentKey,
      order: index + 1,
    };

    if (!info) {
      problems.push({
        code: "unreadable",
        message: draft.readError ?? "GitHub could not be read for this pull request.",
      });
      return { ...base, status: "unknown", problems };
    }
    if (info.merged) return { ...base, status: "merged", problems };
    if (info.state === "closed") {
      problems.push({ code: "closed", message: "Closed without being merged." });
      return { ...base, status: "closed", problems };
    }

    if (cyclic.has(draft.key)) {
      problems.push({
        code: "cycle",
        message:
          "Its base and head branches point at each other, so there is no order to merge in.",
      });
    }
    const dead = deadAncestor(draft);
    if (dead) {
      problems.push({
        code: "parent_closed",
        message: `Stacked on #${dead.number}, which was closed without being merged.`,
      });
    }
    const expectedBase = input.baseBranchOf(draft.repo);
    if (!parent && info.base !== expectedBase) {
      problems.push({
        code: "base_unexpected",
        message: `Targets ${info.base}, which is neither ${expectedBase} nor another pull request in this plan.`,
      });
    }
    if (info.draft) problems.push({ code: "draft", message: "Still a draft." });
    if (info.mergeable === false || info.mergeableState === "dirty") {
      problems.push({ code: "conflicts", message: "Has merge conflicts." });
    }
    if (info.checks === "failure") {
      problems.push({ code: "checks_failing", message: "Its checks are failing." });
    } else if (info.checks === "pending") {
      problems.push({ code: "checks_pending", message: "Its checks are still running." });
    }

    const waitingOn = parent && !isMerged(parent) ? parent : undefined;
    const status: StackStatus = problems.length > 0 ? "blocked" : waitingOn ? "waiting" : "ready";
    return { ...base, status, problems };
  });
}

export type MergeMethod = "merge" | "squash" | "rebase";

export type MergeAction =
  /** Nothing to do, it is merged. */
  | "already_merged"
  | "merge"
  /** Its base is a branch that has been merged away: point it at the real base, then merge. */
  | "retarget_and_merge"
  /** Cannot be merged; see `reason`. */
  | "blocked"
  /** An earlier step is blocked, so this one is not attempted. */
  | "not_reached";

export type MergeStep = {
  key: string;
  repo: string;
  number: number;
  order: number;
  tasks: Array<{ id: string; title: string }>;
  action: MergeAction;
  /** For `retarget_and_merge`: the branch it will be pointed at. */
  retargetTo?: string;
  reason?: string;
};

/**
 * What merging the stack would do, in order. It stops at the first pull request that cannot be
 * merged; everything after it is `not_reached`, because merging past a gap breaks the stack.
 */
export function planMerge(
  stack: StackEntry[],
  baseBranchOf: (repo: string) => string,
  options: { ignoreChecks?: boolean } = {},
): MergeStep[] {
  const steps: MergeStep[] = [];
  let stopped: MergeStep | null = null;
  const isCheck = (p: Problem) => p.code === "checks_failing" || p.code === "checks_pending";

  for (const entry of stack) {
    const step: MergeStep = {
      key: entry.key,
      repo: entry.repo,
      number: entry.number,
      order: entry.order,
      tasks: entry.tasks,
      action: "merge",
    };
    if (entry.status === "merged") {
      steps.push({ ...step, action: "already_merged" });
      continue;
    }
    if (stopped) {
      steps.push({
        ...step,
        action: "not_reached",
        reason: `Not attempted: #${stopped.number} comes first and cannot be merged.`,
      });
      continue;
    }
    // With checks ignored, a pull request held only by its checks is as good as ready.
    const problems = options.ignoreChecks
      ? entry.problems.filter((p) => !isCheck(p))
      : entry.problems;
    const held =
      entry.status === "closed" ||
      entry.status === "unknown" ||
      (entry.status === "blocked" && problems.length > 0);
    if (held) {
      const blocked: MergeStep = {
        ...step,
        action: "blocked",
        reason: problems.map((p) => p.message).join(" ") || "Cannot be merged.",
      };
      steps.push(blocked);
      stopped = blocked;
      continue;
    }
    // ready or waiting: by the time it is its turn every parent before it will have merged, so a
    // base that is still the parent's branch has to be pointed at the real base first.
    const base = baseBranchOf(entry.repo);
    if (entry.info && entry.info.base !== base) {
      step.action = "retarget_and_merge";
      step.retargetTo = base;
    }
    steps.push(step);
  }
  return steps;
}

/** Squash and rebase rewrite the commits, so every PR stacked on top has to be redone. */
export function methodWarning(method: MergeMethod, pending: number): string | null {
  if (method === "merge" || pending < 2) return null;
  return `${method === "squash" ? "Squash" : "Rebase"} merging rewrites each branch's commits, so the pull requests stacked on top of it will conflict. Use a merge commit for a stack.`;
}

/** A pull request of the plan may be merged now only when it is next in line. */
export function nextMergeable(stack: StackEntry[]): StackEntry | null {
  const open = stack.filter((e) => e.status !== "merged");
  const first = open[0];
  return first && first.status === "ready" ? first : null;
}
