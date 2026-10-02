import dotenv from "dotenv";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { accountApiUrl } from "./api-url";
import { agentGuideText, MCP_INSTRUCTIONS } from "./agent-guide";
import { toolDescription, toolShape } from "./tool-schema";

// Every tool's description and input schema come from tool-catalog.ts, which is also what the
// Agents & MCP page and the skill are checked against. Add a tool there first.

// Load environment variables: CWD -> Boared project root -> ~/.boared.env
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.join(os.homedir(), ".boared.env") });

// Setup API connection
const apiUrl =
  process.env.PLANNER_API_URL ||
  (process.env.NODE_ENV === "development"
    ? "http://localhost:3000/api/planner"
    : "https://boared.online/api/planner");
function getApiKey(): string {
  let key = process.env.PLANNER_API_KEY;
  if (!key) {
    dotenv.config();
    dotenv.config({ path: path.resolve(__dirname, "../../.env") });
    dotenv.config({ path: path.join(os.homedir(), ".boared.env") });
    key = process.env.PLANNER_API_KEY;
  }
  if (!key) {
    throw new Error(
      "Missing PLANNER_API_KEY. Create an API key in Boared (Settings -> API keys, or Plan options -> Planner API keys) and set PLANNER_API_KEY in your .env or ~/.boared.env",
    );
  }
  return key;
}

