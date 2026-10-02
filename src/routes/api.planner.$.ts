import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { verifyApiKey } from "@/lib/api-auth";
import { allowsPlanner } from "@/lib/api-scopes";
import {
  decoratePlanForAgents,
  sharedAttachments,
  withSharedAttachments,
} from "@/features/planner/agent-media";
import { MAX_STEP_DEPTH, STEP_TEXT_MAX } from "@/lib/plan-markdown";
import { applyPlanMarkdown } from "@/lib/plan-import";
import { parsePullRequestUrl } from "@/lib/plan-refs";
import { parseRepoSlug } from "@/lib/github-url";
import { describeGitHubError, NOT_CONNECTED_MESSAGE } from "@/lib/github-port";
import { loadPlanPulls, mergePlanPulls } from "@/lib/plan-pulls";
import { AppError } from "@/lib/errors";
import { Constants, type Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;
type EventKind = Database["public"]["Enums"]["plan_event_kind"];
type PlanStatus = Database["public"]["Enums"]["plan_status"];

const PLAN_STATUSES: readonly string[] = Constants.public.Enums.plan_status;

/**
 * `?status=` on the plan list. Agents only see active plans unless they ask:
 * a plan that is still a draft is invisible by default, which made a freshly
 * imported plan look like it had never arrived.
 */
function statusesFromQuery(raw: string | null): PlanStatus[] | "all" {
  if (!raw) return ["active"];
  if (raw === "all") return "all";
  const wanted = raw.split(",").map((value) => value.trim());
  const unknown = wanted.filter((value) => !PLAN_STATUSES.includes(value));
  if (unknown.length > 0) {
    throw new AppError(
      "validation",
      `Unknown plan status: ${unknown.join(", ")}. Use ${PLAN_STATUSES.join(", ")} or all.`,
    );
  }
  return wanted as PlanStatus[];
}

// Helper to create Supabase service role client
const getAdminClient = () => {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
};

// Catch-all route for /api/planner/*
export const Route = createFileRoute("/api/planner/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        return handleRequest("GET", request, params._splat);
      },
      POST: async ({ request, params }) => {
        return handleRequest("POST", request, params._splat);
      },
    },
  },
});

/** A task, but only when its plan belongs to the key's workspace. */
async function taskInWorkspace(admin: Admin, taskId: string, workspaceId: string) {
  const { data } = await admin
    .from("plan_tasks")
    .select("id, plan_id, title, status, assigned_agent_id, plans!inner(workspace_id)")
    .eq("id", taskId)
    .eq("plans.workspace_id", workspaceId)
    .maybeSingle();
  return data;
}

/** Puts what an agent did in the plan's activity feed. */
async function logAgentEvent(
  admin: Admin,
  task: { id: string; plan_id: string; assigned_agent_id?: string | null },
  kind: EventKind,
  options: { agentId?: string | null; detail?: string | null } = {},
) {
  const { error } = await admin.from("plan_events").insert({
    plan_id: task.plan_id,
    task_id: task.id,
    agent_id: options.agentId ?? task.assigned_agent_id ?? null,
    kind,
    new_value: options.detail ?? null,
  });
  if (error) console.error("Planner API event:", error.message);
}

const notFound = () =>
  new Response(JSON.stringify({ error: "Task not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });

/** The JSON body of a request, which must be an object. */
async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("validation", "Send a JSON object as the request body.");
  }
  return body as Record<string, unknown>;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalStatus(value: unknown): PlanStatus | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !PLAN_STATUSES.includes(value)) {
    throw new AppError("validation", `Status is one of ${PLAN_STATUSES.join(", ")}.`);
  }
  return value as PlanStatus;
}

