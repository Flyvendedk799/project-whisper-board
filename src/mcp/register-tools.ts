/**
 * Register every planner MCP tool on an McpServer.
 * Names, schemas, and behavior match the previous monolithic server.ts,
 * except hosted-only restrictions (file_path, tool policy) gated via ports.
 */
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { agentGuideText } from "./agent-guide";
import type { PlannerToolPorts } from "./ports";
import { toolDescription, toolShape } from "./tool-schema";

const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;

/** Types the API accepts, by extension, for a file_path without a mime_type. */
const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
};

type UploadOptions = {
  plan_id?: string;
  task_id?: string;
  shared_with_agents?: boolean;
  purpose?: string;
  idempotency_key?: string;
};

const uploadFields = (input: UploadOptions) => ({
  plan_id: input.plan_id,
  task_id: input.task_id,
  shared_with_agents: input.shared_with_agents,
  purpose: input.purpose,
  idempotency_key: input.idempotency_key,
});

const failure = (error: unknown) => ({
  content: [{ type: "text" as const, text: `Error: ${(error as Error).message}` }],
  isError: true,
});

const asText = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

async function run(action: () => Promise<unknown>) {
  try {
    return asText(await action());
  } catch (error: unknown) {
    return failure(error);
  }
}

async function withPolicy(
  ports: PlannerToolPorts,
  toolName: string,
  action: () => Promise<unknown>,
) {
  if (ports.assertToolAllowed) await ports.assertToolAllowed(toolName);
  return run(action);
}

