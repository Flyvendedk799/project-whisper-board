import { createFileRoute } from "@tanstack/react-router";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { verifyApiKey } from "@/lib/api-auth";
import { allowsPlanner } from "@/lib/api-scopes";
import { sharedAttachments, withSharedAttachments } from "@/features/planner/agent-media";
import { applyPlanMarkdown } from "@/lib/plan-import";
import {
  clampStepDepths,
  optionalString,
  optionalUuid,
  parseAnswerInput,
  parseBlockInput,
  parseFeaturesInput,
  parseFeatureUpdate,
  parseProgressInput,
  parseQuestionFilter,
  parseQuestionInput,
  parseSectionCreate,
  parseSectionUpdate,
  parseStepPatch,
  parseStepsInput,
  parseTaskCreate,
  parseTaskUpdate,
  parseWorkTarget,
} from "@/lib/agent-api-input";
import {
  byPosition,
  progressSummary,
  questionAuthorIds,
  withQuestionAuthors,
  type QuestionRow,
  type WhoNames,
} from "@/lib/agent-api-shape";
import { workTargetOf } from "@/lib/plan-fields";
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

/** A plan, but only when it belongs to the key's workspace. */
async function planInWorkspace(admin: Admin, planId: string, workspaceId: string) {
  const { data } = await admin
    .from("plans")
    .select("id, github_repo, github_base, github_work_mode, github_work_branch")
    .eq("id", planId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) throw new AppError("not_found", "Plan not found.", { status: 404 });
  return data;
}

/** A section, but only when its plan belongs to the key's workspace. */
async function sectionInWorkspace(admin: Admin, sectionId: string, workspaceId: string) {
  const { data } = await admin
    .from("plan_sections")
    .select("id, plan_id, plans!inner(workspace_id)")
    .eq("id", sectionId)
    .eq("plans.workspace_id", workspaceId)
    .maybeSingle();
  if (!data) throw new AppError("not_found", "Section not found.", { status: 404 });
  return data;
}

/** An agent id that belongs to this workspace, so a key cannot put its name on another's agent. */
async function agentInWorkspace(admin: Admin, workspaceId: string, agentId: string | null) {
  if (!agentId) return null;
  const { data } = await admin
    .from("plan_agents")
    .select("id")
    .eq("id", agentId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) {
    throw new AppError(
      "not_found",
      "Agent not found in this workspace. Register it first (agents/register or claim_task).",
      { status: 404 },
    );
  }
  return data.id;
}

/** Puts what an agent did in the plan's activity feed. A section or plan event has no task id. */
async function logAgentEvent(
  admin: Admin,
  target: { id?: string | null; plan_id: string; assigned_agent_id?: string | null },
  kind: EventKind,
  options: {
    agentId?: string | null;
    detail?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
  } = {},
) {
  const { error } = await admin.from("plan_events").insert({
    plan_id: target.plan_id,
    task_id: target.id ?? null,
    agent_id: options.agentId ?? target.assigned_agent_id ?? null,
    kind,
    new_value: options.detail ?? null,
    metadata: options.metadata ?? {},
  });
  if (error) console.error("Planner API event:", error.message);
}

/** Names for whoever asked or answered, looked up once for a whole set of questions. */
async function loadWhoNames(
  admin: Admin,
  workspaceId: string,
  questions: readonly QuestionRow[],
): Promise<WhoNames> {
  const ids = questionAuthorIds(questions);
  const [agents, people] = await Promise.all([
    ids.agents.length
      ? admin
          .from("plan_agents")
          .select("id, name")
          .eq("workspace_id", workspaceId)
          .in("id", ids.agents)
      : null,
    ids.people.length ? admin.from("profiles").select("id, full_name").in("id", ids.people) : null,
  ]);
  return {
    agents: new Map((agents?.data ?? []).map((agent) => [agent.id, agent.name])),
    people: new Map(
      (people?.data ?? []).map((person) => [person.id, person.full_name ?? "A teammate"]),
    ),
  };
}

async function decorateQuestions<T extends QuestionRow>(
  admin: Admin,
  workspaceId: string,
  questions: readonly T[],
) {
  return withQuestionAuthors(questions, await loadWhoNames(admin, workspaceId, questions));
}

/**
 * Steps and features in order, questions with who asked and who answered. Tasks are read with
 * `steps:plan_task_steps(*), features:plan_task_features(*), questions:plan_task_questions(*)`
 * (spelled out at each select, because the client only types a literal string).
 */
