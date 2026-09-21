import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guard, requireFound } from "@/lib/server-errors";
import { Octokit } from "octokit";

function getOctokit() {
  const pat = process.env.GITHUB_PAT;
  if (!pat) {
    throw new Error("GITHUB_PAT environment variable is not set.");
  }
  return new Octokit({ auth: pat });
}

export const testGitHubConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(() =>
    guard("github.testConnection", async () => {
      const octokit = getOctokit();
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
  .handler(({ data }) =>
    guard("github.listRepos", async () => {
      const octokit = getOctokit();
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
      const octokit = getOctokit();

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
  .handler(({ data }) =>
    guard("github.getPullRequestStatus", async () => {
      const octokit = getOctokit();
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
