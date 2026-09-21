/* eslint-disable no-restricted-syntax */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

// Setup Supabase
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const workspaceId = process.env.PLANNER_WORKSPACE_ID!;

if (!supabaseUrl || !supabaseKey || !workspaceId) {
  console.error(
    "Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PLANNER_WORKSPACE_ID",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const server = new McpServer({
  name: "consflow-planner",
  version: "1.0.0",
});

// Tools
server.tool("list_plans", "List all active plans", {}, async () => {
  const { data: plans, error } = await supabase
    .from("plans")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("status", "active");

  if (error) return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(plans, null, 2) }] };
});

server.tool(
  "get_plan",
  "Get plan detail with sections and tasks",
  {
    plan_id: z.string().describe("The ID of the plan"),
  },
  async ({ plan_id }) => {
    const { data: plan, error } = await supabase
      .from("plans")
      .select("*, plan_sections(*, plan_tasks(*))")
      .eq("id", plan_id)
      .eq("workspace_id", workspaceId)
      .single();

    if (error)
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(plan, null, 2) }] };
  },
);

server.tool(
  "list_available_tasks",
  "Available tasks with met dependencies",
  {
    plan_id: z.string().describe("The ID of the plan"),
  },
  async ({ plan_id }) => {
    // First verify plan belongs to workspace
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("id")
      .eq("id", plan_id)
      .eq("workspace_id", workspaceId)
      .single();

    if (planError || !plan)
      return {
        content: [{ type: "text", text: `Plan not found or access denied` }],
        isError: true,
      };

    const { data: allTasks, error: tasksError } = await supabase
      .from("plan_tasks")
      .select("*")
      .eq("plan_id", plan_id);

    if (tasksError)
      return { content: [{ type: "text", text: `Error: ${tasksError.message}` }], isError: true };

    const taskStatusMap = new Map(allTasks.map((t) => [t.id, t.status]));

    const availableTasks = allTasks.filter((t) => {
      if (t.status !== "available") return false;
      if (!t.depends_on || t.depends_on.length === 0) return true;
      return (t.depends_on as string[]).every((depId) => taskStatusMap.get(depId) === "done");
    });

    return { content: [{ type: "text", text: JSON.stringify(availableTasks, null, 2) }] };
  },
);

server.tool(
  "get_task",
  "Get task detail with description and acceptance criteria",
  {
    task_id: z.string().describe("The ID of the task"),
  },
  async ({ task_id }) => {
    const { data: task, error } = await supabase
      .from("plan_tasks")
      .select("*, plan:plans!inner(workspace_id)")
      .eq("id", task_id)
      .eq("plans.workspace_id", workspaceId)
      .single();

    if (error)
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
  },
);

server.tool(
  "claim_task",
  "Claim an available task. Registers agent if needed.",
  {
    task_id: z.string(),
    agent_name: z.string(),
    provider: z.string(),
    model: z.string().optional(),
  },
  async ({ task_id, agent_name, provider, model }) => {
    // Auto-register agent
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .upsert(
        {
          workspace_id: workspaceId,
          name: agent_name,
          provider: provider,
          model: model,
          last_seen: new Date().toISOString(),
        },
        { onConflict: "workspace_id, name" },
      )
      .select()
      .single();

    if (agentError)
      return {
        content: [{ type: "text", text: `Agent register error: ${agentError.message}` }],
        isError: true,
      };

    const { data: task, error } = await supabase
      .from("plan_tasks")
      .update({
        status: "claimed",
        assigned_agent_id: agent.id,
        claimed_at: new Date().toISOString(),
      })
      .eq("id", task_id)
      .eq("status", "available")
      .select()
      .single();

    if (error)
      return {
        content: [
          { type: "text", text: `Error claiming task (may not be available): ${error.message}` },
        ],
        isError: true,
      };
    return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
  },
);

server.tool(
  "start_task",
  "Mark claimed task as in_progress",
  {
    task_id: z.string(),
  },
  async ({ task_id }) => {
    const { data: task, error } = await supabase
      .from("plan_tasks")
      .update({ status: "in_progress" })
      .eq("id", task_id)
      .select()
      .single();

    if (error)
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
  },
);