async function handleRequest(method: "GET" | "POST", request: Request, splat?: string) {
  try {
    const authHeader = request.headers.get("authorization");
    const auth = await verifyApiKey(authHeader);

    if (!auth) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!allowsPlanner(auth.scopes)) {
      return new Response(JSON.stringify({ error: "Forbidden: requires planner scope" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    const path = splat || "";
    const admin = getAdminClient();
    const { workspaceId } = auth;

    // GitHub calls made with an API key act as the person who made the key: their own token, else the
    // shared one on the server. Imported here because the token module needs node:crypto.
    const githubAccess = async () => (await import("@/lib/github-token")).githubFor(auth.userId);

    if (method === "GET") {
      if (path === "plans" || path === "plans/") {
        const statuses = statusesFromQuery(new URL(request.url).searchParams.get("status"));
        let query = admin.from("plans").select("*").eq("workspace_id", workspaceId);
        if (statuses !== "all") query = query.in("status", statuses);
        const { data: plans, error } = await query.order("created_at", { ascending: false });
        if (error) throw error;
        return Response.json(plans);
      }

      const planMatch = path.match(/^plans\/([^/]+)$/);
      if (planMatch) {
        const { data: plan, error } = await admin
          .from("plans")
          .select("*, plan_sections(*, plan_tasks(*, steps:plan_task_steps(*)))")
          .eq("workspace_id", workspaceId)
          .eq("id", planMatch[1])
          .single();
        if (error) throw error;
        // Files come from their own query so a hidden one is never read.
        return Response.json(await decoratePlanForAgents(admin, plan));
      }

      const availableTasksMatch = path.match(/^plans\/([^/]+)\/available-tasks$/);
      if (availableTasksMatch) {
        // Find tasks in this plan that are 'available'
        // And check dependencies.
        const { data: plan, error: planError } = await admin
          .from("plans")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("id", availableTasksMatch[1])
          .single();

        if (planError || !plan) throw new Error("Plan not found");

        const { data: tasks, error: tasksError } = await admin
          .from("plan_tasks")
          .select("*, steps:plan_task_steps(*)")
          .eq("plan_id", availableTasksMatch[1])
          .eq("status", "available");

        if (tasksError) throw tasksError;

        // Also get all task statuses to check dependencies
        const { data: allTasks, error: allTasksError } = await admin
          .from("plan_tasks")
          .select("id, status")
          .eq("plan_id", availableTasksMatch[1]);

        if (allTasksError) throw allTasksError;

        const taskStatusMap = new Map(allTasks.map((t) => [t.id, t.status]));

        const availableTasks = tasks.filter((t) => {
          if (!t.depends_on || t.depends_on.length === 0) return true;
          return t.depends_on.every((depId: string) => taskStatusMap.get(depId) === "done");
        });

        return Response.json(
          await withSharedAttachments(admin, availableTasksMatch[1], availableTasks),
        );
      }

      // The plan's pull requests in merge order, read from GitHub now.
      const pullsMatch = path.match(/^plans\/([^/]+)\/pull-requests$/);
      if (pullsMatch) {
        const access = await githubAccess();
        return Response.json(
          await loadPlanPulls({
            db: admin,
            github: access.port,
            source: access.source,
            planId: pullsMatch[1],
            workspaceId,
          }),
        );
      }

      // Whether GitHub is connected for the person this key acts as: never the token, only the facts.
      if (path === "github") {
        const { githubTokens } = await import("@/lib/github-token");
        if (!auth.userId) {
          const access = await githubAccess();
          return Response.json({
            connected: access.source !== "none",
            source: access.source,
            login: null,
            problem:
              access.source === "none"
                ? "This key has no owner, so there is no personal GitHub token to use."
                : null,
          });
        }
        const status = await githubTokens().status(auth.userId);
        return Response.json({
          connected: status.connected,
          source: status.source,
          login: status.login,
          problem: status.problem,
        });
      }

      // A task's pull request, read from GitHub now and written back onto the task.
      const taskPrMatch = path.match(new RegExp("^tasks/([^/]+)/pull-request$"));
      if (taskPrMatch) {
        const task = await taskInWorkspace(admin, taskPrMatch[1], workspaceId);
        if (!task) return notFound();
        const { data: row } = await admin
          .from("plan_tasks")
          .select("pr_url, pr_number, pr_status")
          .eq("id", task.id)
          .single();
        const parsed = row?.pr_url ? parsePullRequestUrl(row.pr_url) : null;
        if (!row?.pr_url || !parsed) {
          throw new AppError("validation", "This task has no pull request yet.");
        }
        const access = await githubAccess();
        if (!access.port) {
          return Response.json({
            pr_url: row.pr_url,
            pr_number: row.pr_number,
            pr_status: row.pr_status,
            live: false,
            problem: NOT_CONNECTED_MESSAGE,
          });
        }
        try {
          const pull = await access.port.getPull(parsed.repo, parsed.number);
          const status = pull.merged ? "merged" : pull.state;
          await admin
            .from("plan_tasks")
            .update({ pr_number: pull.number, pr_status: status })
            .eq("id", task.id);
          return Response.json({
            pr_url: pull.url,
            pr_number: pull.number,
            pr_status: status,
            title: pull.title,
            draft: pull.draft,
            merged: pull.merged,
            base: pull.base,
            head: pull.head,
            mergeable: pull.mergeable,
            mergeable_state: pull.mergeableState,
            live: true,
          });
        } catch (error) {
          throw new AppError(
            "github_error",
            describeGitHubError(error, `read #${parsed.number}`, parsed.repo),
            { status: 502 },
          );
        }
      }

      const taskMatch = path.match(/^tasks\/([^/]+)$/);
      if (taskMatch) {
        // Needs a join to ensure workspace access, or simply verify task belongs to a plan in workspace
        const { data: task, error } = await admin
          .from("plan_tasks")
          .select("*, plan:plans!inner(workspace_id), steps:plan_task_steps(*)")
          .eq("id", taskMatch[1])
          .eq("plans.workspace_id", workspaceId)
          .single();
        if (error) throw error;
        const attachments = await sharedAttachments(admin, { taskId: task.id });
        return Response.json({ ...task, attachments });
      }

      // Files the team has shared with agents. Hidden files never appear here.
      const attachmentsMatch = path.match(/^tasks\/([^/]+)\/attachments$/);
      if (attachmentsMatch) {
        if (!(await taskInWorkspace(admin, attachmentsMatch[1], workspaceId))) return notFound();
        return Response.json(await sharedAttachments(admin, { taskId: attachmentsMatch[1] }));
      }

      const attachmentMatch = path.match(/^tasks\/([^/]+)\/attachments\/([^/]+)$/);
      if (attachmentMatch) {
        if (!(await taskInWorkspace(admin, attachmentMatch[1], workspaceId))) return notFound();
        const [attachment] = await sharedAttachments(admin, {
          taskId: attachmentMatch[1],
          attachmentId: attachmentMatch[2],
        });
        if (!attachment) {
          return new Response(JSON.stringify({ error: "Attachment not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        return Response.json(attachment);
      }
    } else if (method === "POST") {
      if (path === "plans" || path === "plans/") {
        const body = await readJson(request);
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title || title.length > 200) {
          throw new AppError("validation", "A plan needs a title of 1 to 200 characters.");
        }
        const status = optionalStatus(body.status);

        let githubRepo = optionalString(body.github_repo);
        let githubBase = optionalString(body.github_base);
        const projectId = optionalString(body.project_id);
        if (projectId) {
          const { data: project } = await admin
            .from("projects")
            .select("github_repo, github_default_branch")
            .eq("id", projectId)
            .eq("workspace_id", workspaceId)
            .maybeSingle();
          if (!project) throw new AppError("not_found", "Project not found.", { status: 404 });
          githubRepo = githubRepo ?? project.github_repo;
          githubBase = githubBase ?? project.github_default_branch;
        }

        const { data: plan, error } = await admin
          .from("plans")
          .insert({
            workspace_id: workspaceId,
            title,
            description: optionalString(body.description),
            project_id: projectId,
            github_repo: githubRepo,
            github_base: githubBase,
            ...(status && { status }),
          })
          .select("*")
          .single();
        if (error) throw error;
        await admin.from("plan_events").insert({ plan_id: plan.id, kind: "plan_created" });

        // A plan can arrive with its document in one call.
        if (typeof body.markdown === "string" && body.markdown.trim()) {
          const result = await applyPlanMarkdown(admin, {
            planId: plan.id,
            markdown: body.markdown,
            mode: "replace",
            actorId: null,
          });
          return Response.json({ ...plan, import: result }, { status: 201 });
        }
        return Response.json(plan, { status: 201 });
      }

      const planImportMatch = path.match(/^plans\/([^/]+)\/import$/);
      if (planImportMatch) {
        const body = await readJson(request);
        if (typeof body.markdown !== "string" || !body.markdown.trim()) {
          throw new AppError("validation", "Send the plan as markdown in `markdown`.");
        }
        if (body.markdown.length > 500_000) {
          throw new AppError("validation", "That document is over 500,000 characters.");
        }
        if (
          body.mode !== undefined &&
          body.mode !== "merge" &&
          body.mode !== "replace" &&
          body.mode !== "sync"
        ) {
          throw new AppError(
            "validation",
            '`mode` is "sync" (match by title, add what is missing, keep progress), "merge" (add everything as new) or "replace".',
          );
        }
        const planId = planImportMatch[1];
        const { data: plan } = await admin
          .from("plans")
          .select("id")
          .eq("id", planId)
          .eq("workspace_id", workspaceId)
          .maybeSingle();
        if (!plan) throw new AppError("not_found", "Plan not found.", { status: 404 });

        const result = await applyPlanMarkdown(admin, {
          planId,
          markdown: body.markdown,
          mode: body.mode ?? "merge",
          actorId: null,
        });
        return Response.json(result);
      }

      const planStatusMatch = path.match(/^plans\/([^/]+)\/status$/);
      if (planStatusMatch) {
        const body = await readJson(request);
        const status = optionalStatus(body.status);
        if (!status) throw new AppError("validation", "Send the new `status`.");
        const { data: plan, error } = await admin
          .from("plans")
          .update({ status })
          .eq("id", planStatusMatch[1])
          .eq("workspace_id", workspaceId)
          .select("*")
          .maybeSingle();
        if (error) throw error;
        if (!plan) throw new AppError("not_found", "Plan not found.", { status: 404 });
        if (status === "active" || status === "completed") {
          await admin.from("plan_events").insert({
            plan_id: plan.id,
            kind: status === "active" ? "plan_activated" : "plan_completed",
          });
        }
        return Response.json(plan);
      }

      // Merge the plan's pull requests in stack order. A dry run is the default: say what it would do
      // first, then repeat with `"dry_run": false` to do it.
      const mergePullsMatch = path.match(/^plans\/([^/]+)\/pull-requests\/merge$/);
      if (mergePullsMatch) {
        const body = await readJson(request).catch(() => ({}) as Record<string, unknown>);
        const method = body.method ?? "merge";
        if (method !== "merge" && method !== "squash" && method !== "rebase") {
          throw new AppError("validation", '`method` is "merge", "squash" or "rebase".');
        }
        const max = body.max === undefined ? undefined : Number(body.max);
        if (max !== undefined && (!Number.isInteger(max) || max < 1 || max > 50)) {
          throw new AppError("validation", "`max` is a whole number from 1 to 50.");
        }
        const access = await githubAccess();
        return Response.json(
          await mergePlanPulls(
            {
              db: admin,
              github: access.port,
              source: access.source,
              planId: mergePullsMatch[1],
              workspaceId,
            },
            {
              method,
              dryRun: body.dry_run !== false,
              max,
              only: optionalString(body.only) ?? undefined,
              ignoreChecks: body.ignore_checks === true,
            },
          ),
        );
      }

      // Open a pull request for a task with the key owner's GitHub token, and record it on the task.
      const openPrMatch = path.match(new RegExp("^tasks/([^/]+)/pull-request$"));
      if (openPrMatch) {
        const body = await readJson(request);
        const task = await taskInWorkspace(admin, openPrMatch[1], workspaceId);
        if (!task) return notFound();
        const head = optionalString(body.head_branch);
        const title = optionalString(body.title);
        if (!head || !title) {
          throw new AppError("validation", "`head_branch` and `title` are required.");
        }
        const { data: plan } = await admin
          .from("plans")
          .select("github_repo, github_base")
          .eq("id", task.plan_id)
          .single();
        const repo = optionalString(body.repo) ?? plan?.github_repo ?? null;
        if (!repo || !parseRepoSlug(repo)) {
          throw new AppError(
            "validation",
            "No repository: pass `repo` (owner/name) or set one on the plan.",
          );
        }
        const access = await githubAccess();
        if (!access.port)
          throw new AppError("github_not_configured", NOT_CONNECTED_MESSAGE, { status: 409 });
        try {
          const info = await access.port.repoInfo(repo);
          const base = optionalString(body.base) ?? plan?.github_base ?? info.defaultBranch;
          const pr = await access.port.openPull(repo, {
            head,
            base,
            title,
            body: optionalString(body.body) ?? `PR for task ${task.id}`,
          });
          await admin
            .from("plan_tasks")
            .update({ pr_number: pr.number, pr_url: pr.url, pr_status: "open" })
            .eq("id", task.id);
          return Response.json({ pr_url: pr.url, pr_number: pr.number, base });
        } catch (error) {
          throw new AppError(
            "github_error",
            describeGitHubError(error, "open the pull request", repo),
            {
              status: 502,
            },
          );
        }
      }

      const claimMatch = path.match(/^tasks\/([^/]+)\/claim$/);
      if (claimMatch) {
        const body = await request.json().catch(() => ({}));
        const existing = await taskInWorkspace(admin, claimMatch[1], workspaceId);
        if (!existing) return notFound();
        const { data: task, error } = await admin
          .from("plan_tasks")
          .update({
            status: "claimed",
            assigned_agent_id: body.agent_id || null,
            claimed_at: new Date().toISOString(),
          })
          .eq("id", claimMatch[1])
          .eq("status", "available")
          .select()
          .single();
        if (error) throw error;
        await logAgentEvent(admin, task, "task_claimed");
        return Response.json(task);
      }

      const startMatch = path.match(/^tasks\/([^/]+)\/start$/);
      if (startMatch) {
        if (!(await taskInWorkspace(admin, startMatch[1], workspaceId))) return notFound();
        const { data: task, error } = await admin
          .from("plan_tasks")
          .update({ status: "in_progress" })
          .eq("id", startMatch[1])
          .select()
          .single();
        if (error) throw error;
        await logAgentEvent(admin, task, "task_started");
        return Response.json(task);
      }

      const completeMatch = path.match(/^tasks\/([^/]+)\/complete$/);
      if (completeMatch) {
        const body = await request.json().catch(() => ({}));
        if (!(await taskInWorkspace(admin, completeMatch[1], workspaceId))) return notFound();
        const updateData: {
          status: "done";
          completed_at: string;
          pr_url?: string;
          pr_number?: number;
          pr_status?: string;
          branch_name?: string;
        } = {
          status: "done",
          completed_at: new Date().toISOString(),
        };
        if (body.pr_url) {
          updateData.pr_url = body.pr_url;
          // The board shows "PR #36 · open" only when it has the number as well as the link.
          const pr = parsePullRequestUrl(body.pr_url);
          if (pr) {
            updateData.pr_number = pr.number;
            updateData.pr_status = "open";
          }
        }
        if (typeof body.branch_name === "string" && body.branch_name.trim()) {
          updateData.branch_name = body.branch_name.trim();
        }

        const { data: task, error } = await admin
          .from("plan_tasks")
          .update(updateData)
          .eq("id", completeMatch[1])
          .select()
          .single();
        if (error) throw error;
        await logAgentEvent(admin, task, "task_completed");
        if (body.pr_url) await logAgentEvent(admin, task, "pr_opened", { detail: body.pr_url });
        return Response.json(task);
      }

      const blockMatch = path.match(/^tasks\/([^/]+)\/block$/);
      if (blockMatch) {
        if (!(await taskInWorkspace(admin, blockMatch[1], workspaceId))) return notFound();
        const { data: task, error } = await admin
          .from("plan_tasks")
          .update({ status: "blocked" })
          .eq("id", blockMatch[1])
          .select()
          .single();
        if (error) throw error;
        await logAgentEvent(admin, task, "task_blocked");
        return Response.json(task);
      }

      const unclaimMatch = path.match(/^tasks\/([^/]+)\/unclaim$/);
      if (unclaimMatch) {
        const existing = await taskInWorkspace(admin, unclaimMatch[1], workspaceId);
        if (!existing) return notFound();
        const { data: task, error } = await admin
          .from("plan_tasks")
          .update({ status: "available", assigned_agent_id: null, claimed_at: null })
          .eq("id", unclaimMatch[1])
          .select()
          .single();
        if (error) throw error;
        await logAgentEvent(admin, task, "task_unclaimed", {
          agentId: existing.assigned_agent_id,
        });
        return Response.json(task);
      }

      const commentMatch = path.match(/^tasks\/([^/]+)\/comment$/);
      if (commentMatch) {
        const body = await request.json();
        const task = await taskInWorkspace(admin, commentMatch[1], workspaceId);
        if (!task) return new Response("Task not found", { status: 404 });

        const { data: comment, error } = await admin
          .from("plan_task_comments")
          .insert({
            task_id: task.id,
            body: body.body,
            agent_id: body.agent_id || task.assigned_agent_id || null,
          })
          .select()
          .single();
        if (error) throw error;
        await logAgentEvent(admin, task, "comment_added", {
          agentId: comment.agent_id,
          detail: typeof body.body === "string" ? body.body.slice(0, 200) : null,
        });
        return Response.json(comment);
      }

      // Tick a sub-step, reword it, or add one. Steps belong to the task.
      const stepMatch = path.match(/^tasks\/([^/]+)\/steps\/([^/]+)$/);
      if (stepMatch) {
        const body = await request.json().catch(() => ({}));
        if (!(await taskInWorkspace(admin, stepMatch[1], workspaceId))) return notFound();
        const patch: Database["public"]["Tables"]["plan_task_steps"]["Update"] = {};
        if (typeof body.done === "boolean") patch.done = body.done;
        if (typeof body.text === "string" && body.text.trim()) {
          patch.text = body.text.trim().slice(0, STEP_TEXT_MAX);
        }
        if (Object.keys(patch).length === 0) {
          return new Response(JSON.stringify({ error: "Send done and/or text" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const { data: step, error } = await admin
          .from("plan_task_steps")
          .update(patch)
          .eq("id", stepMatch[2])
          .eq("task_id", stepMatch[1])
          .select()
          .single();
        if (error) throw error;
        return Response.json(step);
      }

      const stepsMatch = path.match(/^tasks\/([^/]+)\/steps$/);
      if (stepsMatch) {
        const body = await request.json().catch(() => ({}));
        if (!(await taskInWorkspace(admin, stepsMatch[1], workspaceId))) return notFound();
        const text = typeof body.text === "string" ? body.text.trim().slice(0, STEP_TEXT_MAX) : "";
        if (!text) {
          return new Response(JSON.stringify({ error: "text is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
        const { data: last } = await admin
          .from("plan_task_steps")
          .select("position")
          .eq("task_id", stepsMatch[1])
          .order("position", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { data: step, error } = await admin
          .from("plan_task_steps")
          .insert({
            task_id: stepsMatch[1],
            text,
            done: body.done === true,
            depth: Math.min(Math.max(Number(body.depth) || 0, 0), MAX_STEP_DEPTH),
            position: (last?.position ?? 0) + 1,
          })
          .select()
          .single();
        if (error) throw error;
        return Response.json(step);
      }

      if (path === "agents/register") {
        const body = await request.json();
        // Claiming registers the agent every time. The same agent coming back is the same agent,
        // not a new row per task (a plan of 25 tasks left 25 identical "Claude Code" agents).
        let existing = admin
          .from("plan_agents")
          .select()
          .eq("workspace_id", workspaceId)
          .eq("name", body.name)
          .eq("provider", body.provider);
        existing = body.model ? existing.eq("model", body.model) : existing.is("model", null);
        const { data: known } = await existing
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (known) {
          const { data: seen } = await admin
            .from("plan_agents")
            .update({ last_seen_at: new Date().toISOString() })
            .eq("id", known.id)
            .select()
            .single();
          return Response.json(seen ?? known);
        }
        const { data: agent, error } = await admin
          .from("plan_agents")
          .insert({
            workspace_id: workspaceId,
            name: body.name,
            provider: body.provider,
            model: body.model,
            capabilities: body.capabilities || [],
          })
          .select()
          .single();
        if (error) throw error;
        return Response.json(agent);
      }

      const heartbeatMatch = path.match(/^agents\/([^/]+)\/heartbeat$/);
      if (heartbeatMatch) {
        const { data: agent, error } = await admin
          .from("plan_agents")
          .update({ last_seen_at: new Date().toISOString() })
          .eq("id", heartbeatMatch[1])
          .eq("workspace_id", workspaceId)
          .select()
          .single();
        if (error) throw error;
        return Response.json(agent);
      }
    }

    return new Response("Not Found", { status: 404 });
  } catch (error: unknown) {
    // An error we wrote ourselves carries its own status and a message fit to show.
    if (error instanceof AppError) {
      return new Response(JSON.stringify({ error: error.message, code: error.code }), {
        status: error.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error("Planner API Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
