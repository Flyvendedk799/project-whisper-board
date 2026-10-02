import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";
import { describeGitHubError, type GitHubPort } from "@/lib/github-port";
import { parsePullRequestUrl } from "@/lib/plan-refs";
import {
  buildStack,
  methodWarning,
  planMerge,
  pullKey,
  type MergeMethod,
  type MergeStep,
  type PullInfo,
  type PullLookup,
  type StackEntry,
  type StackTask,
} from "@/lib/pr-stack";
import type { Database } from "@/integrations/supabase/types";

type Db = SupabaseClient<Database>;

export type PlanPullsDeps = {
  db: Db;
  /** Null when this deployment has no GitHub token. */
  github: GitHubPort | null;
  planId: string;
  /** When set, the plan must belong to this workspace (the API-key path). */
  workspaceId?: string;
  /** Who is acting, for the activity feed. Null for an API key. */
  actorId?: string | null;
  sleep?: (ms: number) => Promise<void>;
};

export type PlanPulls = {
  planId: string;
  repo: string | null;
  /** Whether this deployment can reach GitHub at all. */
  configured: boolean;
  /** Whether the GitHub token may merge into the plan's repository. */
  tokenCanMerge: boolean;
  baseBranches: Record<string, string>;
  stack: StackEntry[];
  /**
   * True when a branch could not be read, so the order is a guess (by pull request number) rather
   * than worked out from the branches.
   */
  orderIsGuess: boolean;
  fetchedAt: string;
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function loadPlan(deps: PlanPullsDeps) {
  let query = deps.db
    .from("plans")
    .select("id, workspace_id, github_repo, github_base")
    .eq("id", deps.planId);
  if (deps.workspaceId) query = query.eq("workspace_id", deps.workspaceId);
  const { data } = await query.maybeSingle();
  if (!data) throw new AppError("not_found", "Plan not found.", { status: 404 });
  return data;
}

/** Tasks of the plan that point at a GitHub pull request, with where they sit in the plan. */
async function loadTasks(db: Db, planId: string): Promise<StackTask[]> {
  const { data, error } = await db
    .from("plan_tasks")
    .select("id, title, position, pr_url, section:plan_sections(position)")
    .eq("plan_id", planId)
    .not("pr_url", "is", null);
  if (error) throw error;
  const tasks: StackTask[] = [];
  for (const row of data ?? []) {
    const parsed = parsePullRequestUrl(row.pr_url);
    if (!parsed) continue;
    const section = Array.isArray(row.section) ? row.section[0] : row.section;
    tasks.push({
      id: row.id,
      title: row.title,
      repo: parsed.repo,
      prNumber: parsed.number,
      prUrl: row.pr_url ?? "",
      sectionPosition: section?.position ?? 0,
      position: row.position ?? 0,
    });
  }
  return tasks;
}

/** A pull request as GitHub has it now, checks included. */
async function readPull(github: GitHubPort, repo: string, number: number): Promise<PullInfo> {
  const info = await github.getPull(repo, number);
  if (info.state === "open" && !info.merged) {
    info.checks = await github.checksFor(repo, info.headSha);
  }
  return info;
}

/** GitHub works out mergeability in the background; ask again until it has, within reason. */
async function readSettled(
  github: GitHubPort,
  repo: string,
  number: number,
  sleep: (ms: number) => Promise<void>,
): Promise<PullInfo> {
  let info = await readPull(github, repo, number);
  for (let tries = 0; tries < 8 && info.state === "open" && info.mergeable === null; tries++) {
    await sleep(1500);
    info = await readPull(github, repo, number);
  }
  return info;
}

/** The plan's pull requests, in the order they have to be merged, as GitHub has them right now. */
export async function loadPlanPulls(deps: PlanPullsDeps): Promise<PlanPulls> {
  const plan = await loadPlan(deps);
  const tasks = await loadTasks(deps.db, deps.planId);
  const repos = [...new Set(tasks.map((t) => t.repo))];

  const pulls = new Map<string, PullLookup>();
  const baseBranches: Record<string, string> = {};
  let tokenCanMerge = false;

  if (!deps.github) {
    for (const task of tasks) {
      pulls.set(pullKey(task.repo, task.prNumber), {
        error: "GitHub is not connected on this deployment, so its state cannot be read.",
      });
    }
  } else {
    const github = deps.github;
    await Promise.all(
      repos.map(async (repo) => {
        try {
          const info = await github.repoInfo(repo);
          baseBranches[repo] =
            repo === plan.github_repo && plan.github_base ? plan.github_base : info.defaultBranch;
          if (repo === plan.github_repo || !plan.github_repo) {
            tokenCanMerge = tokenCanMerge || info.canPush;
          }
        } catch {
          baseBranches[repo] =
            repo === plan.github_repo && plan.github_base ? plan.github_base : "main";
        }
      }),
    );
    const wanted = new Map(tasks.map((t) => [pullKey(t.repo, t.prNumber), t]));
    await Promise.all(
      [...wanted.entries()].map(async ([key, task]) => {
        try {
          pulls.set(key, await readPull(github, task.repo, task.prNumber));
        } catch (error) {
          pulls.set(key, { error: describeGitHubError(error, `reading #${task.prNumber}`) });
        }
      }),
    );
  }

  const baseBranchOf = (repo: string) => baseBranches[repo] ?? plan.github_base ?? "main";
  const stack = buildStack({ tasks, pulls, baseBranchOf });
  return {
    planId: deps.planId,
    repo: plan.github_repo,
    configured: Boolean(deps.github),
    tokenCanMerge,
    baseBranches,
    stack,
    orderIsGuess: stack.some((entry) => !entry.info),
    fetchedAt: new Date().toISOString(),
  };
}

export type MergeOutcome = "planned" | "merged" | "skipped" | "failed" | "not_reached" | "pending";

export type MergeResultStep = MergeStep & {
  outcome: MergeOutcome;
  message?: string;
  sha?: string | null;
};

export type MergeResult = {
  dryRun: boolean;
  method: MergeMethod;
  warning: string | null;
  steps: MergeResultStep[];
  /** The pull request that stopped the run, if one did. */
  stoppedAt: number | null;
  /** How many pull requests are still to be merged after this call. */
  remaining: number;
};

export type MergeOptions = {
  method?: MergeMethod;
  dryRun?: boolean;
  /** Merge at most this many pull requests in this call (the UI uses 1 to show progress). */
  max?: number;
  /** Merge just this one (`owner/name#123`); it has to be the next in line. */
  only?: string;
  /** Do not hold a merge back for failing or running checks. */
  ignoreChecks?: boolean;
  /** Stop starting new merges after this long, so a call stays inside a request's time. */
  budgetMs?: number;
};

/**
 * Merge the plan's pull requests in order. Resumable and safe to repeat: it reads GitHub afresh, skips
 * what is merged, and stops at the first one that cannot be merged. A pull request still based on a
 * branch that has been merged away is pointed at the real base first (GitHub only does that by itself
 * when the branch is deleted), so each lands as just its own commits.
 */
export async function mergePlanPulls(
  deps: PlanPullsDeps,
  options: MergeOptions = {},
): Promise<MergeResult> {
  const method = options.method ?? "merge";
  const loaded = await loadPlanPulls(deps);
  if (!deps.github || !loaded.configured) {
    throw new AppError(
      "github_not_configured",
      "GitHub is not connected on this deployment, so nothing can be merged from here.",
    );
  }
  const github = deps.github;
  const sleep = deps.sleep ?? wait;
  const baseBranchOf = (repo: string) => loaded.baseBranches[repo] ?? "main";

  const planned = planMerge(loaded.stack, baseBranchOf, { ignoreChecks: options.ignoreChecks });
  const pending = planned.filter((s) => s.action !== "already_merged");
  const warning = methodWarning(method, pending.length);

  if (options.dryRun) {
    return {
      dryRun: true,
      method,
      warning,
      steps: planned.map((s) => ({
        ...s,
        outcome: s.action === "already_merged" ? "skipped" : "planned",
        message: s.reason,
      })),
      stoppedAt: planned.find((s) => s.action === "blocked")?.number ?? null,
      remaining: pending.length,
    };
  }

  if (!loaded.tokenCanMerge) {
    throw new AppError(
      "github_forbidden",
      "The GitHub token on this deployment cannot write to the repository, so it cannot merge. Use Open on GitHub.",
      { status: 403 },
    );
  }
  if (options.only && pending[0]?.key !== options.only) {
    const first = pending[0];
    throw new AppError(
      "validation",
      first
        ? `Merge #${first.number} first: pull requests go in stack order.`
        : "Nothing is left to merge.",
    );
  }

  const context: StepContext = {
    deps,
    github,
    sleep,
    method,
    ignoreChecks: Boolean(options.ignoreChecks),
    baseBranchOf,
    byKey: new Map(loaded.stack.map((e) => [e.key, e])),
    mergedNow: new Set(loaded.stack.filter((e) => e.status === "merged").map((e) => e.key)),
  };
  const max = options.only ? 1 : (options.max ?? Number.POSITIVE_INFINITY);
  const started = Date.now();
  const budget = options.budgetMs ?? 45_000;
  const results: MergeResultStep[] = [];
  let attempts = 0;
  let stoppedAt: number | null = null;

  for (const step of planned) {
    if (step.action === "already_merged") {
      results.push({ ...step, outcome: "skipped" });
      continue;
    }
    if (stoppedAt !== null) {
      results.push({
        ...step,
        outcome: "not_reached",
        message: `Not attempted: #${stoppedAt} stopped the run.`,
      });
      continue;
    }
    if (attempts >= max || (attempts > 0 && Date.now() - started > budget)) {
      results.push({ ...step, outcome: "pending" });
      continue;
    }
    if (step.action === "blocked" || step.action === "not_reached") {
      stoppedAt = step.number;
      results.push({ ...step, outcome: "failed", message: step.reason });
      continue;
    }

    attempts += 1;
    const done = await executeStep(context, step);
    if (done.outcome === "failed") stoppedAt = step.number;
    results.push({ ...step, ...done });
  }

  const remaining = results.filter((r) => r.outcome !== "merged" && r.outcome !== "skipped").length;
  return { dryRun: false, method, warning, steps: results, stoppedAt, remaining };
}

type StepContext = {
  deps: PlanPullsDeps;
  github: GitHubPort;
  sleep: (ms: number) => Promise<void>;
  method: MergeMethod;
  ignoreChecks: boolean;
  baseBranchOf: (repo: string) => string;
  byKey: Map<string, StackEntry>;
  /** Merged before this call or by it; a stacked PR may be retargeted once its parent is in here. */
  mergedNow: Set<string>;
};

type StepDone = { outcome: "merged" | "skipped" | "failed"; message?: string; sha?: string | null };

/** One pull request, from a fresh read to merged. Never throws; a failure is the result. */
async function executeStep(ctx: StepContext, step: MergeStep): Promise<StepDone> {
  const { github, deps } = ctx;
  const entry = ctx.byKey.get(step.key);
  const fail = (message: string): StepDone => ({ outcome: "failed", message });

  try {
    let info = await readSettled(github, step.repo, step.number, ctx.sleep);
    if (info.merged) {
      ctx.mergedNow.add(step.key);
      await recordMerged(deps, entry, info.url, null);
      return { outcome: "skipped", message: "Already merged on GitHub." };
    }
    if (info.state === "closed") return fail("It was closed without being merged.");
    if (info.draft) return fail("It is still a draft.");

    const base = ctx.baseBranchOf(step.repo);
    if (info.base !== base) {
      const parentKey = entry?.parent ?? null;
      if (!parentKey) {
        return fail(
          `It targets ${info.base}, which is neither ${base} nor another pull request in this plan. Not changing it.`,
        );
      }
      if (!ctx.mergedNow.has(parentKey)) {
        const parent = ctx.byKey.get(parentKey);
        const live = parent ? await readPull(github, parent.repo, parent.number) : null;
        if (!live?.merged)
          return fail(`Stacked on #${parent?.number ?? "?"}, which is not merged yet.`);
        ctx.mergedNow.add(parentKey);
      }
      await github.setBase(step.repo, step.number, base);
      info = await readSettled(github, step.repo, step.number, ctx.sleep);
    }

    if (info.mergeable === false || info.mergeableState === "dirty") {
      return fail(`It has merge conflicts with ${base}. Resolve them on GitHub.`);
    }
    if (!ctx.ignoreChecks && info.checks === "failure") return fail("Its checks are failing.");
    if (!ctx.ignoreChecks && info.checks === "pending") {
      return fail("Its checks are still running. Try again when they finish.");
    }

    const merged = await github.merge(step.repo, step.number, ctx.method);
    if (!merged.merged) return fail(merged.message || "GitHub did not merge it.");
    ctx.mergedNow.add(step.key);
    await recordMerged(deps, entry, info.url, merged.sha);
    return {
      outcome: "merged",
      sha: merged.sha,
      message:
        step.action === "retarget_and_merge" ? `Retargeted to ${base}, then merged.` : undefined,
    };
  } catch (error) {
    return fail(describeGitHubError(error, `merging #${step.number}`));
  }
}

/** After a merge: say so on the tasks and in the plan's activity feed. */
async function recordMerged(
  deps: PlanPullsDeps,
  entry: StackEntry | undefined,
  url: string,
  sha: string | null,
) {
  if (!entry) return;
  const ids = entry.tasks.map((t) => t.id);
  const { error } = await deps.db.from("plan_tasks").update({ pr_status: "merged" }).in("id", ids);
  if (error) console.error("[plan-pulls] could not mark tasks merged:", error.message);
  const { error: eventError } = await deps.db.from("plan_events").insert({
    plan_id: deps.planId,
    task_id: ids[0] ?? null,
    actor_id: deps.actorId ?? null,
    kind: "pr_merged",
    new_value: url,
    metadata: { pr: entry.number, repo: entry.repo, sha },
  });
  if (eventError) console.error("[plan-pulls] could not log the merge:", eventError.message);
}
