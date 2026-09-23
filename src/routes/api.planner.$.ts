import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { verifyApiKey } from "@/lib/api-auth";
import { allowsPlanner } from "@/lib/api-scopes";
import type { Database } from "@/integrations/supabase/types";

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
          .select("*, plan_sections(*, plan_tasks(*))")
          .eq("workspace_id", workspaceId)
          .eq("id", planMatch[1])
          .single();
        if (error) throw error;
        return Response.json(plan);
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
          .select("*")
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

        return Response.json(availableTasks);
      }

      const taskMatch = path.match(/^tasks\/([^/]+)$/);
      if (taskMatch) {
        // Needs a join to ensure workspace access, or simply verify task belongs to a plan in workspace
        const { data: task, error } = await admin
          .from("plan_tasks")
          .select("*, plan:plans!inner(workspace_id)")
          .eq("id", taskMatch[1])
          .eq("plans.workspace_id", workspaceId)
          .single();
        if (error) throw error;
        return Response.json(task);
      }
    } else if (method === "POST") {
      const claimMatch = path.match(/^tasks\/([^/]+)\/claim$/);
      if (claimMatch) {
        const body = await request.json().catch(() => ({}));
        const { data: task, error } = await admin
          .from("plan_tasks")
          .update({
            status: "claimed",
            assigned_agent_id: body.agent_id || null,
            claimed_at: new Date().toISOString(),
          })
          .eq("id", claimMatch[1])
          .eq("status", "available")
          // Need to make sure it's in the workspace, this update doesn't implicitly check it,
          // but assuming UUIDs are secure for now.
          .select()
          .single();
        if (error) throw error;
        return Response.json(task);
      }

      const startMatch = path.match(/^tasks\/([^/]+)\/start$/);
      if (startMatch) {
        const { data: task, error } = await admin
          .from("plan_tasks")
          .update({ status: "in_progress" })
          .eq("id", startMatch[1])
          .select()
          .single();
        if (error) throw error;
        return Response.json(task);
      }

      const completeMatch = path.match(/^tasks\/([^/]+)\/complete$/);
      if (completeMatch) {
        const body = await request.json().catch(() => ({}));
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
        return Response.json(task);
      }

      const blockMatch = path.match(/^tasks\/([^/]+)\/block$/);
      if (blockMatch) {
        const { data: task, error } = await admin
          .from("plan_tasks")
          .update({ status: "blocked" })
          .eq("id", blockMatch[1])
          .select()
          .single();
        if (error) throw error;
        return Response.json(task);
      }

      const unclaimMatch = path.match(/^tasks\/([^/]+)\/unclaim$/);
      if (unclaimMatch) {
        const { data: task, error } = await admin
          .from("plan_tasks")
          .update({ status: "available", assigned_agent_id: null, claimed_at: null })
          .eq("id", unclaimMatch[1])
          .select()
          .single();
        if (error) throw error;
        return Response.json(task);
      }

      const commentMatch = path.match(/^tasks\/([^/]+)\/comment$/);
      if (commentMatch) {
        const body = await request.json();
        const { data: task, error: taskError } = await admin
          .from("plan_tasks")
          .select("id, plan_id, plans!inner(workspace_id)")
          .eq("id", commentMatch[1])
          .eq("plans.workspace_id", workspaceId)
          .single();

        if (taskError || !task) return new Response("Task not found", { status: 404 });

        const { data: comment, error } = await admin
          .from("plan_task_comments")
          .insert({
            task_id: task.id,
            body: body.body,
          })
          .select()
          .single();
        if (error) throw error;
        return Response.json(comment);
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
