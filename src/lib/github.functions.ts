import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AppError } from "@/lib/errors";
import { guard, requireFound } from "@/lib/server-errors";
import { parsePullRequestUrl, parseRepoSlug } from "@/lib/github-url";
import { isValidBranchName } from "@/lib/plan-fields";
import { Octokit } from "octokit";
import { NOT_CONNECTED_MESSAGE } from "@/lib/github-port";
import type { GitHubConnection } from "@/lib/github-token";

/**
 * An Octokit for the person acting: their own GitHub token, else the shared one on the server. The token
 * module is imported here, inside the handlers' reach, because it needs `node:crypto`, which a top-level
 * import would drag into the browser build.
 */
async function octokitFor(userId: string) {
  const { githubFor } = await import("@/lib/github-token");
  const access = await githubFor(userId);
  if (!access.token)
    throw new AppError("github_not_configured", NOT_CONNECTED_MESSAGE, { status: 409 });
  return new Octokit({ auth: access.token });
}

/**
 * Whether you can reach GitHub, for Settings and the repository picker. Never throws: a missing or
 * rejected token is a status, not an error page.
 */
export const getGitHubStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GitHubConnection> => {
    const { githubTokens } = await import("@/lib/github-token");
    return guard("github.status", () => githubTokens().status(context.userId));
  });

/** Check a pasted token with GitHub and keep it, sealed, for this person. */
export const connectGitHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ token: z.string().trim().min(1, "Paste your GitHub token.").max(255) }).parse(input),
  )
  .handler(async ({ context, data }): Promise<GitHubConnection> => {
    const { githubTokens } = await import("@/lib/github-token");
    return guard("github.connect", () => githubTokens().save(context.userId, data.token));
  });

/** Forget this person's own token. The shared server token, if there is one, is untouched. */
export const disconnectGitHub = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GitHubConnection> => {
    const { githubTokens } = await import("@/lib/github-token");
    return guard("github.disconnect", () => githubTokens().forget(context.userId));
  });

export const testGitHubConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) =>
    guard("github.testConnection", async () => {
      const octokit = await octokitFor(context.userId);
      const { data } = await octokit.rest.users.getAuthenticated();

      return {
        login: data.login,
        name: data.name,
        avatarUrl: data.avatar_url,
      };
    }),
  );

export const listGitHubRepos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        page: z.number().int().optional().default(1),
        perPage: z.number().int().optional().default(30),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("github.listRepos", async () => {
      const octokit = await octokitFor(context.userId);
      const response = await octokit.rest.repos.listForAuthenticatedUser({
        sort: "updated",
        per_page: data.perPage,
        page: data.page,
      });

      const repos = response.data.map((repo) => ({
        fullName: repo.full_name,
        defaultBranch: repo.default_branch,
        private: repo.private,
        description: repo.description,
      }));

      return { repos };
    }),
  );

/**
 * Every repository the person can see, up to 500, so the picker can search the
 * whole list instead of only the 50 most recently updated.
 */
export const listAllGitHubRepos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) =>
    guard("github.listAllRepos", async () => {
      const octokit = await octokitFor(context.userId);
      const repos: Array<{
        fullName: string;
        defaultBranch: string;
        private: boolean;
        description: string | null;
      }> = [];
      for (let page = 1; page <= 5; page++) {
        const response = await octokit.rest.repos.listForAuthenticatedUser({
          sort: "updated",
          per_page: 100,
          page,
        });
        for (const repo of response.data) {
          repos.push({
            fullName: repo.full_name,
            defaultBranch: repo.default_branch,
            private: repo.private,
            description: repo.description,
          });
        }
        if (response.data.length < 100) break;
      }
      return { repos, truncated: repos.length >= 500 };
    }),
  );

const repoField = z
  .string()
  .trim()
  .refine((value) => parseRepoSlug(value) !== null, "The repository must be owner/name.");

