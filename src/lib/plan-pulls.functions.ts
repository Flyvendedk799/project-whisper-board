import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AppError } from "@/lib/errors";
import { guard, requireFound } from "@/lib/server-errors";
import { loadPlanPulls, mergePlanPulls } from "@/lib/plan-pulls";
import type { Database } from "@/integrations/supabase/types";

/** Merging changes a repository, so it is for workspace admins, the same people who can edit a plan. */
async function isWorkspaceAdmin(
  supabase: SupabaseClient<Database>,
  userId: string,
  planId: string,
): Promise<boolean> {
  const { data: plan } = await supabase
    .from("plans")
    .select("workspace_id")
    .eq("id", planId)
    .maybeSingle();
  const found = requireFound(plan, "plan");
  const { data: member } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", found.workspace_id)
    .eq("user_id", userId)
    .maybeSingle();
  return member?.role === "admin";
}

/**
 * The GitHub access for the person acting: their own token, else the shared one on the server.
 * Imported here, inside the handlers' reach, because the token module needs `node:crypto`, which a
 * top-level import would drag into the browser build.
 */
async function githubAccess(userId: string) {
  const { githubFor } = await import("@/lib/github-token");
  return githubFor(userId);
}

/** The plan's pull requests in merge order, read from GitHub just now. */
export const getPlanPullRequests = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("plans.pullRequests", async () => {
      const { supabase, userId } = context;
      const access = await githubAccess(userId);
      const pulls = await loadPlanPulls({
        db: supabase,
        github: access.port,
        source: access.source,
        planId: data.planId,
      });
      const admin = await isWorkspaceAdmin(supabase, userId, data.planId);
      return { ...pulls, canMerge: admin && pulls.tokenCanMerge, isAdmin: admin };
    }),
  );

/**
 * Merge the plan's pull requests in order, or just describe what that would do (`dryRun`). `max: 1`
 * merges the next one only, which is how the screen shows progress; `only` merges one named
 * pull request, which has to be the next in line.
 */
export const mergePlanPullRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        planId: z.string().uuid(),
        method: z.enum(["merge", "squash", "rebase"]).optional(),
        dryRun: z.boolean().optional(),
        max: z.number().int().min(1).max(50).optional(),
        only: z.string().max(300).optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("plans.mergePullRequests", async () => {
      const { supabase, userId } = context;
      if (!(await isWorkspaceAdmin(supabase, userId, data.planId))) {
        throw new AppError("forbidden", "Only workspace admins can merge pull requests.", {
          status: 403,
        });
      }
      const { planId, ...options } = data;
      const access = await githubAccess(userId);
      return mergePlanPulls(
        { db: supabase, github: access.port, source: access.source, planId, actorId: userId },
        options,
      );
    }),
  );