async function enrichTasks<
  T extends {
    steps?: Array<{ position: number }> | null;
    features?: Array<{ position: number }> | null;
    questions?: QuestionRow[] | null;
  },
>(admin: Admin, workspaceId: string, tasks: readonly T[]) {
  const names = await loadWhoNames(
    admin,
    workspaceId,
    tasks.flatMap((task) => task.questions ?? []),
  );
  return tasks.map((task) => ({
    ...task,
    steps: byPosition(task.steps ?? null),
    features: byPosition(task.features ?? null),
    questions: withQuestionAuthors(task.questions ?? null, names),
  }));
}

/** A task's status now, after a database trigger may have moved it. */
async function currentStatus(admin: Admin, taskId: string) {
  const { data } = await admin.from("plan_tasks").select("status").eq("id", taskId).single();
  return data?.status ?? null;
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

/** Like readJson, but a request with no body at all is an empty object. */
async function readOptionalJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    // falls through to the same message as a body of the wrong shape
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new AppError("validation", "Send a JSON object as the request body.");
  }
  return body as Record<string, unknown>;
}

function optionalStatus(value: unknown): PlanStatus | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !PLAN_STATUSES.includes(value)) {
    throw new AppError("validation", `Status is one of ${PLAN_STATUSES.join(", ")}.`);
  }
  return value as PlanStatus;
}

/** Steps and features of the given ids that are not on the task, so a typo fails before anything is written. */
async function idsMissingFrom(
  admin: Admin,
  table: "plan_task_steps" | "plan_task_features",
  taskId: string,
  ids: readonly string[],
) {
  if (ids.length === 0) return [];
  const { data, error } = await admin.from(table).select("id").eq("task_id", taskId).in("id", ids);
  if (error) throw error;
  const found = new Set((data ?? []).map((row) => row.id));
  return ids.filter((id) => !found.has(id));
}