/** Branches of a repository, default branch first, for the base and working branch pickers. */
export const listGitHubBranches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ repo: repoField }).parse(input))
  .handler(({ data, context }) =>
    guard("github.listBranches", async () => {
      const octokit = await octokitFor(context.userId);
      const { owner, repo } = parseRepoSlug(data.repo)!;
      let defaultBranch: string | null = null;
      try {
        defaultBranch = (await octokit.rest.repos.get({ owner, repo })).data.default_branch;
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 404 || status === 403) {
          throw new AppError(
            "github_repo",
            `Your GitHub token can't see ${data.repo}. Check the name, or connect a token that can read it.`,
            { status: 404 },
          );
        }
        throw error;
      }
      const branches: Array<{ name: string; protected: boolean }> = [];
      for (let page = 1; page <= 3; page++) {
        const response = await octokit.rest.repos.listBranches({
          owner,
          repo,
          per_page: 100,
          page,
        });
        for (const branch of response.data) {
          branches.push({ name: branch.name, protected: branch.protected });
        }
        if (response.data.length < 100) break;
      }
      branches.sort(
        (a, b) =>
          Number(b.name === defaultBranch) - Number(a.name === defaultBranch) ||
          a.name.localeCompare(b.name),
      );
      return { defaultBranch, branches };
    }),
  );

/**
 * Creates `name` on GitHub from the tip of `from`. Safe to repeat: a branch that is
 * already there is reported as such, not as a failure.
 */
export const createGitHubBranch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        repo: repoField,
        name: z.string().trim().refine(isValidBranchName, "That is not a valid branch name."),
        from: z.string().trim().refine(isValidBranchName, "That is not a valid base branch."),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("github.createBranch", async () => {
      const octokit = await octokitFor(context.userId);
      const { owner, repo } = parseRepoSlug(data.repo)!;
      try {
        const base = await octokit.rest.git.getRef({ owner, repo, ref: `heads/${data.from}` });
        await octokit.rest.git.createRef({
          owner,
          repo,
          ref: `refs/heads/${data.name}`,
          sha: base.data.object.sha,
        });
        return { created: true as const };
      } catch (error) {
        const status = (error as { status?: number }).status;
        const message = String((error as { message?: string }).message ?? "");
        if (status === 422 && /already exists/i.test(message)) return { created: false as const };
        if (status === 404) {
          throw new AppError(
            "github_branch",
            `Could not find ${data.from} in ${data.repo}, so ${data.name} was not created.`,
            { status: 404 },
          );
        }
        if (status === 403) {
          throw new AppError(
            "github_forbidden",
            `Your token is not allowed to create branches in ${data.repo}. It needs write access to contents.`,
            { status: 403 },
          );
        }
        throw error;
      }
    }),
  );

export const createPullRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        taskId: z.string().uuid(),
        repo: z.string(),
        head: z.string(),
        base: z.string(),
        title: z.string(),
        body: z.string().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("github.createPullRequest", async () => {
      const { supabase, userId } = context;
      const octokit = await octokitFor(userId);

      const [owner, repo] = data.repo.split("/");
      if (!owner || !repo) {
        throw new Error("Invalid repo format. Expected owner/repo.");
      }

      const { data: pr } = await octokit.rest.pulls.create({
        owner,
        repo,
        title: data.title,
        head: data.head,
        base: data.base,
        body: data.body,
      });

      const { data: taskRow } = await supabase
        .from("plan_tasks")
        .select("plan_id")
        .eq("id", data.taskId)
        .single();
      const task = requireFound(taskRow, "task");

      const { error } = await supabase
        .from("plan_tasks")
        .update({
          pr_number: pr.number,
          pr_url: pr.html_url,
          pr_status: pr.state,
        })
        .eq("id", data.taskId);
      if (error) throw error;

      await supabase.from("plan_events").insert({
        plan_id: task.plan_id,
        actor_id: userId,
        kind: "pr_opened",
      });

      return {
        prNumber: pr.number,
        url: pr.html_url,
      };
    }),
  );

export const getPullRequestStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        repo: z.string(),
        prNumber: z.number().int(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("github.getPullRequestStatus", async () => {
      const octokit = await octokitFor(context.userId);
      const [owner, repo] = data.repo.split("/");
      if (!owner || !repo) {
        throw new Error("Invalid repo format. Expected owner/repo.");
      }

      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: data.prNumber,
      });

      return {
        state: pr.state,
        merged: pr.merged,
        mergedAt: pr.merged_at,
        url: pr.html_url,
      };
    }),
  );

