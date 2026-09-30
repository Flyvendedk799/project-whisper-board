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
import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;
type EventKind = Database["public"]["Enums"]["plan_event_kind"];

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

    if (method === "GET") {
      if (path === "plans" || path === "plans/") {
        const { data: plans, error } = await admin
          .from("plans")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("status", "active");
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
        const updateData: { status: "done"; completed_at: string; pr_url?: string } = {
          status: "done",
          completed_at: new Date().toISOString(),
        };
        if (body.pr_url) updateData.pr_url = body.pr_url;

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
    console.error("Planner API Error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