const request = async (
  baseUrl: string,
  path: string,
  options: RequestInit = {},
): Promise<unknown> => {
  const apiKey = getApiKey();
  const url = `${baseUrl}/${path.replace(/^\//, "")}`;
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

const fetchApi = (path: string, options: RequestInit = {}) => request(apiUrl, path, options);

const post = (path: string, body?: unknown) =>
  fetchApi(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

// Projects and tickets live in the workspace API, which needs a key with the account scope.
// The 403 for a planner-only key already says so; it comes back as the tool's error.
const fetchAccount = (path: string, options: RequestInit = {}) =>
  request(accountApiUrl(apiUrl), path, options);

const server = new McpServer(
  { name: "consflow-planner", version: "2.1.0" },
  { instructions: MCP_INSTRUCTIONS },
);

// Tools
const failure = (error: unknown) => ({
  content: [{ type: "text" as const, text: `Error: ${(error as Error).message}` }],
  isError: true,
});

const asText = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

/** Runs a call and answers with its JSON, or with the error as the tool result. */
async function run(action: () => Promise<unknown>) {
  try {
    return asText(await action());
  } catch (error: unknown) {
    return failure(error);
  }
}

/** The agent that claimed a task in this session, so later calls are attributed to it without an id. */
let sessionAgentId: string | undefined;
const asAgent = (agentId?: string) => agentId ?? sessionAgentId;

// ---------------------------------------------------------------------------
// Orient
// ---------------------------------------------------------------------------

server.tool("agent_guide", toolDescription("agent_guide"), toolShape("agent_guide"), async () => ({
  content: [{ type: "text" as const, text: agentGuideText() }],
}));

server.tool("list_plans", toolDescription("list_plans"), toolShape("list_plans"), ({ status }) =>
  run(() => fetchApi(status ? `plans?status=${encodeURIComponent(status)}` : "plans")),
);

server.tool("get_plan", toolDescription("get_plan"), toolShape("get_plan"), ({ plan_id }) =>
  run(() => fetchApi(`plans/${plan_id}`)),
);

server.tool(
  "list_available_tasks",
  toolDescription("list_available_tasks"),
  toolShape("list_available_tasks"),
  ({ plan_id }) => run(() => fetchApi(`plans/${plan_id}/available-tasks`)),
);

server.tool("get_task", toolDescription("get_task"), toolShape("get_task"), ({ task_id }) =>
  run(() => fetchApi(`tasks/${task_id}`)),
);

server.tool(
  "list_task_attachments",
  toolDescription("list_task_attachments"),
  toolShape("list_task_attachments"),
  ({ task_id }) => run(() => fetchApi(`tasks/${task_id}/attachments`)),
);

const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

server.tool(
  "view_task_attachment",
  toolDescription("view_task_attachment"),
  toolShape("view_task_attachment"),
  async ({ task_id, attachment_id }) => {
    try {
      const attachment = (await fetchApi(`tasks/${task_id}/attachments/${attachment_id}`)) as {
        file_name: string;
        mime_type: string | null;
        size_bytes: number | null;
        kind: string;
        marked_up: boolean;
        url: string | null;
      };
      const summary = JSON.stringify(attachment, null, 2);

      const inlineable =
        attachment.url &&
        attachment.kind === "image" &&
        attachment.mime_type !== "image/svg+xml" &&
        (attachment.size_bytes ?? 0) <= MAX_INLINE_IMAGE_BYTES;
      if (!inlineable) return { content: [{ type: "text" as const, text: summary }] };

      const file = await fetch(attachment.url!);
      if (!file.ok) return { content: [{ type: "text" as const, text: summary }] };
      const data = Buffer.from(await file.arrayBuffer()).toString("base64");
      return {
        content: [
          { type: "text" as const, text: summary },
          { type: "image" as const, data, mimeType: attachment.mime_type ?? "image/png" },
        ],
      };
    } catch (error: unknown) {
      return failure(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Work a task
// ---------------------------------------------------------------------------

server.tool(
  "claim_task",
  toolDescription("claim_task"),
  toolShape("claim_task"),
  ({ task_id, agent_name, provider, model }) =>
    run(async () => {
      // Auto-register agent
      const agent = (await post("agents/register", { name: agent_name, provider, model })) as {
        id: string;
      };
      sessionAgentId = agent.id;
      return post(`tasks/${task_id}/claim`, { agent_id: agent.id });
    }),
);

server.tool("start_task", toolDescription("start_task"), toolShape("start_task"), ({ task_id }) =>
  run(() => post(`tasks/${task_id}/start`)),
);

server.tool(
  "report_progress",
  toolDescription("report_progress"),
  toolShape("report_progress"),
  ({ task_id, agent_id, ...progress }) =>
    run(() => post(`tasks/${task_id}/progress`, { ...progress, agent_id: asAgent(agent_id) })),
);

server.tool(
  "complete_task",
  toolDescription("complete_task"),
  toolShape("complete_task"),
  ({ task_id, summary, pr_url, branch_name }) =>
    run(async () => {
      if (summary) {
        await post(`tasks/${task_id}/comment`, {
          body: `COMPLETED: ${summary}`,
          agent_id: sessionAgentId,
        }).catch(console.error);
      }
      return post(`tasks/${task_id}/complete`, { pr_url, branch_name });
    }),
);

server.tool(
  "block_task",
  toolDescription("block_task"),
  toolShape("block_task"),
  ({ task_id, reason, agent_id }) =>
    // The API turns the reason into a blocking question; no separate comment is needed.
    run(() => post(`tasks/${task_id}/block`, { reason, agent_id: asAgent(agent_id) })),
);

server.tool(
  "unclaim_task",
  toolDescription("unclaim_task"),
  toolShape("unclaim_task"),
  ({ task_id }) => run(() => post(`tasks/${task_id}/unclaim`)),
);

server.tool(
  "add_task_comment",
  toolDescription("add_task_comment"),
  toolShape("add_task_comment"),
  ({ task_id, body, agent_id }) =>
    run(() => post(`tasks/${task_id}/comment`, { body, agent_id: asAgent(agent_id) })),
);

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

server.tool(
  "ask_question",
  toolDescription("ask_question"),
  toolShape("ask_question"),
  ({ task_id, body, blocking, agent_id }) =>
    run(() => post(`tasks/${task_id}/questions`, { body, blocking, agent_id: asAgent(agent_id) })),
);

server.tool(
  "list_questions",
  toolDescription("list_questions"),
  toolShape("list_questions"),
  ({ plan_id, task_id, status }) =>
    run(() => {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      if (task_id) return fetchApi(`tasks/${task_id}/questions${query}`);
      if (plan_id) return fetchApi(`plans/${plan_id}/questions${query}`);
      throw new Error("Pass plan_id or task_id.");
    }),
);

server.tool(
  "answer_question",
  toolDescription("answer_question"),
  toolShape("answer_question"),
  ({ task_id, question_id, answer, agent_id }) =>
    run(() =>
      post(`tasks/${task_id}/questions/${question_id}/answer`, {
        answer,
        agent_id: asAgent(agent_id),
      }),
    ),
);

server.tool(
  "dismiss_question",
  toolDescription("dismiss_question"),
  toolShape("dismiss_question"),
  ({ task_id, question_id }) =>
    run(() => post(`tasks/${task_id}/questions/${question_id}/dismiss`)),
);

// ---------------------------------------------------------------------------
// Features and steps
// ---------------------------------------------------------------------------

server.tool(
  "add_task_features",
  toolDescription("add_task_features"),
  toolShape("add_task_features"),
  ({ task_id, agent_id, ...features }) =>
    run(() => post(`tasks/${task_id}/features`, { ...features, agent_id: asAgent(agent_id) })),
);

server.tool(
  "update_task_feature",
  toolDescription("update_task_feature"),
  toolShape("update_task_feature"),
  ({ task_id, feature_id, ...patch }) =>
    run(() => post(`tasks/${task_id}/features/${feature_id}`, patch)),
);

server.tool(
  "add_task_step",
  toolDescription("add_task_step"),
  toolShape("add_task_step"),
  ({ task_id, ...step }) => run(() => post(`tasks/${task_id}/steps`, step)),
);

server.tool(
  "add_task_steps",
  toolDescription("add_task_steps"),
  toolShape("add_task_steps"),
  ({ task_id, agent_id, ...steps }) =>
    run(() => post(`tasks/${task_id}/steps`, { ...steps, agent_id: asAgent(agent_id) })),
);

server.tool(
  "update_task_step",
  toolDescription("update_task_step"),
  toolShape("update_task_step"),
  ({ task_id, step_id, ...patch }) => run(() => post(`tasks/${task_id}/steps/${step_id}`, patch)),
);

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------

server.tool("create_plan", toolDescription("create_plan"), toolShape("create_plan"), (input) =>
  run(() => post("plans", input)),
);

server.tool(
  "import_plan_markdown",
  toolDescription("import_plan_markdown"),
  toolShape("import_plan_markdown"),
  ({ plan_id, markdown, mode }) => run(() => post(`plans/${plan_id}/import`, { markdown, mode })),
);

server.tool(
  "set_plan_status",
  toolDescription("set_plan_status"),
  toolShape("set_plan_status"),
  ({ plan_id, status }) => run(() => post(`plans/${plan_id}/status`, { status })),
);

server.tool(
  "create_section",
  toolDescription("create_section"),
  toolShape("create_section"),
  ({ plan_id, ...section }) => run(() => post(`plans/${plan_id}/sections`, section)),
);

server.tool(
  "update_section",
  toolDescription("update_section"),
  toolShape("update_section"),
  ({ section_id, ...patch }) => run(() => post(`sections/${section_id}`, patch)),
);

server.tool(
  "create_task",
  toolDescription("create_task"),
  toolShape("create_task"),
  ({ plan_id, ...task }) => run(() => post(`plans/${plan_id}/tasks`, task)),
);

server.tool(
  "update_task",
  toolDescription("update_task"),
  toolShape("update_task"),
  ({ task_id, ...patch }) => run(() => post(`tasks/${task_id}`, patch)),
);

// ---------------------------------------------------------------------------
// GitHub
// ---------------------------------------------------------------------------

server.tool(
  "create_pull_request",
  toolDescription("create_pull_request"),
  toolShape("create_pull_request"),
  ({ task_id, head_branch, title, body, repo, base_branch }) =>
    run(async () => {
      const pr = (await post(`tasks/${task_id}/pull-request`, {
        head_branch,
        title,
        body,
        repo,
        base: base_branch,
      })) as { pr_url: string; pr_number: number; base: string; head: string };

      await post(`tasks/${task_id}/complete`, { pr_url: pr.pr_url }).catch(console.error);

      return { url: pr.pr_url, number: pr.pr_number, head: pr.head, base: pr.base };
    }),
);

server.tool(
  "check_pr_status",
  toolDescription("check_pr_status"),
  toolShape("check_pr_status"),
  ({ task_id }) => run(() => fetchApi(`tasks/${task_id}/pull-request`)),
);

server.tool(
  "list_plan_pull_requests",
  toolDescription("list_plan_pull_requests"),
  toolShape("list_plan_pull_requests"),
  ({ plan_id }) => run(() => fetchApi(`plans/${plan_id}/pull-requests`)),
);

server.tool(
  "merge_plan_pull_requests",
  toolDescription("merge_plan_pull_requests"),
  toolShape("merge_plan_pull_requests"),
  ({ plan_id, ...body }) => run(() => post(`plans/${plan_id}/pull-requests/merge`, body)),
);

// ---------------------------------------------------------------------------
// Workspace (account scope)
// ---------------------------------------------------------------------------

server.tool("list_projects", toolDescription("list_projects"), toolShape("list_projects"), () =>
  run(() => fetchAccount("projects")),
);

server.tool(
  "get_project",
  toolDescription("get_project"),
  toolShape("get_project"),
  ({ project_id }) => run(() => fetchAccount(`projects/${project_id}`)),
);

server.tool(
  "list_tickets",
  toolDescription("list_tickets"),
  toolShape("list_tickets"),
  ({ project_id, status }) =>
    run(() => {
      const query = new URLSearchParams();
      if (project_id) query.set("project_id", project_id);
      if (status) query.set("status", status);
      const queryString = query.toString();
      return fetchAccount(queryString ? `tickets?${queryString}` : "tickets");
    }),
);

server.tool("get_ticket", toolDescription("get_ticket"), toolShape("get_ticket"), ({ ticket_id }) =>
  run(() => fetchAccount(`tickets/${ticket_id}`)),
);

server.tool(
  "create_ticket",
  toolDescription("create_ticket"),
  toolShape("create_ticket"),
  (input) => run(() => fetchAccount("tickets", { method: "POST", body: JSON.stringify(input) })),
);

server.tool(
  "update_ticket",
  toolDescription("update_ticket"),
  toolShape("update_ticket"),
  ({ ticket_id, ...patch }) =>
    run(() =>
      fetchAccount(`tickets/${ticket_id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    ),
);

server.tool(
  "create_task_from_ticket",
  toolDescription("create_task_from_ticket"),
  toolShape("create_task_from_ticket"),
  ({ ticket_id, ...body }) =>
    run(() =>
      fetchAccount(`tickets/${ticket_id}/tasks`, { method: "POST", body: JSON.stringify(body) }),
    ),
);

// Run server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Boared Planner MCP server running on stdio");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