export const listGitHubIssues = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        repo: z.string(),
        state: z.enum(["open", "closed", "all"]).optional().default("open"),
        page: z.number().int().optional().default(1),
        perPage: z.number().int().optional().default(30),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("github.listIssues", async () => {
      const octokit = await octokitFor(context.userId);

      const [owner, repo] = data.repo.split("/");
      if (!owner || !repo) {
        throw new Error("Invalid repo format. Expected owner/repo.");
      }

      const response = await octokit.rest.issues.listForRepo({
        owner,
        repo,
        state: data.state,
        page: data.page,
        per_page: data.perPage,
      });

      const issues = response.data.map((issue) => ({
        id: issue.id,
        number: issue.number,
        title: issue.title,
        state: issue.state,
        createdAt: issue.created_at,
        updatedAt: issue.updated_at,
        user: {
          login: issue.user?.login,
          id: issue.user?.id,
        },
        labels: Array.isArray(issue.labels)
          ? issue.labels
              .filter(
                (
                  label,
                ): label is {
                  id: number;
                  name: string;
                  color: string;
                  description?: string | null;
                } =>
                  typeof label === "object" &&
                  label !== null &&
                  "id" in label &&
                  "name" in label &&
                  "color" in label,
              )
              .map((label) => ({
                id: label.id,
                name: label.name,
                color: label.color,
                description: label.description ?? null,
              }))
          : [],
        assignee:
          typeof issue.assignee === "object" &&
          issue.assignee !== null &&
          "login" in issue.assignee &&
          "id" in issue.assignee
            ? {
                login: issue.assignee.login,
                id: issue.assignee.id,
              }
            : null,
      }));

      return {
        issues,
        totalCount: response.headers["x-total-ratelimit-remaining"]
          ? parseInt(String(response.headers["x-total-ratelimit-remaining"]), 10)
          : undefined,
      };
    }),
  );

export const setProjectRepository = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        projectId: z.string().uuid(),
        githubRepo: z.string().max(200).nullable(),
        githubDefaultBranch: z.string().max(200).nullable().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("projects.setRepository", async () => {
      const repo = data.githubRepo?.trim() || null;
      if (repo && !parseRepoSlug(repo)) {
        throw new AppError("github_repo", "Use owner/name, for example acme/app.");
      }

      const { data: project } = await context.supabase
        .from("projects")
        .select("id")
        .eq("id", data.projectId)
        .maybeSingle();
      requireFound(project, "project");

      const { error } = await context.supabase
        .from("projects")
        .update({
          github_repo: repo,
          ...(data.githubDefaultBranch !== undefined && {
            github_default_branch: data.githubDefaultBranch?.trim() || null,
          }),
        })
        .eq("id", data.projectId);
      if (error) throw error;
      return { ok: true, githubRepo: repo };
    }),
  );

export const refreshTaskPullRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ taskId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("github.refreshPullRequest", async () => {
      const { supabase } = context;
      const { data: taskRow } = await supabase
        .from("plan_tasks")
        .select("id, pr_url, pr_number")
        .eq("id", data.taskId)
        .maybeSingle();
      const task = requireFound(taskRow, "task");
      if (!task.pr_url) {
        throw new AppError("github_pr", "This task has no pull request yet.");
      }
      const parsed = parsePullRequestUrl(task.pr_url);
      if (!parsed) {
        throw new AppError("github_pr", "That pull request link is not a GitHub URL.");
      }

      const octokit = await octokitFor(context.userId);
      const { data: pr } = await octokit.rest.pulls.get({
        owner: parsed.owner,
        repo: parsed.repo,
        pull_number: parsed.number,
      });
      const prStatus = pr.merged ? "merged" : pr.state;

      const { error } = await supabase
        .from("plan_tasks")
        .update({
          pr_number: pr.number,
          pr_url: pr.html_url,
          pr_status: prStatus,
        })
        .eq("id", task.id);
      if (error) throw error;

      return { state: prStatus, merged: pr.merged, url: pr.html_url, number: pr.number };
    }),
  );