server.tool(
  "complete_task",
  "Mark task as done",
  {
    task_id: z.string(),
    summary: z.string().optional(),
    pr_url: z.string().optional(),
  },
  async ({ task_id, summary, pr_url }) => {
    // Option to store summary and pr_url if there's a place for it,
    // otherwise just mark done
    const updateData: Record<string, unknown> = {
      status: "done",
      completed_at: new Date().toISOString(),
    };
    if (pr_url) updateData.pr_url = pr_url;

    if (summary) {
      await supabase.from("plan_task_comments").insert({ task_id, body: `COMPLETED: ${summary}` });
    }

    const { data: task, error } = await supabase
      .from("plan_tasks")
      .update(updateData)
      .eq("id", task_id)
      .select()
      .single();

    if (error)
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
  },
);

server.tool(
  "block_task",
  "Mark task as blocked",
  {
    task_id: z.string(),
    reason: z.string(),
  },
  async ({ task_id, reason }) => {
    const { data: task, error } = await supabase
      .from("plan_tasks")
      .update({ status: "blocked" })
      .eq("id", task_id)
      .select()
      .single();

    // Optionally log the reason to comments
    await supabase.from("plan_task_comments").insert({ task_id, body: `BLOCKED: ${reason}` });

    if (error)
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
  },
);

server.tool(
  "unclaim_task",
  "Release back to available",
  {
    task_id: z.string(),
  },
  async ({ task_id }) => {
    const { data: task, error } = await supabase
      .from("plan_tasks")
      .update({ status: "available", assigned_agent_id: null, claimed_at: null })
      .eq("id", task_id)
      .select()
      .single();

    if (error)
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
  },
);

server.tool(
  "add_task_comment",
  "Post comment",
  {
    task_id: z.string(),
    body: z.string(),
  },
  async ({ task_id, body }) => {
    const { data: comment, error } = await supabase
      .from("plan_task_comments")
      .insert({ task_id, body })
      .select()
      .single();

    if (error)
      return { content: [{ type: "text", text: `Error: ${error.message}` }], isError: true };
    return { content: [{ type: "text", text: JSON.stringify(comment, null, 2) }] };
  },
);

server.tool(
  "create_pull_request",
  "Create GitHub PR (Requires GITHUB_PAT env var)",
  {
    task_id: z.string(),
    head_branch: z.string(),
    title: z.string(),
    body: z.string().optional(),
  },
  async ({ task_id, head_branch, title, body }) => {
    if (!process.env.GITHUB_PAT || !process.env.GITHUB_REPO) {
      return {
        content: [{ type: "text", text: `Missing GITHUB_PAT or GITHUB_REPO env var.` }],
        isError: true,
      };
    }

    try {
      const response = await fetch(
        `https://api.github.com/repos/${process.env.GITHUB_REPO}/pulls`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.GITHUB_PAT}`,
            Accept: "application/vnd.github.v3+json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            title,
            head: head_branch,
            base: "main", // assume main for simplicity, or could be parametrized
            body: body || `PR for task ${task_id}`,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        return {
          content: [{ type: "text", text: `GitHub API Error: ${errorText}` }],
          isError: true,
        };
      }

      const pr = await response.json();

      // Optionally update task with PR url
      await supabase.from("plan_tasks").update({ pr_url: pr.html_url }).eq("id", task_id);

      return {
        content: [
          { type: "text", text: JSON.stringify({ url: pr.html_url, number: pr.number }, null, 2) },
        ],
      };
    } catch (err: any) {
      return { content: [{ type: "text", text: `Error: ${err.message}` }], isError: true };
    }
  },
);

server.tool(
  "check_pr_status",
  "Check PR status",
  {
    task_id: z.string(),
  },
  async ({ task_id }) => {
    const { data: task, error } = await supabase
      .from("plan_tasks")
      .select("pr_url")
      .eq("id", task_id)
      .single();

    if (error || !task?.pr_url)
      return {
        content: [{ type: "text", text: `Task has no PR URL or error fetching task.` }],
        isError: true,
      };

    return {
      content: [
        {
          type: "text",
          text: `PR URL is: ${task.pr_url}. Use GitHub tools to check further details.`,
        },
      ],
    };
  },
);

// Run server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Consflow Planner MCP server running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
