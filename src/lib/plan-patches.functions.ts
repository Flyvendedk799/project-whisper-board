import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Octokit } from "octokit";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AppError } from "@/lib/errors";
import { guard, requireFound } from "@/lib/server-errors";
import { parseRepoSlug } from "@/lib/github-url";
import { isValidBranchName } from "@/lib/plan-fields";
import { NOT_CONNECTED_MESSAGE } from "@/lib/github-port";
import { patchSetProblem } from "@/lib/plan-patch-check";

async function access(
  context: { supabase: SupabaseClient<Database>; userId: string },
  planId: string,
) {
  // This helper is intentionally resolved inside server actions; the token never reaches the browser.
  const { supabase, userId } = context;
  const { data: plan, error } = await supabase
    .from("plans")
    .select("id, workspace_id, github_repo, github_base")
    .eq("id", planId)
    .maybeSingle();
  if (error) throw error;
  const found = requireFound(plan, "plan");
  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", found.workspace_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (member?.role !== "admin")
    throw new AppError("forbidden", "Only workspace admins can deliver patches.", { status: 403 });
  const repo = found.github_repo && parseRepoSlug(found.github_repo);
  if (!repo) throw new AppError("github_repo", "Connect a repository in plan settings first.");
  const { githubFor } = await import("@/lib/github-token");
  const github = await githubFor(userId);
  if (!github.token)
    throw new AppError("github_not_configured", NOT_CONNECTED_MESSAGE, { status: 409 });
  return { plan: found, repo, octokit: new Octokit({ auth: github.token }) };
}

export const listPlanPatches = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("patches.list", async () => {
      const { data: rows, error } = await context.supabase
        .from("plan_patches")
        .select("*")
        .eq("plan_id", data.planId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return rows ?? [];
    }),
  );

export const registerPlanPatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        planId: z.string().uuid(),
        branch: z.string().trim().refine(isValidBranchName),
        commitSha: z.string().regex(/^[a-f\d]{40}$/i),
        worktreeLabel: z.string().trim().max(120).default(""),
        bundleName: z.string().trim().max(120).default(""),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("patches.register", async () => {
      const { repo, octokit } = await access(context, data.planId);
      const [commit, branch] = await Promise.all([
        octokit.rest.repos.getCommit({ ...repo, ref: data.commitSha }),
        octokit.rest.git.getRef({ ...repo, ref: `heads/${data.branch}` }),
      ]);
      const relation = await octokit.rest.repos.compareCommits({
        ...repo,
        base: data.commitSha,
        head: branch.data.object.sha,
      });
      if (!(["identical", "ahead"] as string[]).includes(relation.data.status)) {
        throw new AppError("patch_branch", "The commit is not on that branch.");
      }
      const { data: existing } = await context.supabase
        .from("plan_patches")
        .select("id")
        .eq("plan_id", data.planId)
        .eq("commit_sha", data.commitSha.toLowerCase())
        .maybeSingle();
      if (existing) return { id: existing.id, created: false };
      const { data: patch, error } = await context.supabase
        .from("plan_patches")
        .insert({
          plan_id: data.planId,
          branch: data.branch,
          commit_sha: data.commitSha.toLowerCase(),
          worktree_label: data.worktreeLabel,
          bundle_name: data.bundleName,
          summary: commit.data.commit.message.split("\n")[0].slice(0, 300),
          file_count: commit.data.files?.length ?? 0,
          additions: commit.data.stats?.additions ?? 0,
          deletions: commit.data.stats?.deletions ?? 0,
          created_by: context.userId,
        })
        .select("id")
        .single();
      if (error) throw error;
      return { id: patch.id, created: true };
    }),
  );

export const deliverPlanPatches = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        planId: z.string().uuid(),
        patchIds: z.array(z.string().uuid()).min(1).max(50),
        strategy: z.enum(["direct", "pr"]),
        title: z.string().trim().max(200).optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("patches.deliver", async () => {
      const { plan, repo, octokit } = await access(context, data.planId);
      const ids = [...new Set(data.patchIds)];
      const { data: patches, error } = await context.supabase
        .from("plan_patches")
        .select("id, branch, commit_sha, status, summary, file_count, additions, deletions")
        .eq("plan_id", data.planId)
        .in("id", ids);
      if (error) throw error;
      if (
        !patches ||
        patches.length !== ids.length ||
        patches.some((patch) => patch.status !== "registered")
      ) {
        throw new AppError("patch_selection", "Select registered patches from this plan only.");
      }
      const branch = patches[0].branch;
      if (patches.some((patch) => patch.branch !== branch)) {
        throw new AppError("patch_branch", "A patch bundle must come from one source branch.");
      }
      if (
        data.strategy === "direct" &&
        (patches.reduce((total, patch) => total + patch.file_count, 0) > 5 ||
          patches.reduce((total, patch) => total + patch.additions + patch.deletions, 0) > 200)
      ) {
        throw new AppError(
          "patch_size",
          "This bundle is too large for direct delivery. Open a pull request for review.",
        );
      }
      const base = plan.github_base || (await octokit.rest.repos.get(repo)).data.default_branch;
      if (branch === base)
        throw new AppError("patch_branch", "Choose a source branch separate from the base.");
      const [baseRef, headRef] = await Promise.all([
        octokit.rest.git.getRef({ ...repo, ref: `heads/${base}` }),
        octokit.rest.git.getRef({ ...repo, ref: `heads/${branch}` }),
      ]);
      const compare = await octokit.rest.repos.compareCommits({
        ...repo,
        base: baseRef.data.object.sha,
        head: headRef.data.object.sha,
        per_page: 250,
      });
      if (compare.data.total_commits > 250) {
        throw new AppError(
          "patch_size",
          "The branch has too many commits to verify as one bundle. Use a smaller branch.",
        );
      }
      const problem = patchSetProblem(
        patches.map((patch) => patch.commit_sha),
        compare.data.commits.map((commit) => commit.sha),
        compare.data.status,
        data.strategy === "direct",
      );
      if (problem) throw new AppError("patch_compare", problem);
      let prUrl: string | null = null;
      if (data.strategy === "direct") {
        await octokit.rest.git.updateRef({
          ...repo,
          ref: `heads/${base}`,
          sha: headRef.data.object.sha,
          force: false,
        });
      } else {
        const pull = await octokit.rest.pulls.create({
          ...repo,
          head: branch,
          base,
          title: data.title || `Patches from ${branch}`,
          body: patches
            .map((patch) => `- ${patch.summary} (${patch.commit_sha.slice(0, 7)})`)
            .join("\n"),
        });
        prUrl = pull.data.html_url;
      }
      const { error: updateError } = await context.supabase
        .from("plan_patches")
        .update({
          status: data.strategy === "direct" ? "applied" : "pr_open",
          pr_url: prUrl,
          applied_at: data.strategy === "direct" ? new Date().toISOString() : null,
        })
        .in("id", ids);
      if (updateError) throw updateError;
      return { count: ids.length, strategy: data.strategy, prUrl };
    }),
  );