/** Register all catalog tools. Returns the list of registered names (for tests). */
export function registerPlannerTools(server: McpServer, ports: PlannerToolPorts): string[] {
  const { planner, account, resolveAgent, rememberClaim } = ports;
  const registered: string[] = [];

  const tool = (
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (...args: any[]) => any,
  ) => {
    registered.push(name);
    server.tool(name, toolDescription(name), toolShape(name), handler);
  };

  // ---------------------------------------------------------------------------
  // Orient
  // ---------------------------------------------------------------------------

  tool("agent_guide", async () => {
    if (ports.assertToolAllowed) await ports.assertToolAllowed("agent_guide");
    return { content: [{ type: "text" as const, text: agentGuideText() }] };
  });

  tool("list_plans", ({ status }: { status?: string }) =>
    withPolicy(ports, "list_plans", () =>
      planner.get(status ? `plans?status=${encodeURIComponent(status)}` : "plans"),
    ),
  );

  tool("get_plan", ({ plan_id }: { plan_id: string }) =>
    withPolicy(ports, "get_plan", () => planner.get(`plans/${plan_id}`)),
  );

  tool("list_available_tasks", ({ plan_id }: { plan_id: string }) =>
    withPolicy(ports, "list_available_tasks", () =>
      planner.get(`plans/${plan_id}/available-tasks`),
    ),
  );

  tool("get_task", ({ task_id }: { task_id: string }) =>
    withPolicy(ports, "get_task", () => planner.get(`tasks/${task_id}`)),
  );

  tool("list_client_comments", ({ plan_id }: { plan_id: string }) =>
    withPolicy(ports, "list_client_comments", () =>
      planner.get(`plans/${plan_id}/client-comments`),
    ),
  );

  tool("list_people", () => withPolicy(ports, "list_people", () => planner.get("people")));

  tool("list_task_attachments", ({ task_id }: { task_id: string }) =>
    withPolicy(ports, "list_task_attachments", () => planner.get(`tasks/${task_id}/attachments`)),
  );

  tool("list_plan_attachments", ({ plan_id }: { plan_id: string }) =>
    withPolicy(ports, "list_plan_attachments", () => planner.get(`plans/${plan_id}/attachments`)),
  );

  async function viewAttachment(requestPath: string) {
    try {
      const attachment = (await planner.get(requestPath)) as {
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
  }

  tool(
    "view_task_attachment",
    async ({ task_id, attachment_id }: { task_id: string; attachment_id: string }) => {
      if (ports.assertToolAllowed) await ports.assertToolAllowed("view_task_attachment");
      return viewAttachment(`tasks/${task_id}/attachments/${attachment_id}`);
    },
  );

  tool(
    "view_plan_attachment",
    async ({ plan_id, attachment_id }: { plan_id: string; attachment_id: string }) => {
      if (ports.assertToolAllowed) await ports.assertToolAllowed("view_plan_attachment");
      return viewAttachment(`plans/${plan_id}/attachments/${attachment_id}`);
    },
  );

  tool(
    "read_attachment_text",
    ({
      attachment_id,
      offset,
      limit,
    }: {
      attachment_id: string;
      offset?: number;
      limit?: number;
    }) => {
      const query = new URLSearchParams();
      if (offset !== undefined) query.set("offset", String(offset));
      if (limit !== undefined) query.set("limit", String(limit));
      const suffix = query.size > 0 ? `?${query}` : "";
      return withPolicy(ports, "read_attachment_text", () =>
        planner.get(`attachments/${encodeURIComponent(attachment_id)}/text${suffix}`),
      );
    },
  );

  // ---------------------------------------------------------------------------
  // Work a task
  // ---------------------------------------------------------------------------

  tool(
    "claim_task",
    ({
      task_id,
      agent_name,
      provider,
      model,
    }: {
      task_id: string;
      agent_name: string;
      provider?: string;
      model?: string;
    }) =>
      withPolicy(ports, "claim_task", async () => {
        const agent = (await planner.post("agents/register", {
          name: agent_name,
          provider,
          model,
        })) as { id: string };
        rememberClaim(agent.id);
        return planner.post(`tasks/${task_id}/claim`, { agent_id: agent.id });
      }),
  );

  tool("start_task", ({ task_id }: { task_id: string }) =>
    withPolicy(ports, "start_task", () => planner.post(`tasks/${task_id}/start`)),
  );

  tool(
    "report_progress",
    ({
      task_id,
      agent_id,
      ...progress
    }: {
      task_id: string;
      agent_id?: string;
      [key: string]: unknown;
    }) =>
      withPolicy(ports, "report_progress", () =>
        planner.post(`tasks/${task_id}/progress`, {
          ...progress,
          agent_id: resolveAgent(agent_id),
        }),
      ),
  );

  tool(
    "complete_task",
    ({
      task_id,
      summary,
      pr_url,
      branch_name,
    }: {
      task_id: string;
      summary?: string;
      pr_url?: string;
      branch_name?: string;
    }) =>
      withPolicy(ports, "complete_task", async () => {
        if (summary) {
          await planner
            .post(`tasks/${task_id}/comment`, {
              body: `COMPLETED: ${summary}`,
              agent_id: resolveAgent(),
            })
            .catch(console.error);
        }
        return planner.post(`tasks/${task_id}/complete`, { pr_url, branch_name });
      }),
  );

  tool(
    "block_task",
    ({ task_id, reason, agent_id }: { task_id: string; reason: string; agent_id?: string }) =>
      withPolicy(ports, "block_task", () =>
        planner.post(`tasks/${task_id}/block`, { reason, agent_id: resolveAgent(agent_id) }),
      ),
  );

  tool("unclaim_task", ({ task_id }: { task_id: string }) =>
    withPolicy(ports, "unclaim_task", () => planner.post(`tasks/${task_id}/unclaim`)),
  );

  tool(
    "add_task_comment",
    ({ task_id, body, agent_id }: { task_id: string; body: string; agent_id?: string }) =>
      withPolicy(ports, "add_task_comment", () =>
        planner.post(`tasks/${task_id}/comment`, { body, agent_id: resolveAgent(agent_id) }),
      ),
  );

  // ---------------------------------------------------------------------------
  // Questions
  // ---------------------------------------------------------------------------

  tool(
    "ask_question",
    ({
      task_id,
      body,
      blocking,
      audience,
      client_body,
      agent_id,
    }: {
      task_id: string;
      body: string;
      blocking?: boolean;
      audience?: string;
      client_body?: string;
      agent_id?: string;
    }) =>
      withPolicy(ports, "ask_question", () =>
        planner.post(`tasks/${task_id}/questions`, {
          body,
          blocking,
          audience,
          client_body,
          agent_id: resolveAgent(agent_id),
        }),
      ),
  );

  tool(
    "list_questions",
    ({
      plan_id,
      task_id,
      status,
      audience,
    }: {
      plan_id?: string;
      task_id?: string;
      status?: string;
      audience?: string;
    }) =>
      withPolicy(ports, "list_questions", () => {
        const params = new URLSearchParams();
        if (status) params.set("status", status);
        if (audience) params.set("audience", audience);
        const query = params.size > 0 ? `?${params}` : "";
        if (task_id) return planner.get(`tasks/${task_id}/questions${query}`);
        if (plan_id) return planner.get(`plans/${plan_id}/questions${query}`);
        throw new Error("Pass plan_id or task_id.");
      }),
  );

  tool(
    "answer_question",
    ({
      task_id,
      question_id,
      answer,
      agent_id,
    }: {
      task_id: string;
      question_id: string;
      answer: string;
      agent_id?: string;
    }) =>
      withPolicy(ports, "answer_question", () =>
        planner.post(`tasks/${task_id}/questions/${question_id}/answer`, {
          answer,
          agent_id: resolveAgent(agent_id),
        }),
      ),
  );

  tool(
    "set_question_audience",
    ({
      question_id,
      audience,
      client_body,
    }: {
      question_id: string;
      audience: string;
      client_body?: string;
    }) =>
      withPolicy(ports, "set_question_audience", () =>
        planner.post(`questions/${question_id}/audience`, { audience, client_body }),
      ),
  );

  tool("dismiss_question", ({ task_id, question_id }: { task_id: string; question_id: string }) =>
    withPolicy(ports, "dismiss_question", () =>
      planner.post(`tasks/${task_id}/questions/${question_id}/dismiss`),
    ),
  );

  // ---------------------------------------------------------------------------
  // Features and steps
  // ---------------------------------------------------------------------------

  tool(
    "add_task_features",
    ({
      task_id,
      agent_id,
      ...features
    }: {
      task_id: string;
      agent_id?: string;
      [key: string]: unknown;
    }) =>
      withPolicy(ports, "add_task_features", () =>
        planner.post(`tasks/${task_id}/features`, {
          ...features,
          agent_id: resolveAgent(agent_id),
        }),
      ),
  );

  tool(
    "update_task_feature",
    ({
      task_id,
      feature_id,
      ...patch
    }: {
      task_id: string;
      feature_id: string;
      [key: string]: unknown;
    }) =>
      withPolicy(ports, "update_task_feature", () =>
        planner.post(`tasks/${task_id}/features/${feature_id}`, patch),
      ),
  );

  tool("add_task_step", ({ task_id, ...step }: { task_id: string; [key: string]: unknown }) =>
    withPolicy(ports, "add_task_step", () => planner.post(`tasks/${task_id}/steps`, step)),
  );

  tool(
    "add_task_steps",
    ({
      task_id,
      agent_id,
      ...steps
    }: {
      task_id: string;
      agent_id?: string;
      [key: string]: unknown;
    }) =>
      withPolicy(ports, "add_task_steps", () =>
        planner.post(`tasks/${task_id}/steps`, { ...steps, agent_id: resolveAgent(agent_id) }),
      ),
  );

  tool(
    "update_task_step",
    ({
      task_id,
      step_id,
      ...patch
    }: {
      task_id: string;
      step_id: string;
      [key: string]: unknown;
    }) =>
      withPolicy(ports, "update_task_step", () =>
        planner.post(`tasks/${task_id}/steps/${step_id}`, patch),
      ),
  );

  // ---------------------------------------------------------------------------
  // Authoring
  // ---------------------------------------------------------------------------

  tool("create_plan", (input: Record<string, unknown>) =>
    withPolicy(ports, "create_plan", () => planner.post("plans", input)),
  );

  tool("update_plan", ({ plan_id, ...patch }: { plan_id: string; [key: string]: unknown }) =>
    withPolicy(ports, "update_plan", () => planner.post(`plans/${plan_id}`, patch)),
  );

  tool(
    "import_plan_markdown",
    ({ plan_id, markdown, mode }: { plan_id: string; markdown: string; mode?: string }) =>
      withPolicy(ports, "import_plan_markdown", () =>
        planner.post(`plans/${plan_id}/import`, { markdown, mode }),
      ),
  );

  tool(
    "upload_attachment_text",
    (input: UploadOptions & { file_name: string; text: string; mime_type?: string }) =>
      withPolicy(ports, "upload_attachment_text", () =>
        planner.post("attachments/text", {
          ...uploadFields(input),
          file_name: input.file_name,
          mime_type:
            input.mime_type ??
            (/\.(md|markdown)$/i.test(input.file_name) ? "text/markdown" : "text/plain"),
          text: input.text,
        }),
      ),
  );

  tool(
    "upload_attachment_base64",
    (
      input: UploadOptions & {
        file_name?: string;
        mime_type?: string;
        data_base64?: string;
        file_path?: string;
      },
    ) =>
      withPolicy(ports, "upload_attachment_base64", async () => {
        if (Boolean(input.data_base64) === Boolean(input.file_path)) {
          throw new Error("Give the content as data_base64 or as file_path, not both.");
        }
        let data = input.data_base64;
        let fileName = input.file_name;
        if (input.file_path) {
          if (!ports.readLocalUpload) {
            throw new Error(
              "file_path uploads are only available over the local stdio MCP server, not hosted HTTP.",
            );
          }
          const local = await ports.readLocalUpload(input.file_path);
          data = local.dataBase64;
          fileName = fileName ?? local.fileName;
        }
        if (!fileName) throw new Error("file_name is required with data_base64.");
        const mimeType = input.mime_type ?? MIME_BY_EXTENSION[path.extname(fileName).toLowerCase()];
        if (!mimeType) {
          throw new Error(
            "Pass mime_type: the file name's extension does not say which allowed type it is.",
          );
        }
        return planner.post("attachments/base64", {
          ...uploadFields(input),
          file_name: fileName,
          mime_type: mimeType,
          data_base64: data,
        });
      }),
  );

  tool("set_plan_status", ({ plan_id, status }: { plan_id: string; status: string }) =>
    withPolicy(ports, "set_plan_status", () => planner.post(`plans/${plan_id}/status`, { status })),
  );

  tool("create_section", ({ plan_id, ...section }: { plan_id: string; [key: string]: unknown }) =>
    withPolicy(ports, "create_section", () => planner.post(`plans/${plan_id}/sections`, section)),
  );

  tool(
    "update_section",
    ({ section_id, ...patch }: { section_id: string; [key: string]: unknown }) =>
      withPolicy(ports, "update_section", () => planner.post(`sections/${section_id}`, patch)),
  );

  tool("create_task", ({ plan_id, ...task }: { plan_id: string; [key: string]: unknown }) =>
    withPolicy(ports, "create_task", () => planner.post(`plans/${plan_id}/tasks`, task)),
  );

  tool("update_task", ({ task_id, ...patch }: { task_id: string; [key: string]: unknown }) =>
    withPolicy(ports, "update_task", () => planner.post(`tasks/${task_id}`, patch)),
  );

  // ---------------------------------------------------------------------------
  // GitHub
  // ---------------------------------------------------------------------------

  tool(
    "create_pull_request",
    ({
      task_id,
      head_branch,
      title,
      body,
      repo,
      base_branch,
    }: {
      task_id: string;
      head_branch?: string;
      title: string;
      body?: string;
      repo?: string;
      base_branch?: string;
    }) =>
      withPolicy(ports, "create_pull_request", async () => {
        const pr = (await planner.post(`tasks/${task_id}/pull-request`, {
          head_branch,
          title,
          body,
          repo,
          base: base_branch,
        })) as { pr_url: string; pr_number: number; base: string; head: string };

        await planner.post(`tasks/${task_id}/complete`, { pr_url: pr.pr_url }).catch(console.error);

        return { url: pr.pr_url, number: pr.pr_number, head: pr.head, base: pr.base };
      }),
  );

  tool("github_status", () => withPolicy(ports, "github_status", () => planner.get("github")));

  tool("check_pr_status", ({ task_id }: { task_id: string }) =>
    withPolicy(ports, "check_pr_status", () => planner.get(`tasks/${task_id}/pull-request`)),
  );

  tool("list_plan_pull_requests", ({ plan_id }: { plan_id: string }) =>
    withPolicy(ports, "list_plan_pull_requests", () =>
      planner.get(`plans/${plan_id}/pull-requests`),
    ),
  );

  tool(
    "merge_plan_pull_requests",
    ({ plan_id, ...body }: { plan_id: string; [key: string]: unknown }) =>
      withPolicy(ports, "merge_plan_pull_requests", () =>
        planner.post(`plans/${plan_id}/pull-requests/merge`, body),
      ),
  );

  // ---------------------------------------------------------------------------
  // Workspace (account scope)
  // ---------------------------------------------------------------------------

  tool("get_workspace", () => withPolicy(ports, "get_workspace", () => account.get("workspace")));

  tool("list_projects", () => withPolicy(ports, "list_projects", () => account.get("projects")));

  tool("get_project", ({ project_id }: { project_id: string }) =>
    withPolicy(ports, "get_project", () => account.get(`projects/${project_id}`)),
  );

  tool(
    "update_project",
    ({ project_id, ...patch }: { project_id: string; [key: string]: unknown }) =>
      withPolicy(ports, "update_project", () =>
        account.request(`projects/${project_id}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        }),
      ),
  );

  tool("list_tickets", ({ project_id, status }: { project_id?: string; status?: string }) =>
    withPolicy(ports, "list_tickets", () => {
      const query = new URLSearchParams();
      if (project_id) query.set("project_id", project_id);
      if (status) query.set("status", status);
      const queryString = query.toString();
      return account.get(queryString ? `tickets?${queryString}` : "tickets");
    }),
  );

  tool("get_ticket", ({ ticket_id }: { ticket_id: string }) =>
    withPolicy(ports, "get_ticket", () => account.get(`tickets/${ticket_id}`)),
  );

  tool("create_ticket", (input: Record<string, unknown>) =>
    withPolicy(ports, "create_ticket", () =>
      account.request("tickets", { method: "POST", body: JSON.stringify(input) }),
    ),
  );

  tool("update_ticket", ({ ticket_id, ...patch }: { ticket_id: string; [key: string]: unknown }) =>
    withPolicy(ports, "update_ticket", () =>
      account.request(`tickets/${ticket_id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    ),
  );

  tool(
    "create_task_from_ticket",
    ({ ticket_id, ...body }: { ticket_id: string; [key: string]: unknown }) =>
      withPolicy(ports, "create_task_from_ticket", () =>
        account.request(`tickets/${ticket_id}/tasks`, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      ),
  );

  return registered;
}
