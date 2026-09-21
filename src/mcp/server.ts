/* eslint-disable no-restricted-syntax */
import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// Setup API connection
const apiUrl = process.env.PLANNER_API_URL || (process.env.NODE_ENV === "production" ? "https://boared.online/api/planner" : "http://localhost:3000/api/planner");
const apiKey = process.env.PLANNER_API_KEY;

if (!apiKey) {
  console.error("Missing required environment variable: PLANNER_API_KEY");
  process.exit(1);
}

const fetchApi = async (path: string, options: RequestInit = {}): Promise<unknown> => {
  const url = `${apiUrl}/${path.replace(/^\//, "")}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`API Error (${response.status}): ${text}`);
  }

  return response.json();
};

const server = new McpServer({
  name: "consflow-planner",
  version: "1.0.0",
});

// Tools
server.tool("list_plans", "List all active plans", {}, async () => {
  try {
    const plans = await fetchApi("plans");
    return { content: [{ type: "text", text: JSON.stringify(plans, null, 2) }] };
  } catch (error: unknown) {
    return { content: [{ type: "text", text: `Error: ${(error as Error).message}` }], isError: true };
  }
});

server.tool(
  "get_plan",
  "Get plan detail with sections and tasks",
  {
    plan_id: z.string().describe("The ID of the plan"),
  },
  async ({ plan_id }) => {
    try {
      const plan = await fetchApi(`plans/${plan_id}`);
      return { content: [{ type: "text", text: JSON.stringify(plan, null, 2) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${(error as Error).message}` }], isError: true };
    }
  },
);

server.tool(
  "list_available_tasks",
  "Available tasks with met dependencies",
  {
    plan_id: z.string().describe("The ID of the plan"),
  },
  async ({ plan_id }) => {
    try {
      const availableTasks = await fetchApi(`plans/${plan_id}/available-tasks`);
      return { content: [{ type: "text", text: JSON.stringify(availableTasks, null, 2) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${(error as Error).message}` }], isError: true };
    }
  },
);

server.tool(
  "get_task",
  "Get task detail with description and acceptance criteria",
  {
    task_id: z.string().describe("The ID of the task"),
  },
  async ({ task_id }) => {
    try {
      const task = await fetchApi(`tasks/${task_id}`);
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${(error as Error).message}` }], isError: true };
    }
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
    try {
      // Auto-register agent
      const agent = (await fetchApi("agents/register", {
        method: "POST",
        body: JSON.stringify({
          name: agent_name,
          provider: provider,
          model: model,
        }),
      })) as { id: string };

      const task = await fetchApi(`tasks/${task_id}/claim`, {
        method: "POST",
        body: JSON.stringify({ agent_id: agent.id }),
      });
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    } catch (error: unknown) {
      return {
        content: [{ type: "text", text: `Error claiming task: ${(error as Error).message}` }],
        isError: true,
      };
    }
  },
);

server.tool(
  "start_task",
  "Mark claimed task as in_progress",
  {
    task_id: z.string(),
  },
  async ({ task_id }) => {
    try {
      const task = await fetchApi(`tasks/${task_id}/start`, { method: "POST" });
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${(error as Error).message}` }], isError: true };
    }
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
    try {
      if (summary) {
        await fetchApi(`tasks/${task_id}/comment`, {
          method: "POST",
          body: JSON.stringify({ body: `COMPLETED: ${summary}` }),
        }).catch(console.error);
      }

      const task = await fetchApi(`tasks/${task_id}/complete`, {
        method: "POST",
        body: JSON.stringify({ pr_url }),
      });
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${(error as Error).message}` }], isError: true };
    }
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
    try {
      await fetchApi(`tasks/${task_id}/comment`, {
        method: "POST",
        body: JSON.stringify({ body: `BLOCKED: ${reason}` }),
      }).catch(console.error);

      const task = await fetchApi(`tasks/${task_id}/block`, { method: "POST" });
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${(error as Error).message}` }], isError: true };
    }
  },
);

server.tool(
  "unclaim_task",
  "Release back to available",
  {
    task_id: z.string(),
  },
  async ({ task_id }) => {
    try {
      const task = await fetchApi(`tasks/${task_id}/unclaim`, { method: "POST" });
      return { content: [{ type: "text", text: JSON.stringify(task, null, 2) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${(error as Error).message}` }], isError: true };
    }
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
    try {
      const comment = await fetchApi(`tasks/${task_id}/comment`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      return { content: [{ type: "text", text: JSON.stringify(comment, null, 2) }] };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${(error as Error).message}` }], isError: true };
    }
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
            base: "main",
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

      const pr = (await response.json()) as { html_url: string; number: number };

      await fetchApi(`tasks/${task_id}/complete`, {
        method: "POST",
        body: JSON.stringify({ pr_url: pr.html_url }),
      }).catch(console.error);

      return {
        content: [
          { type: "text", text: JSON.stringify({ url: pr.html_url, number: pr.number }, null, 2) },
        ],
      };
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${(error as Error).message}` }], isError: true };
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
    try {
      const task = (await fetchApi(`tasks/${task_id}`)) as { pr_url?: string };

      if (!task?.pr_url)
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
    } catch (error: unknown) {
      return { content: [{ type: "text", text: `Error: ${(error as Error).message}` }], isError: true };
    }
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
