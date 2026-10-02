import { Octokit } from "octokit";
import { AppError } from "@/lib/errors";
import type { ChecksState, MergeMethod, PullInfo } from "@/lib/pr-stack";

/**
 * The few GitHub calls merging a stack needs, behind an interface so the merge logic can be tested
 * without the network and so the token never leaves this file.
 */
export interface GitHubPort {
  repoInfo(repo: string): Promise<{ defaultBranch: string; canPush: boolean }>;
  getPull(repo: string, number: number): Promise<PullInfo>;
  checksFor(repo: string, sha: string): Promise<ChecksState>;
  setBase(repo: string, number: number, base: string): Promise<void>;
  merge(
    repo: string,
    number: number,
    method: MergeMethod,
  ): Promise<{ merged: boolean; sha: string | null; message: string }>;
}

function split(repo: string): { owner: string; repo: string } {
  const [owner, name] = repo.split("/");
  if (!owner || !name) throw new AppError("github_repo", "The repository must be owner/name.");
  return { owner, repo: name };
}

/** Whether this deployment has a GitHub token at all. The token itself is never read elsewhere. */
export function githubConfigured(): boolean {
  return Boolean(process.env.GITHUB_PAT);
}

const FAILED_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
]);

export function octokitPort(): GitHubPort {
  const pat = process.env.GITHUB_PAT;
  if (!pat) {
    throw new AppError(
      "github_not_configured",
      "GitHub is not connected: this deployment has no GITHUB_PAT.",
    );
  }
  const octokit = new Octokit({ auth: pat });

  return {
    async repoInfo(repo) {
      const { data } = await octokit.rest.repos.get(split(repo));
      return { defaultBranch: data.default_branch, canPush: Boolean(data.permissions?.push) };
    },

    async getPull(repo, number) {
      const { data } = await octokit.rest.pulls.get({ ...split(repo), pull_number: number });
      return {
        number: data.number,
        url: data.html_url,
        title: data.title,
        state: data.state === "closed" ? "closed" : "open",
        merged: Boolean(data.merged),
        draft: Boolean(data.draft),
        base: data.base.ref,
        head: data.head.ref,
        headSha: data.head.sha,
        mergeable: data.mergeable ?? null,
        mergeableState: data.mergeable_state ?? null,
        // Filled by the caller from checksFor().
        checks: "none",
      };
    },

    async checksFor(repo, sha) {
      const target = { ...split(repo), ref: sha };
      // A token that cannot read checks or statuses should not make the pull request unreadable.
      const [runs, combined] = await Promise.all([
        octokit.rest.checks.listForRef({ ...target, per_page: 100 }).catch(() => null),
        octokit.rest.repos.getCombinedStatusForRef(target).catch(() => null),
      ]);
      const runList = runs?.data.check_runs ?? [];
      const hasStatuses = (combined?.data.total_count ?? 0) > 0;
      if (runList.length === 0 && !hasStatuses) return "none";
      if (
        runList.some((r) => r.conclusion && FAILED_CONCLUSIONS.has(r.conclusion)) ||
        (hasStatuses && ["failure", "error"].includes(combined?.data.state ?? ""))
      ) {
        return "failure";
      }
      if (
        runList.some((r) => r.status !== "completed") ||
        (hasStatuses && combined?.data.state === "pending")
      ) {
        return "pending";
      }
      return "success";
    },

    async setBase(repo, number, base) {
      await octokit.rest.pulls.update({ ...split(repo), pull_number: number, base });
    },

    async merge(repo, number, method) {
      const { data } = await octokit.rest.pulls.merge({
        ...split(repo),
        pull_number: number,
        merge_method: method,
      });
      return { merged: data.merged, sha: data.sha ?? null, message: data.message };
    },
  };
}

/**
 * Turn a GitHub failure into a sentence a person can act on. Tokens and response bodies are never
 * included; only what GitHub's own message says about the pull request.
 */
export function describeGitHubError(error: unknown, doing: string): string {
  const status = (error as { status?: number })?.status;
  const message = String((error as { message?: string })?.message ?? "").split("\n")[0];
  if (status === 401) return `GitHub rejected the token while ${doing}. Check GITHUB_PAT.`;
  if (status === 403 || status === 404) {
    return `The GitHub token is not allowed to ${doing} (it needs write access to the repository's pull requests and contents). Use Open on GitHub instead. GitHub said: ${message}`;
  }
  if (status === 405) return `GitHub would not merge it: ${message}`;
  if (status === 409) return `The branch changed while merging; try again. ${message}`;
  if (status === 422) return `GitHub refused: ${message}`;
  return `GitHub failed while ${doing}${message ? `: ${message}` : "."}`;
}