async function requireFeatureOnTask(admin: Admin, taskId: string, featureId: string) {
  const { data } = await admin
    .from("plan_task_features")
    .select("id")
    .eq("id", featureId)
    .eq("task_id", taskId)
    .maybeSingle();
  if (!data) {
    throw new AppError("not_found", "That feature is not on this task.", { status: 404 });
  }
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
          .select(
            "*, plan_sections(*, plan_tasks(*, steps:plan_task_steps(*), features:plan_task_features(*), questions:plan_task_questions(*)))",
          )
          .eq("workspace_id", workspaceId)
          .eq("id", planMatch[1])
          .single();
        if (error) throw error;
        // Files come from their own query so a hidden one is never read.
        const files = new Map<string, Awaited<ReturnType<typeof sharedAttachments>>>();
        for (const attachment of await sharedAttachments(admin, { planId: plan.id })) {
          files.set(attachment.task_id, [...(files.get(attachment.task_id) ?? []), attachment]);
        }
        const tasks = await enrichTasks(
          admin,
          workspaceId,
          plan.plan_sections.flatMap((section) => section.plan_tasks),
        );
        const enriched = new Map(tasks.map((task) => [task.id, task]));
        return Response.json({
          ...plan,
          // Where commits for this plan go: repository, base, working branch and the mode.
          work_target: workTargetOf(plan),
          plan_sections: byPosition(plan.plan_sections).map((section) => ({
            ...section,
            plan_tasks: byPosition(section.plan_tasks).map((task) => ({
              ...(enriched.get(task.id) ?? task),
              attachments: files.get(task.id) ?? [],
            })),
          })),
        });
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
          .select(
            "*, steps:plan_task_steps(*), features:plan_task_features(*), questions:plan_task_questions(*)",
          )
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
          await withSharedAttachments(
            admin,
            availableTasksMatch[1],
            byPosition(await enrichTasks(admin, workspaceId, availableTasks)),
          ),
        );
      }

      // Every question on a plan, open ones by default: what a person still has to answer.
      const planQuestionsMatch = path.match(/^plans\/([^/]+)\/questions$/);
      if (planQuestionsMatch) {
        await planInWorkspace(admin, planQuestionsMatch[1], workspaceId);
        const filter = parseQuestionFilter(new URL(request.url).searchParams.get("status"), "open");
        let query = admin
          .from("plan_task_questions")
          .select("*, task:plan_tasks(id, title, status)")
          .eq("plan_id", planQuestionsMatch[1])
          .order("created_at", { ascending: true });
        if (filter !== "all") query = query.eq("status", filter);
        const { data: rows, error } = await query;
        if (error) throw error;
        return Response.json(await decorateQuestions(admin, workspaceId, rows ?? []));
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
        // The workspace check first, so the read below needs no filter of its own.
        if (!(await taskInWorkspace(admin, taskMatch[1], workspaceId))) return notFound();
        const { data: task, error } = await admin
          .from("plan_tasks")
          .select(
            "*, plan:plans(workspace_id, github_repo, github_base, github_work_mode, github_work_branch), steps:plan_task_steps(*), features:plan_task_features(*), questions:plan_task_questions(*)",
          )
          .eq("id", taskMatch[1])
          .single();
        if (error) throw error;
        const [enriched] = await enrichTasks(admin, workspaceId, [task]);
        const attachments = await sharedAttachments(admin, { taskId: task.id });
        return Response.json({
          ...enriched,
          work_target: workTargetOf(task.plan ?? {}),
          attachments,
        });
      }

      const taskQuestionsMatch = path.match(/^tasks\/([^/]+)\/questions$/);
      if (taskQuestionsMatch) {
        if (!(await taskInWorkspace(admin, taskQuestionsMatch[1], workspaceId))) return notFound();
        const filter = parseQuestionFilter(new URL(request.url).searchParams.get("status"), "all");
        let query = admin
          .from("plan_task_questions")
          .select("*")
          .eq("task_id", taskQuestionsMatch[1])
          .order("created_at", { ascending: true });
        if (filter !== "all") query = query.eq("status", filter);
        const { data: rows, error } = await query;
        if (error) throw error;
        return Response.json(await decorateQuestions(admin, workspaceId, rows ?? []));
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
        // Where the work lands: a new branch, an existing one, or the base branch itself.
        const workTarget = parseWorkTarget(body, githubBase);

        const { data: plan, error } = await admin
          .from("plans")
          .insert({
            workspace_id: workspaceId,
            title,
            description: optionalString(body.description),
            project_id: projectId,
            github_repo: githubRepo,
            github_base: githubBase,
            ...workTarget,
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
          return Response.json(
            { ...plan, work_target: workTargetOf(plan), import: result },
            { status: 201 },
          );
        }
        return Response.json({ ...plan, work_target: workTargetOf(plan) }, { status: 201 });
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

      // A new section at the end of the plan. With no colour it takes the next one in the palette.
      const planSectionsMatch = path.match(/^plans\/([^/]+)\/sections$/);
      if (planSectionsMatch) {
        const plan = await planInWorkspace(admin, planSectionsMatch[1], workspaceId);
        const fields = parseSectionCreate(await readJson(request));
        const { data: last } = await admin
          .from("plan_sections")
          .select("position")
          .eq("plan_id", plan.id)
          .order("position", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { data: section, error } = await admin
          .from("plan_sections")
          .insert({ ...fields, plan_id: plan.id, position: (last?.position ?? 0) + 1 })
          .select("*")
          .single();
        if (error) throw error;
        await logAgentEvent(admin, { plan_id: plan.id }, "section_created", {
          detail: section.title,
        });
        return Response.json(section, { status: 201 });
      }

      const sectionMatch = path.match(/^sections\/([^/]+)$/);
      if (sectionMatch) {
        const section = await sectionInWorkspace(admin, sectionMatch[1], workspaceId);
        const fields = parseSectionUpdate(await readJson(request));
        const { data: updated, error } = await admin
          .from("plan_sections")
          .update(fields)
          .eq("id", section.id)
          .select("*")
          .single();
        if (error) throw error;
        await logAgentEvent(admin, { plan_id: section.plan_id }, "section_updated", {
          detail: updated.title,
        });
        return Response.json(updated);
      }

      // A new task in one of the plan's sections, with its feature list if it has one.
      const planTasksMatch = path.match(/^plans\/([^/]+)\/tasks$/);
      if (planTasksMatch) {
        const plan = await planInWorkspace(admin, planTasksMatch[1], workspaceId);
        const input = parseTaskCreate(await readJson(request));
        const { data: section } = await admin
          .from("plan_sections")
          .select("id")
          .eq("id", input.sectionId)
          .eq("plan_id", plan.id)
          .maybeSingle();
        if (!section)
          throw new AppError("not_found", "Section not found in this plan.", { status: 404 });
        if (input.dependsOn.length > 0) {
          const { data: found } = await admin
            .from("plan_tasks")
            .select("id")
            .eq("plan_id", plan.id)
            .in("id", input.dependsOn);
          const known = new Set((found ?? []).map((row) => row.id));
          const unknown = input.dependsOn.filter((id) => !known.has(id));
          if (unknown.length > 0) {
            throw new AppError(
              "validation",
              `depends_on has tasks that are not in this plan: ${unknown.join(", ")}.`,
            );
          }
        }

        const { data: last } = await admin
          .from("plan_tasks")
          .select("position")
          .eq("section_id", section.id)
          .order("position", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { data: task, error } = await admin
          .from("plan_tasks")
          .insert({
            ...input.fields,
            plan_id: plan.id,
            section_id: section.id,
            status: input.status,
            depends_on: input.dependsOn,
            position: (last?.position ?? 0) + 1,
          })
          .select("*")
          .single();
        if (error) throw error;

        let features: Database["public"]["Tables"]["plan_task_features"]["Row"][] = [];
        if (input.features.length > 0) {
          const { data: rows, error: featureError } = await admin
            .from("plan_task_features")
            .insert(
              input.features.map((text, index) => ({
                task_id: task.id,
                text,
                source: "agent",
                position: index + 1,
              })),
            )
            .select("*");
          if (featureError) throw featureError;
          features = byPosition(rows ?? []);
        }
        await logAgentEvent(admin, task, "task_created", { detail: task.title });
        return Response.json({ ...task, features }, { status: 201 });
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
        const { data: plan } = await admin
          .from("plans")
          .select("github_repo, github_base, github_work_mode, github_work_branch")
          .eq("id", task.plan_id)
          .single();
        const target = workTargetOf(plan ?? {});
        if (target.mode === "base" && !optionalString(body.head_branch)) {
          throw new AppError(
            "validation",
            `This plan works directly on ${target.base ?? "the base branch"}: commit and push there and call complete_task. No pull request is needed.`,
          );
        }
        // The head defaults to the plan's working branch, so an agent only names one for a task of its own.
        const head = optionalString(body.head_branch) ?? target.branch;
        const title = optionalString(body.title);
        if (!head || !title) {
          throw new AppError(
            "validation",
            "`title` is required, and so is `head_branch` when the plan has no working branch.",
          );
        }
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
          return Response.json({ pr_url: pr.url, pr_number: pr.number, base, head });
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
        const body = await readOptionalJson(request);
        const existing = await taskInWorkspace(admin, claimMatch[1], workspaceId);
        if (!existing) return notFound();
        const agentId = await agentInWorkspace(
          admin,
          workspaceId,
          optionalUuid(body.agent_id, "`agent_id`"),
        );
        const { data: task, error } = await admin
          .from("plan_tasks")
          .update({
            status: "claimed",
            assigned_agent_id: agentId,
            claimed_at: new Date().toISOString(),
          })
          .eq("id", claimMatch[1])
          .eq("status", "available")
          .select()
          .maybeSingle();
        if (error) throw error;
        if (!task) {
          throw new AppError(
            "conflict",
            `This task is ${existing.status}, not available: pick another from the available tasks.`,
            { status: 409 },
          );
        }
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

      // The "Progresser": status, ticked steps, met features and an optional note in one call.
      // Only a note becomes a comment, so an update with nothing to say adds no noise.
      const progressMatch = path.match(/^tasks\/([^/]+)\/progress$/);
      if (progressMatch) {
        const task = await taskInWorkspace(admin, progressMatch[1], workspaceId);
        if (!task) return notFound();
        const input = parseProgressInput(await readJson(request));
        const agentId =
          (await agentInWorkspace(admin, workspaceId, input.agentId)) ?? task.assigned_agent_id;

        // Check everything before writing anything, so a wrong id changes nothing.
        const missingSteps = await idsMissingFrom(
          admin,
          "plan_task_steps",
          task.id,
          input.stepsDone,
        );
        const missingFeatures = await idsMissingFrom(
          admin,
          "plan_task_features",
          task.id,
          input.featuresMet,
        );
        if (missingSteps.length > 0 || missingFeatures.length > 0) {
          throw new AppError(
            "validation",
            [
              missingSteps.length > 0 && `Not steps of this task: ${missingSteps.join(", ")}.`,
              missingFeatures.length > 0 &&
                `Not features of this task: ${missingFeatures.join(", ")}.`,
            ]
              .filter(Boolean)
              .join(" "),
          );
        }
        if (input.status && (task.status === "available" || task.status === "backlog")) {
          throw new AppError(
            "conflict",
            `Claim this task first (it is ${task.status}), then report progress.`,
            { status: 409 },
          );
        }
        if (input.status && task.status === "blocked") {
          const { count } = await admin
            .from("plan_task_questions")
            .select("id", { count: "exact", head: true })
            .eq("task_id", task.id)
            .eq("status", "open")
            .eq("blocking", true);
          if ((count ?? 0) > 0) {
            throw new AppError(
              "conflict",
              "This task is blocked on an open question. It continues when a person answers it.",
              { status: 409 },
            );
          }
        }

        if (input.stepsDone.length > 0) {
          const { error } = await admin
            .from("plan_task_steps")
            .update({ done: true })
            .eq("task_id", task.id)
            .in("id", input.stepsDone);
          if (error) throw error;
        }
        if (input.featuresMet.length > 0) {
          const { error } = await admin
            .from("plan_task_features")
            .update({ met: true })
            .eq("task_id", task.id)
            .in("id", input.featuresMet);
          if (error) throw error;
        }
        if (input.stepsDone.length > 0 || input.featuresMet.length > 0) {
          const parts = [
            input.stepsDone.length > 0 &&
              `${input.stepsDone.length} step${input.stepsDone.length === 1 ? "" : "s"} done`,
            input.featuresMet.length > 0 &&
              `${input.featuresMet.length} feature${input.featuresMet.length === 1 ? "" : "s"} met`,
          ].filter(Boolean);
          await logAgentEvent(admin, task, "task_updated", {
            agentId,
            detail: parts.join(", "),
          });
        }

        if (input.status && input.status !== task.status) {
          const { error } = await admin
            .from("plan_tasks")
            .update({
              status: input.status,
              ...(input.status === "done" && { completed_at: new Date().toISOString() }),
            })
            .eq("id", task.id);
          if (error) throw error;
          await logAgentEvent(
            admin,
            task,
            input.status === "done"
              ? "task_completed"
              : input.status === "in_review"
                ? "task_reviewed"
                : "task_started",
            { agentId },
          );
        }

        let comment: Database["public"]["Tables"]["plan_task_comments"]["Row"] | null = null;
        if (input.note) {
          const { data, error } = await admin
            .from("plan_task_comments")
            .insert({ task_id: task.id, body: input.note, agent_id: agentId })
            .select()
            .single();
          if (error) throw error;
          comment = data;
          await logAgentEvent(admin, task, "comment_added", {
            agentId,
            detail: input.note.slice(0, 200),
          });
        }

        const { data: after, error: afterError } = await admin
          .from("plan_tasks")
          .select(
            "*, steps:plan_task_steps(done), features:plan_task_features(met), questions:plan_task_questions(status, blocking)",
          )
          .eq("id", task.id)
          .single();
        if (afterError) throw afterError;
        const { steps, features, questions, ...row } = after;
        const progress = progressSummary({ steps, features, questions });
        const hints: string[] = [];
        if (input.status === "done") {
          if (progress.features.met < progress.features.total) {
            hints.push(
              `${progress.features.total - progress.features.met} feature(s) are not marked met: mark the ones this work satisfies.`,
            );
          }
          if (progress.steps.done < progress.steps.total) {
            hints.push(`${progress.steps.total - progress.steps.done} step(s) are still unticked.`);
          }
        }
        return Response.json({ task: row, progress, comment, hints });
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

      // With a reason, blocking is a blocking question: a person sees something to answer, and the task
      // goes back where it was once it is answered. Without one it only flips the status.
      const blockMatch = path.match(/^tasks\/([^/]+)\/block$/);
      if (blockMatch) {
        const existing = await taskInWorkspace(admin, blockMatch[1], workspaceId);
        if (!existing) return notFound();
        const input = parseBlockInput(await readOptionalJson(request));
        const agentId =
          (await agentInWorkspace(admin, workspaceId, input.agentId)) ?? existing.assigned_agent_id;

        if (input.reason) {
          const { data: question, error } = await admin
            .from("plan_task_questions")
            .insert({
              task_id: existing.id,
              body: input.reason,
              blocking: true,
              asked_by_agent_id: agentId,
            })
            .select()
            .single();
          if (error) throw error;
          await logAgentEvent(admin, existing, "question_asked", {
            agentId,
            detail: input.reason.slice(0, 200),
            metadata: { blocking: true },
          });
          const { data: task, error: taskError } = await admin
            .from("plan_tasks")
            .select()
            .eq("id", existing.id)
            .single();
          if (taskError) throw taskError;
          if (task.status === "blocked")
            await logAgentEvent(admin, task, "task_blocked", { agentId });
          return Response.json({ ...task, question_id: question.id });
        }

        const { data: task, error } = await admin
          .from("plan_tasks")
          .update({ status: "blocked" })
          .eq("id", blockMatch[1])
          .select()
          .single();
        if (error) throw error;
        await logAgentEvent(admin, task, "task_blocked", { agentId });
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
        const agentId = await agentInWorkspace(
          admin,
          workspaceId,
          optionalUuid(body.agent_id, "`agent_id`"),
        );

        const { data: comment, error } = await admin
          .from("plan_task_comments")
          .insert({
            task_id: task.id,
            body: body.body,
            agent_id: agentId ?? task.assigned_agent_id ?? null,
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

      // Ask a question about a task. A blocking one holds the task in "blocked" until it is answered
      // (a database trigger does that); a plain one only asks.
      const taskQuestionsPost = path.match(/^tasks\/([^/]+)\/questions$/);
      if (taskQuestionsPost) {
        const task = await taskInWorkspace(admin, taskQuestionsPost[1], workspaceId);
        if (!task) return notFound();
        const input = parseQuestionInput(await readJson(request));
        const agentId =
          (await agentInWorkspace(admin, workspaceId, input.agentId)) ?? task.assigned_agent_id;
        const { data: question, error } = await admin
          .from("plan_task_questions")
          .insert({
            task_id: task.id,
            body: input.body,
            blocking: input.blocking,
            asked_by_agent_id: agentId,
          })
          .select()
          .single();
        if (error) throw error;
        await logAgentEvent(admin, task, "question_asked", {
          agentId,
          detail: input.body.slice(0, 200),
          metadata: { blocking: input.blocking },
        });
        const [decorated] = await decorateQuestions(admin, workspaceId, [question]);
        return Response.json(
          { ...decorated, task_status: await currentStatus(admin, task.id) },
          { status: 201 },
        );
      }

      // Answer or dismiss a question. Answering the last blocking one puts the task back where it was.
      const questionActionMatch = path.match(
        /^tasks\/([^/]+)\/questions\/([^/]+)\/(answer|dismiss)$/,
      );
      if (questionActionMatch) {
        const [, taskId, questionId, action] = questionActionMatch;
        const task = await taskInWorkspace(admin, taskId, workspaceId);
        if (!task) return notFound();
        const body = await readOptionalJson(request);
        const { data: question } = await admin
          .from("plan_task_questions")
          .select("id, status")
          .eq("id", questionId)
          .eq("task_id", task.id)
          .maybeSingle();
        if (!question) throw new AppError("not_found", "Question not found.", { status: 404 });
        if (question.status !== "open") {
          throw new AppError("conflict", `That question is already ${question.status}.`, {
            status: 409,
          });
        }

        let patch: Database["public"]["Tables"]["plan_task_questions"]["Update"];
        let agentId: string | null = null;
        let answer = "";
        if (action === "answer") {
          const input = parseAnswerInput(body);
          agentId = await agentInWorkspace(admin, workspaceId, input.agentId);
          answer = input.answer;
          patch = {
            status: "answered",
            answer,
            answered_by_agent_id: agentId,
            answered_by_user_id: null,
            answered_at: new Date().toISOString(),
          };
        } else {
          patch = { status: "dismissed" };
        }
        const { data: updated, error } = await admin
          .from("plan_task_questions")
          .update(patch)
          .eq("id", question.id)
          .select()
          .single();
        if (error) throw error;
        if (action === "answer") {
          await logAgentEvent(admin, task, "question_answered", {
            agentId,
            detail: answer.slice(0, 200),
          });
        }
        const [decorated] = await decorateQuestions(admin, workspaceId, [updated]);
        return Response.json({ ...decorated, task_status: await currentStatus(admin, task.id) });
      }

      // Features are what a task has to deliver; mark one met when the work satisfies it.
      const featureMatch = path.match(/^tasks\/([^/]+)\/features\/([^/]+)$/);
      if (featureMatch) {
        const task = await taskInWorkspace(admin, featureMatch[1], workspaceId);
        if (!task) return notFound();
        const patch = parseFeatureUpdate(await readJson(request));
        const { data: feature, error } = await admin
          .from("plan_task_features")
          .update(patch)
          .eq("id", featureMatch[2])
          .eq("task_id", task.id)
          .select()
          .maybeSingle();
        if (error) throw error;
        if (!feature) throw new AppError("not_found", "Feature not found.", { status: 404 });
        if (patch.met !== undefined) {
          await logAgentEvent(admin, task, "task_updated", {
            detail: `Feature ${patch.met ? "met" : "not met"}: ${feature.text}`.slice(0, 200),
          });
        }
        return Response.json(feature);
      }

      const featuresMatch = path.match(/^tasks\/([^/]+)\/features$/);
      if (featuresMatch) {
        const task = await taskInWorkspace(admin, featuresMatch[1], workspaceId);
        if (!task) return notFound();
        const input = parseFeaturesInput(await readJson(request));
        const { data: last } = await admin
          .from("plan_task_features")
          .select("position")
          .eq("task_id", task.id)
          .order("position", { ascending: false })
          .limit(1)
          .maybeSingle();
        let position = last?.position ?? 0;
        const { data: rows, error } = await admin
          .from("plan_task_features")
          .insert(
            input.features.map((feature) => ({
              task_id: task.id,
              text: feature.text,
              met: feature.met,
              source: "agent",
              position: ++position,
            })),
          )
          .select();
        if (error) throw error;
        return Response.json(
          { created: rows?.length ?? 0, features: byPosition(rows ?? []) },
          { status: 201 },
        );
      }

      // Tick a sub-step, reword it, or link it to a feature. Steps belong to the task.
      const stepMatch = path.match(/^tasks\/([^/]+)\/steps\/([^/]+)$/);
      if (stepMatch) {
        if (!(await taskInWorkspace(admin, stepMatch[1], workspaceId))) return notFound();
        const patch = parseStepPatch(await readJson(request));
        if (patch.feature_id) await requireFeatureOnTask(admin, stepMatch[1], patch.feature_id);
        const { data: step, error } = await admin
          .from("plan_task_steps")
          .update(patch)
          .eq("id", stepMatch[2])
          .eq("task_id", stepMatch[1])
          .select()
          .maybeSingle();
        if (error) throw error;
        if (!step) throw new AppError("not_found", "Step not found.", { status: 404 });
        return Response.json(step);
      }

      // Add one or many sub-steps to the end of the checklist, optionally all for one feature.
      const stepsMatch = path.match(/^tasks\/([^/]+)\/steps$/);
      if (stepsMatch) {
        const task = await taskInWorkspace(admin, stepsMatch[1], workspaceId);
        if (!task) return notFound();
        const input = parseStepsInput(await readJson(request));
        if (input.featureId) await requireFeatureOnTask(admin, task.id, input.featureId);
        const { data: last } = await admin
          .from("plan_task_steps")
          .select("position, depth")
          .eq("task_id", task.id)
          .order("position", { ascending: false })
          .limit(1)
          .maybeSingle();
        let position = last?.position ?? 0;
        const { data: rows, error } = await admin
          .from("plan_task_steps")
          .insert(
            clampStepDepths(input.lines, last ? last.depth : -1).map((line) => ({
              task_id: task.id,
              text: line.text,
              done: line.done,
              depth: line.depth,
              position: ++position,
              feature_id: input.featureId,
              source: "agent",
            })),
          )
          .select();
        if (error) throw error;
        return Response.json(
          { created: rows?.length ?? 0, steps: byPosition(rows ?? []) },
          { status: 201 },
        );
      }

      // Edit a task's own fields: title, description, priority, size, tags, colour, acceptance criteria, branch.
      const taskUpdateMatch = path.match(/^tasks\/([^/]+)$/);
      if (taskUpdateMatch) {
        const task = await taskInWorkspace(admin, taskUpdateMatch[1], workspaceId);
        if (!task) return notFound();
        const fields = parseTaskUpdate(await readJson(request));
        const { data: updated, error } = await admin
          .from("plan_tasks")
          .update(fields)
          .eq("id", task.id)
          .select("*")
          .single();
        if (error) throw error;
        await logAgentEvent(admin, task, "task_updated", {
          detail: fields.title ?? Object.keys(fields).join(", "),
        });
        return Response.json(updated);
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
