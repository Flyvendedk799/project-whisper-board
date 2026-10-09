/**
 * Every tool the Boared MCP server offers, described once.
 *
 * `server.ts` takes each tool's description and input schema from here, the
 * Agents & MCP page renders it, and `tool-catalog.test.ts` fails when a tool in
 * `server.ts` is missing here, when an entry here has no tool, or when the skill
 * does not mention one. Adding a tool means adding it here, and the docs follow.
 *
 * Plain data and no imports, so the browser and the stdio server both load it.
 * Paths are relative to the planner API (`/api/planner`), or to the workspace API
 * (`/api/v1`) for a tool whose `rest.api` is `"account"`.
 */

/** `"(string | object)[]"` is a list whose entries are texts or small objects, e.g. `{ text, client_text }`. */
export type ParamType = "string" | "integer" | "boolean" | "string[]" | "(string | object)[]";

/**
 * Which REST API a tool calls. A `planner` key reaches the planner tools only; the `account`
 * tools (projects and tickets) need a key with the account scope.
 */
export type RestApi = "planner" | "account";

export const REST_API_BASE: Record<RestApi, string> = {
  planner: "/api/planner",
  account: "/api/v1",
};

export interface ToolParam {
  name: string;
  type: ParamType;
  required?: boolean;
  /** Allowed values, for a string that is one of a few words. */
  enum?: readonly string[];
  description: string;
}

export const TOOL_GROUPS = [
  "Orient",
  "Work a task",
  "Questions",
  "Features and steps",
  "Authoring",
  "GitHub",
  "Workspace",
] as const;

export type ToolGroup = (typeof TOOL_GROUPS)[number];

export interface CatalogTool {
  name: string;
  group: ToolGroup;
  /** One line, for lists. */
  summary: string;
  /** What the MCP client shows the model; defaults to the summary. */
  description?: string;
  /** The REST call behind it, or null when there is none (`agent_guide`). */
  rest: { method: "GET" | "POST" | "PATCH"; path: string; api?: RestApi } | null;
  /** What else the tool does around that call. */
  notes?: string;
  params: readonly ToolParam[];
}

const PLAN_STATUSES = ["draft", "active", "paused", "completed", "archived"] as const;
const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const COMPLEXITIES = ["trivial", "small", "medium", "large", "epic"] as const;
const PROJECT_STATUSES = [
  "discovery",
  "proposal",
  "in_progress",
  "review",
  "done",
  "archived",
] as const;
const TICKET_STATUSES = [
  "open",
  "triaged",
  "in_progress",
  "in_review",
  "done",
  "wont_fix",
] as const;
const TICKET_TYPES = ["bug", "feature", "question", "feedback", "change_request"] as const;
const TICKET_PRIORITIES = ["low", "medium", "high", "urgent"] as const;

const TASK_ID: ToolParam = {
  name: "task_id",
  type: "string",
  required: true,
  description: "The ID of the task (from get_plan or get_task)",
};
const PLAN_ID: ToolParam = {
  name: "plan_id",
  type: "string",
  required: true,
  description: "The ID of the plan",
};
const SECTION_ID: ToolParam = {
  name: "section_id",
  type: "string",
  required: true,
  description: "The ID of the section (from get_plan)",
};
const PROJECT_ID: ToolParam = {
  name: "project_id",
  type: "string",
  required: true,
  description: "The ID of the project (from list_projects)",
};
const TICKET_ID: ToolParam = {
  name: "ticket_id",
  type: "string",
  required: true,
  description: "The ID of the ticket (from list_tickets)",
};
const AGENT_ID: ToolParam = {
  name: "agent_id",
  type: "string",
  description:
    "The agent acting. Defaults to the agent that claimed a task in this session, so you rarely pass it.",
};
/** Where an uploaded file goes: exactly one of the two. */
const ATTACHMENT_TARGET: readonly ToolParam[] = [
  {
    name: "plan_id",
    type: "string",
    description: "Attach to the plan as a whole. Give this or task_id, not both.",
  },
  {
    name: "task_id",
    type: "string",
    description: "Attach to this task. Give this or plan_id, not both.",
  },
];
const ATTACHMENT_OPTIONS: readonly ToolParam[] = [
  {
    name: "shared_with_agents",
    type: "boolean",
    description: "Whether agents can see the file (default true)",
  },
  {
    name: "purpose",
    type: "string",
    description: "A short note on why the file is attached, recorded in the plan's activity",
  },
  {
    name: "idempotency_key",
    type: "string",
    description:
      "Any string unique to this upload. Retrying with the same key and file returns the first attachment.",
  },
];
const COLOR: ToolParam = {
  name: "color",
  type: "string",
  description: "A hex colour like #3b82f6 or a design token like var(--chart-1)",
};
const CLIENT_SUMMARY: ToolParam = {
  name: "client_summary",
  type: "string",
  description:
    "Short plain DANISH summary a client can read: 1-3 sentences on what is done and what comes next, no jargon, task IDs, branch names or code. Clients of a client-view plan only see this, the title and progress. Send an empty string to clear it.",
};
const CLIENT_TITLE: ToolParam = {
  name: "client_title",
  type: "string",
  description:
    "The task as the client reads it: a SHORT plain DANISH name (up to 200 characters), no jargon, task IDs, branch names, PR numbers or code. A task is shown to clients ONLY when it has a client_title. Send an empty string to clear it.",
};
const CLIENT_TASK_SUMMARY: ToolParam = {
  name: "client_summary",
  type: "string",
  description:
    "Optional one plain DANISH sentence (up to 1000 characters) that explains the task to the client: the outcome, not how it was built. Only shown when the task has a client_title. Send an empty string to clear it.",
};
const CLIENT_TEXT: ToolParam = {
  name: "client_text",
  type: "string",
  description:
    "The step as the client reads it: plain DANISH, no jargon (up to 300 characters). A step is shown to clients ONLY when it has a client_text. Send an empty string to clear it.",
};
const QUESTION_AUDIENCES = ["agency", "agent", "client"] as const;
const CLIENT_BODY: ToolParam = {
  name: "client_body",
  type: "string",
  description:
    "The question as the client reads it: short plain DANISH a non-technical person understands (up to 2000 characters), no jargon, task IDs, branch names or code. REQUIRED and non-empty when the audience is client; the client sees the question ONLY then. Send an empty string to clear it.",
};
const FEATURE_CLIENT_TEXT: ToolParam = {
  name: "client_text",
  type: "string",
  description:
    "The deliverable as the client reads it: plain DANISH, no jargon (up to 300 characters). A feature is shown to clients ONLY when it has a client_text, and it is the client's list of what is still missing. Send an empty string to clear it.",
};
const TAGS: ToolParam = {
  name: "tags",
  type: "string[]",
  description: "Short words, lower-cased and hyphenated for you (up to 20 are kept)",
};

export const TOOL_CATALOG: readonly CatalogTool[] = [
  // -------------------------------------------------------------------------
  // Orient
  // -------------------------------------------------------------------------
  {
    name: "agent_guide",
    group: "Orient",
    summary: "How to work a task: claim, progress, questions, work branch, finish.",
    description:
      "Return the workflow for working a Boared task: claim first, tick steps and features as you go, comment only when it matters, ask instead of guessing, check the work branch, finish with a result. Read it once at the start.",
    rest: null,
    notes: "Returns text, no request is made.",
    params: [],
  },
  {
    name: "list_plans",
    group: "Orient",
    summary: "List plans. Only active plans unless you pass a status.",
    description:
      "List plans. Only active plans by default; pass status (draft, active, paused, completed, archived, a comma list, or all) to see the rest.",
    rest: { method: "GET", path: "plans?status=" },
    params: [
      {
        name: "status",
        type: "string",
        description: 'Plan status filter: one status, a comma list, or "all". Defaults to active.',
      },
    ],
  },
  {
    name: "get_plan",
    group: "Orient",
    summary:
      "A plan with its sections, tasks, features, steps and questions, its own files and its work_target.",
    description:
      "Get a plan with its sections (goals, intentions, client_summary, tags, colour) and tasks (tags as labels, colour, client_title, client_summary, ai_context, features, features with client_text, steps with feature_id and client_text, questions with audience, client_body, from_client and who asked and answered). `attachments` on the plan are the files shared with agents that belong to the whole plan (a brief, a spec); each task has its own. work_target says where commits go: repo, base, branch, mode and a summary.",
    rest: { method: "GET", path: "plans/:plan_id" },
    params: [PLAN_ID],
  },
  {
    name: "list_available_tasks",
    group: "Orient",
    summary: "Available tasks whose dependencies are done.",
    description:
      "Tasks you can claim now: status available and every dependency done. Each comes with its features, steps and questions.",
    rest: { method: "GET", path: "plans/:plan_id/available-tasks" },
    params: [PLAN_ID],
  },
  {
    name: "get_task",
    group: "Orient",
    summary: "One task in full, with features, steps, questions, files and work_target.",
    description:
      "Get a task: description, acceptance criteria, tags (labels), colour, client_title and client_summary (what clients read), ai_context, features (with client_text), steps (with feature_id and client_text), questions (with audience, client_body, from_client, who asked and answered, and the client's answer), the files shared with agents, and the plan's work_target.",
    rest: { method: "GET", path: "tasks/:task_id" },
    params: [TASK_ID],
  },
  {
    name: "list_people",
    group: "Orient",
    summary: "Who is in the workspace: ids to assign tasks to and to @mention.",
    description:
      "List the workspace's people: user_id, name, role, and mention, the exact token to put in a comment to @mention them (it notifies them). Use a user_id as assigned_user_id on create_task or update_task.",
    rest: { method: "GET", path: "people" },
    params: [],
  },
  {
    name: "list_client_comments",
    group: "Orient",
    summary: "What the client said: their comments and which sections they approved.",
    description:
      "Read the client's feedback on a plan before you work: their comments (on the plan, a section or a task, oldest first, with who wrote them) and the sections they approved. Read-only; clients write these in the app. Their answers to questions put to them are in get_task, not here.",
    rest: { method: "GET", path: "plans/:plan_id/client-comments" },
    params: [PLAN_ID],
  },
  {
    name: "list_task_attachments",
    group: "Orient",
    summary: "Files the team shared with agents on a task.",
    description:
      "Files the team shared with agents on a task (screenshots, recordings, documents). Hidden files are never listed. URLs expire in an hour.",
    rest: { method: "GET", path: "tasks/:task_id/attachments" },
    params: [TASK_ID],
  },
  {
    name: "view_task_attachment",
    group: "Orient",
    summary: "Look at a shared attachment: images come back as images.",
    description:
      "Look at a shared task attachment. Images come back as images; other files come back as a signed URL to download.",
    rest: { method: "GET", path: "tasks/:task_id/attachments/:attachment_id" },
    notes: "Downloads an image under 5 MB and returns it inline.",
    params: [
      TASK_ID,
      {
        name: "attachment_id",
        type: "string",
        required: true,
        description: "The ID of the attachment, from list_task_attachments",
      },
    ],
  },

  {
    name: "list_plan_attachments",
    group: "Orient",
    summary: "Files the team shared with agents on the plan itself.",
    description:
      "Files the team shared with agents on the plan as a whole (a brief, a spec, a design), as opposed to on one task. Read these before you start: they apply to every task. Hidden files are never listed. URLs expire in an hour.",
    rest: { method: "GET", path: "plans/:plan_id/attachments" },
    params: [PLAN_ID],
  },
  {
    name: "view_plan_attachment",
    group: "Orient",
    summary: "Look at a file on the plan itself: images come back as images.",
    description:
      "Look at a shared file on the plan itself. Images come back as images; other files come back as a signed URL to download.",
    rest: { method: "GET", path: "plans/:plan_id/attachments/:attachment_id" },
    notes: "Downloads an image under 5 MB and returns it inline.",
    params: [
      PLAN_ID,
      {
        name: "attachment_id",
        type: "string",
        required: true,
        description: "The ID of the attachment, from list_plan_attachments",
      },
    ],
  },
  {
    name: "read_attachment_text",
    group: "Orient",
    summary: "Read a shared Markdown or plain-text file as text, a page at a time.",
    description:
      "Read the text of a Markdown or plain-text file shared with agents (on a plan or a task), without downloading it. Pages are measured in bytes of UTF-8 and never split a character: pass next_offset as offset until eof is true. sha256 is of the whole file. Other file types answer 415; use view_task_attachment or view_plan_attachment for those.",
    rest: { method: "GET", path: "attachments/:attachment_id/text?offset=&limit=" },
    params: [
      {
        name: "attachment_id",
        type: "string",
        required: true,
        description:
          "The ID of the attachment, from list_plan_attachments, list_task_attachments or get_plan",
      },
      {
        name: "offset",
        type: "integer",
        description: "Byte offset to start at (default 0). Use next_offset from the previous page.",
      },
      {
        name: "limit",
        type: "integer",
        description: "Bytes to read, 1 to 262144 (default 65536)",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Work a task
  // -------------------------------------------------------------------------
  {
    name: "claim_task",
    group: "Work a task",
    summary: "Claim an available task before working on it. Registers you as an agent.",
    description:
      "Claim an available task so no other agent starts it. Registers the agent if needed and remembers it for the rest of the session. Fails with a conflict if the task is not available.",
    rest: { method: "POST", path: "tasks/:task_id/claim" },
    notes:
      "First registers the agent with POST agents/register (same name, provider and model is the same agent).",
    params: [
      TASK_ID,
      {
        name: "agent_name",
        type: "string",
        required: true,
        description: "Your name, e.g. Claude Code",
      },
      {
        name: "provider",
        type: "string",
        required: true,
        description: "anthropic, google, openai, ...",
      },
      { name: "model", type: "string", description: "The model you run on" },
    ],
  },
  {
    name: "start_task",
    group: "Work a task",
    summary: "Mark a claimed task in progress.",
    rest: { method: "POST", path: "tasks/:task_id/start" },
    params: [TASK_ID],
  },
  {
    name: "report_progress",
    group: "Work a task",
    summary:
      "One call to update status, tick steps, mark features met and, only if worth saying, comment.",
    description:
      "The progress call: set the status (in_progress, in_review, done), tick steps (steps_done) and mark features met (features_met), all at once. A comment is posted ONLY when note is not empty, so leave it out unless there is a decision, a blocker or a result worth saying. Claim the task first. Ids are checked before anything is written. Returns the task, step and feature counts, and hints about what is still open.",
    rest: { method: "POST", path: "tasks/:task_id/progress" },
    params: [
      TASK_ID,
      {
        name: "status",
        type: "string",
        enum: ["claimed", "in_progress", "in_review", "done"],
        description: "New status. To block, ask a blocking question instead.",
      },
      {
        name: "steps_done",
        type: "string[]",
        description: "IDs of steps to tick (from get_task)",
      },
      {
        name: "features_met",
        type: "string[]",
        description: "IDs of features the work now satisfies (from get_task)",
      },
      {
        name: "note",
        type: "string",
        description:
          "A comment for the discussion. Only posted when not empty. Max 5000 characters. @mention someone with their token from list_people.",
      },
      AGENT_ID,
    ],
  },
  {
    name: "complete_task",
    group: "Work a task",
    summary: "Mark a task done, with an optional summary, PR URL and branch.",
    description:
      "Mark a task done. A summary becomes a comment (use it for the result, not for narration). The PR number is read from pr_url so the board shows PR #n. Mark features met and tick steps first.",
    rest: { method: "POST", path: "tasks/:task_id/complete" },
    notes: "With a summary it first posts a comment through POST tasks/:task_id/comment.",
    params: [
      TASK_ID,
      { name: "summary", type: "string", description: "What was done, in a few lines" },
      {
        name: "pr_url",
        type: "string",
        description: "Pull request URL; its number is read from it so the board shows PR #n",
      },
      { name: "branch_name", type: "string", description: "The branch the work is on" },
      {
        name: "assigned_user_id",
        type: "string",
        description: "Assign it to a teammate (a user_id from list_people); they are notified",
      },
    ],
  },
  {
    name: "block_task",
    group: "Work a task",
    summary: "Block a task with a reason: it becomes a blocking question a person can answer.",
    description:
      "Block a task. The reason is posted as a BLOCKING question, so a person sees something to answer and the task returns to where it was once they do. Use ask_question with blocking true for the same thing with more control.",
    rest: { method: "POST", path: "tasks/:task_id/block" },
    params: [
      TASK_ID,
      {
        name: "reason",
        type: "string",
        required: true,
        description: "What you need, as a question or a blocker",
      },
      AGENT_ID,
    ],
  },
  {
    name: "unclaim_task",
    group: "Work a task",
    summary: "Release a task back to available.",
    rest: { method: "POST", path: "tasks/:task_id/unclaim" },
    params: [TASK_ID],
  },
  {
    name: "add_task_comment",
    group: "Work a task",
    summary: "Post a comment. Only for a decision, a blocker or a result.",
    description:
      "Post a comment on a task. Use it for a decision, a blocker or a result, not for narrating progress: report_progress covers that.",
    rest: { method: "POST", path: "tasks/:task_id/comment" },
    params: [
      TASK_ID,
      {
        name: "body",
        type: "string",
        required: true,
        description:
          "The comment. To @mention someone (they are notified), include their mention token from list_people, e.g. @[Ada Lovelace](user:<user_id>).",
      },
      AGENT_ID,
    ],
  },

  // -------------------------------------------------------------------------
  // Questions
  // -------------------------------------------------------------------------
  {
    name: "ask_question",
    group: "Questions",
    summary: "Ask a question about a task. Blocking only if you cannot proceed.",
    description:
      "Ask a question on a task instead of guessing. A blocking question puts the task in blocked until someone answers (then it goes back where it was); a non-blocking one just asks and you carry on. People can ask too: list_questions shows both. audience says who has to answer: agency (the default: the human operator), agent (another AI agent) or client (the client must decide or answer; needs a Danish client_body, and the client is notified).",
    rest: { method: "POST", path: "tasks/:task_id/questions" },
    params: [
      TASK_ID,
      {
        name: "body",
        type: "string",
        required: true,
        description: "The question (up to 2000 characters)",
      },
      {
        name: "blocking",
        type: "boolean",
        description:
          "True only if you truly cannot continue without the answer. Defaults to false.",
      },
      {
        name: "audience",
        type: "string",
        enum: QUESTION_AUDIENCES,
        description:
          "Who answers: agency (default, the human operator), agent (hand it to another AI agent) or client (only for what the client must decide or answer; needs client_body)",
      },
      CLIENT_BODY,
      AGENT_ID,
    ],
  },
  {
    name: "list_questions",
    group: "Questions",
    summary: "Questions on a plan or a task, with who asked and who answered.",
    description:
      "List questions with who asked and who answered. Pass plan_id for a whole plan (open ones by default) or task_id for one task (all by default). audience narrows it to the questions for the agency, the agents or the client. Each question has audience, client_body and from_client (the client asked it).",
    rest: {
      method: "GET",
      path: "plans/:plan_id/questions?status=&audience= or tasks/:task_id/questions",
    },
    params: [
      { name: "plan_id", type: "string", description: "All questions on this plan" },
      { name: "task_id", type: "string", description: "Questions on this task" },
      {
        name: "status",
        type: "string",
        enum: ["open", "answered", "dismissed", "all"],
        description: "Defaults to open for a plan and all for a task",
      },
      {
        name: "audience",
        type: "string",
        description:
          "Only questions for this audience: agency, agent, client, a comma list like agent,client, or all (the default)",
      },
    ],
  },
  {
    name: "set_question_audience",
    group: "Questions",
    summary: "Aim an open question at the agency, an agent or the client (and back).",
    description:
      "Re-aim an open question: agency (the human operator, the default), agent (another AI agent) or client. Switching to client needs a plain-Danish client_body (sent now, or already on the question) and notifies the client; use this instead of asking again. Switch it back to agency any time. answer_question works for any audience.",
    rest: { method: "POST", path: "questions/:question_id/audience" },
    params: [
      {
        name: "question_id",
        type: "string",
        required: true,
        description: "The ID of the question (from get_task or list_questions)",
      },
      {
        name: "audience",
        type: "string",
        required: true,
        enum: QUESTION_AUDIENCES,
        description: "Who has to answer now: agency, agent or client",
      },
      CLIENT_BODY,
    ],
  },
  {
    name: "answer_question",
    group: "Questions",
    summary: "Answer an open question. Answering the last blocking one frees the task.",
    rest: { method: "POST", path: "tasks/:task_id/questions/:question_id/answer" },
    params: [
      TASK_ID,
      {
        name: "question_id",
        type: "string",
        required: true,
        description: "The ID of the question",
      },
      {
        name: "answer",
        type: "string",
        required: true,
        description: "The answer (up to 5000 characters)",
      },
      AGENT_ID,
    ],
  },
  {
    name: "dismiss_question",
    group: "Questions",
    summary: "Dismiss an open question nobody needs to answer any more.",
    rest: { method: "POST", path: "tasks/:task_id/questions/:question_id/dismiss" },
    params: [
      TASK_ID,
      {
        name: "question_id",
        type: "string",
        required: true,
        description: "The ID of the question",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Features and steps
  // -------------------------------------------------------------------------
  {
    name: "add_task_features",
    group: "Features and steps",
    summary: "Add features (requirements) to a task.",
    description:
      "Add features to the end of a task's feature list: what the task must deliver. Pass items (one per feature) or text (one per line; bullets, numbers and [ ] are understood). An item can also be { text, client_text } to give that feature its plain-Danish wording; a client sees a feature ONLY when it has client_text (set it later with update_task_feature).",
    rest: { method: "POST", path: "tasks/:task_id/features" },
    params: [
      TASK_ID,
      {
        name: "items",
        type: "(string | object)[]",
        description:
          "One feature per entry: a text, or { text, client_text? } to also set the plain-Danish client text",
      },
      { name: "text", type: "string", description: "Features, one per line" },
      FEATURE_CLIENT_TEXT,
      AGENT_ID,
    ],
  },
  {
    name: "update_task_feature",
    group: "Features and steps",
    summary: "Mark a feature met when the work satisfies it, reword it, or set its client text.",
    rest: { method: "POST", path: "tasks/:task_id/features/:feature_id" },
    params: [
      TASK_ID,
      {
        name: "feature_id",
        type: "string",
        required: true,
        description: "The ID of the feature, from get_task",
      },
      { name: "met", type: "boolean", description: "True when the work satisfies it" },
      { name: "text", type: "string", description: "New wording" },
      {
        ...FEATURE_CLIENT_TEXT,
        description: `New client text. ${FEATURE_CLIENT_TEXT.description}`,
      },
    ],
  },
  {
    name: "add_task_step",
    group: "Features and steps",
    summary: "Add a sub-step to the end of a task's checklist.",
    description:
      "Add a sub-step to the end of a task's checklist. Point it at the feature it delivers with feature_id. Several lines in text become several steps (indent two spaces to nest). client_text (plain Danish, for a single step) is what a client sees of the step; a step without it stays hidden from clients.",
    rest: { method: "POST", path: "tasks/:task_id/steps" },
    params: [
      TASK_ID,
      { name: "text", type: "string", required: true, description: "The step" },
      CLIENT_TEXT,
      { name: "feature_id", type: "string", description: "The feature this step delivers" },
      { name: "depth", type: "integer", description: "Nesting level, 0 to 3" },
    ],
  },
  {
    name: "add_task_steps",
    group: "Features and steps",
    summary: "Add several sub-steps at once, optionally all for one feature.",
    description:
      "Add several sub-steps to a task at once. Pass items (one per step) or text (one per line, indented two spaces per level). feature_id links every one to the same feature. An item can also be { text, client_text } to give that step its plain-Danish client text; steps without client_text stay hidden from clients (set it later with update_task_step).",
    rest: { method: "POST", path: "tasks/:task_id/steps" },
    params: [
      TASK_ID,
      {
        name: "items",
        type: "(string | object)[]",
        description:
          "One step per entry: a text, or { text, client_text?, depth?, done? } to also set the plain-Danish client text",
      },
      { name: "text", type: "string", description: "Steps, one per line" },
      { name: "feature_id", type: "string", description: "The feature these steps deliver" },
      AGENT_ID,
    ],
  },
  {
    name: "update_task_step",
    group: "Features and steps",
    summary: "Tick or untick a sub-step, reword it, set its client text, or link it to a feature.",
    rest: { method: "POST", path: "tasks/:task_id/steps/:step_id" },
    params: [
      TASK_ID,
      {
        name: "step_id",
        type: "string",
        required: true,
        description: "The ID of the step, from get_task",
      },
      { name: "done", type: "boolean", description: "Ticked or not" },
      { name: "text", type: "string", description: "New wording" },
      { ...CLIENT_TEXT, description: `New client text. ${CLIENT_TEXT.description}` },
      { name: "feature_id", type: "string", description: "The feature this step delivers" },
    ],
  },

  // -------------------------------------------------------------------------
  // Authoring
  // -------------------------------------------------------------------------
  {
    name: "create_plan",
    group: "Authoring",
    summary: "Create a plan, optionally filled from a markdown document.",
    description:
      "Create a plan. Pass markdown to fill it from a document in the same call: headings become sections and tasks, prose and tables are kept as descriptions, and the result reports any source line that did not land. github_work_mode says where the work lands: new (a branch of its own), existing, or base (straight on the base branch, no PR).",
    rest: { method: "POST", path: "plans" },
    params: [
      { name: "title", type: "string", required: true, description: "Plan title" },
      { name: "description", type: "string", description: "What the plan is for" },
      { name: "markdown", type: "string", description: "The plan document, as markdown" },
      { name: "github_repo", type: "string", description: "owner/repo the work lands in" },
      {
        name: "github_base",
        type: "string",
        description: "The base branch; defaults to the project's",
      },
      {
        name: "github_work_mode",
        type: "string",
        enum: ["new", "existing", "base"],
        description: "Where the work lands: a new branch, an existing one, or the base branch",
      },
      {
        name: "github_work_branch",
        type: "string",
        description: "The branch for new or existing mode (not used for base)",
      },
      {
        name: "status",
        type: "string",
        enum: PLAN_STATUSES,
        description: "Defaults to draft",
      },
    ],
  },
  {
    name: "update_plan",
    group: "Authoring",
    summary: "Change a plan's description, or fill missing github / work_target fields.",
    description:
      "Change an existing plan. description is always updatable (for example to fix casing). github_repo, github_base, github_work_mode and github_work_branch are only filled when the plan does not already have them — use this to set a missing work_target, not to override one. Status stays with set_plan_status.",
    rest: { method: "POST", path: "plans/:plan_id" },
    params: [
      PLAN_ID,
      { name: "description", type: "string", description: "What the plan is for" },
      {
        name: "github_repo",
        type: "string",
        description: "owner/repo; only when the plan has none yet",
      },
      {
        name: "github_base",
        type: "string",
        description: "The base branch; only when the plan has none yet",
      },
      {
        name: "github_work_mode",
        type: "string",
        enum: ["new", "existing", "base"],
        description: "Where the work lands; only when the plan has no work mode yet",
      },
      {
        name: "github_work_branch",
        type: "string",
        description: "The branch for new or existing mode; only when missing",
      },
    ],
  },
  {
    name: "import_plan_markdown",
    group: "Authoring",
    summary: "Import a markdown document into an existing plan.",
    description:
      'Import a markdown document into an existing plan. mode "sync" matches sections and tasks by title and only adds what is missing (and fills empty descriptions or acceptance criteria), so status, claims, PRs and ticked steps are kept: use it to bring a plan up to date after the document changed. "merge" adds every section as new; "replace" removes the plan\'s sections and tasks first. A section with a bold-labelled list ("**Plan**", "**Implementation**") gets one task per entry, and "**Acceptance:**" becomes the tasks\' acceptance criteria. The result reports coverage: how many source lines were checked and which ones are missing.',
    rest: { method: "POST", path: "plans/:plan_id/import" },
    params: [
      PLAN_ID,
      {
        name: "markdown",
        type: "string",
        required: true,
        description: "The plan document, as markdown",
      },
      {
        name: "mode",
        type: "string",
        enum: ["sync", "merge", "replace"],
        description: "Defaults to merge",
      },
    ],
  },
  {
    name: "upload_attachment_text",
    group: "Authoring",
    summary: "Attach a Markdown or plain-text file to a plan or a task.",
    description:
      "Attach a Markdown or plain-text file (a review, a spec, notes) to a plan as a whole (plan_id) or to one task (task_id): name exactly one. It shows up in the plan's Files and the task drawer like any upload. Up to 256 KiB of UTF-8. Pass an idempotency_key to make retries safe: the same key, target and content returns the first attachment, a different file with the same key is refused (409).",
    rest: { method: "POST", path: "attachments/text" },
    params: [
      ...ATTACHMENT_TARGET,
      {
        name: "file_name",
        type: "string",
        required: true,
        description: "The name people see, e.g. review.md",
      },
      {
        name: "text",
        type: "string",
        required: true,
        description: "The file's content",
      },
      {
        name: "mime_type",
        type: "string",
        enum: ["text/markdown", "text/plain"],
        description: "Defaults to text/markdown for a .md name, otherwise text/plain",
      },
      ...ATTACHMENT_OPTIONS,
    ],
  },
  {
    name: "upload_attachment_base64",
    group: "Authoring",
    summary: "Attach a screenshot, PDF or text file to a plan or a task.",
    description:
      "Attach a PNG, JPEG, WebP or GIF image, a PDF, or a Markdown or plain-text file to a plan (plan_id) or a task (task_id): name exactly one. Up to 8 MiB. The bytes are checked against the type (SVG and HTML are refused). Give the content as data_base64 (plain base64, no data: prefix), or as file_path to a file on the machine running this MCP server, which is read and encoded for you. Pass an idempotency_key to make retries safe.",
    rest: { method: "POST", path: "attachments/base64" },
    notes: "With file_path, the MCP server reads the local file and sends it as base64.",
    params: [
      ...ATTACHMENT_TARGET,
      {
        name: "file_name",
        type: "string",
        description: "The name people see, e.g. checkout.png. Defaults to the file_path's name.",
      },
      {
        name: "mime_type",
        type: "string",
        enum: [
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/gif",
          "application/pdf",
          "text/markdown",
          "text/plain",
        ],
        description: "The file's type. Defaults to the type of the file name's extension.",
      },
      {
        name: "data_base64",
        type: "string",
        description: "The file as standard base64, without a data: prefix. Or use file_path.",
      },
      {
        name: "file_path",
        type: "string",
        description:
          "A file on the machine running this MCP server, read and encoded for you instead of data_base64",
      },
      ...ATTACHMENT_OPTIONS,
    ],
  },
  {
    name: "set_plan_status",
    group: "Authoring",
    summary: "Change a plan's status, for example draft to active so agents can see it.",
    rest: { method: "POST", path: "plans/:plan_id/status" },
    params: [
      PLAN_ID,
      {
        name: "status",
        type: "string",
        required: true,
        enum: PLAN_STATUSES,
        description: "The new status",
      },
    ],
  },
  {
    name: "create_section",
    group: "Authoring",
    summary:
      "Add a section to a plan, with goals, intentions, a Danish client summary, tags and a colour.",
    rest: { method: "POST", path: "plans/:plan_id/sections" },
    params: [
      PLAN_ID,
      {
        name: "title",
        type: "string",
        required: true,
        description: "Section title (up to 100 characters)",
      },
      { name: "description", type: "string", description: "What the section covers" },
      { name: "goals", type: "string", description: "What it should achieve" },
      { name: "intentions", type: "string", description: "Why, and the approach intended" },
      CLIENT_SUMMARY,
      COLOR,
      TAGS,
    ],
  },
  {
    name: "update_section",
    group: "Authoring",
    summary:
      "Change a section's title, description, goals, intentions, client summary, colour or tags.",
    rest: { method: "POST", path: "sections/:section_id" },
    params: [
      { ...SECTION_ID },
      { name: "title", type: "string", description: "New title" },
      { name: "description", type: "string", description: "New description" },
      { name: "goals", type: "string", description: "New goals" },
      { name: "intentions", type: "string", description: "New intentions" },
      { ...CLIENT_SUMMARY, description: `New client summary. ${CLIENT_SUMMARY.description}` },
      COLOR,
      TAGS,
    ],
  },
  {
    name: "create_task",
    group: "Authoring",
    summary: "Add a task to a section, with features, tags, a colour and dependencies.",
    description:
      "Add a task to a section of a plan. features is the list of things it must deliver (each a text, or { text, client_text } with the plain-Danish wording a client sees; a feature without client_text stays hidden from clients); depends_on lists task IDs in the same plan that must be done first. status is backlog or available (the default). On a plan clients can see, always set client_title (short plain Danish): a task without one is hidden from clients.",
    rest: { method: "POST", path: "plans/:plan_id/tasks" },
    params: [
      PLAN_ID,
      SECTION_ID,
      {
        name: "title",
        type: "string",
        required: true,
        description: "Task title (up to 200 characters)",
      },
      { name: "description", type: "string", description: "The brief" },
      CLIENT_TITLE,
      CLIENT_TASK_SUMMARY,
      { name: "priority", type: "string", enum: PRIORITIES, description: "Defaults to medium" },
      { name: "complexity", type: "string", enum: COMPLEXITIES, description: "How big it is" },
      TAGS,
      COLOR,
      {
        name: "features",
        type: "(string | object)[]",
        description:
          "What the task must deliver, one per entry: a text, or { text, client_text? } with the plain-Danish client text",
      },
      {
        name: "acceptance_criteria",
        type: "string[]",
        description: "How a reviewer checks it, one per entry",
      },
      {
        name: "depends_on",
        type: "string[]",
        description: "IDs of tasks in this plan that must be done first",
      },
      {
        name: "status",
        type: "string",
        enum: ["backlog", "available"],
        description: "Defaults to available",
      },
      {
        name: "assigned_user_id",
        type: "string",
        description: "Assign it to a teammate (a user_id from list_people); they are notified",
      },
    ],
  },
  {
    name: "update_task",
    group: "Authoring",
    summary:
      "Change a task's title, description, client title/summary, priority, size, tags, colour, criteria, branch or assignee.",
    rest: { method: "POST", path: "tasks/:task_id" },
    params: [
      TASK_ID,
      { name: "title", type: "string", description: "New title" },
      { name: "description", type: "string", description: "New description" },
      { ...CLIENT_TITLE, description: `New client title. ${CLIENT_TITLE.description}` },
      {
        ...CLIENT_TASK_SUMMARY,
        description: `New client summary. ${CLIENT_TASK_SUMMARY.description}`,
      },
      { name: "priority", type: "string", enum: PRIORITIES, description: "New priority" },
      { name: "complexity", type: "string", enum: COMPLEXITIES, description: "New size" },
      { ...TAGS, description: "Replaces the task's tags" },
      COLOR,
      {
        name: "acceptance_criteria",
        type: "string[]",
        description: "Replaces the acceptance criteria",
      },
      { name: "branch_name", type: "string", description: "The branch the work is on" },
    ],
  },

  // -------------------------------------------------------------------------
  // GitHub
  // -------------------------------------------------------------------------
  {
    name: "create_pull_request",
    group: "GitHub",
    summary: "Open a pull request for a task and mark the task done with it.",
    description:
      "Open a GitHub pull request for a task and mark the task done with it. Uses the GitHub token of the person who made your API key (connected in Boared under Settings). The repository and base come from the plan, and head_branch defaults to the plan's work branch. If the plan's mode is base the work belongs directly on the base branch and no pull request is needed: use complete_task.",
    rest: { method: "POST", path: "tasks/:task_id/pull-request" },
    notes: "Then marks the task done through POST tasks/:task_id/complete.",
    params: [
      TASK_ID,
      { name: "title", type: "string", required: true, description: "Pull request title" },
      {
        name: "head_branch",
        type: "string",
        description: "The branch with your commits; defaults to the plan's work branch",
      },
      { name: "body", type: "string", description: "Pull request description" },
      {
        name: "repo",
        type: "string",
        description: "owner/name; defaults to the plan's repository",
      },
      {
        name: "base_branch",
        type: "string",
        description: "Defaults to the plan's base, else the repository's default branch",
      },
    ],
  },
  {
    name: "github_status",
    group: "GitHub",
    summary: "Whether GitHub is connected for the person who made your API key.",
    description:
      "Whether GitHub is connected for the person who made your API key: connected, where the token comes from, their login and any problem. Never returns the token. Check it before create_pull_request, check_pr_status or the plan pull-request tools, which all use that person's token.",
    rest: { method: "GET", path: "github" },
    params: [],
  },
  {
    name: "check_pr_status",
    group: "GitHub",
    summary: "Read a task's pull request from GitHub now and record it on the task.",
    description:
      "Read a task's pull request from GitHub now (state, merged, draft, base and head, mergeability) and record it on the task. Uses the GitHub token of the person who made your API key; without one it returns what the task already records and says GitHub is not connected.",
    rest: { method: "GET", path: "tasks/:task_id/pull-request" },
    params: [TASK_ID],
  },
  {
    name: "list_plan_pull_requests",
    group: "GitHub",
    summary: "A plan's pull requests in merge order, read from GitHub now.",
    description:
      "List a plan's pull requests in the order they must be merged (stacked PRs go parents first), read from GitHub now: state, base <- head branches, checks, conflicts, and what blocks each one.",
    rest: { method: "GET", path: "plans/:plan_id/pull-requests" },
    params: [PLAN_ID],
  },
  {
    name: "merge_plan_pull_requests",
    group: "GitHub",
    summary: "Merge a plan's pull requests in stack order. Dry run by default.",
    description:
      "Merge a plan's pull requests in stack order. Dry run by default: it returns what it would do (merge order, which stacked PRs get retargeted to the base branch first, what blocks a merge) without changing anything. Pass dry_run false to do it. It stops at the first PR that cannot be merged and is safe to repeat. A merge commit is the default because squash or rebase breaks a stack.",
    rest: { method: "POST", path: "plans/:plan_id/pull-requests/merge" },
    params: [
      PLAN_ID,
      {
        name: "dry_run",
        type: "boolean",
        description: "Defaults to true. Pass false to really merge.",
      },
      {
        name: "method",
        type: "string",
        enum: ["merge", "squash", "rebase"],
        description: "Defaults to merge",
      },
      { name: "max", type: "integer", description: "Merge at most this many PRs in this call" },
      {
        name: "only",
        type: "string",
        description: "Merge just this PR (owner/name#123); it has to be the next in line",
      },
      {
        name: "ignore_checks",
        type: "boolean",
        description: "Merge even if checks are failing or running",
      },
    ],
  },

  // -------------------------------------------------------------------------
  // Workspace (needs an API key with the account scope)
  // -------------------------------------------------------------------------
  {
    name: "get_workspace",
    group: "Workspace",
    summary: "The workspace your API key belongs to.",
    description:
      "Get the workspace your API key belongs to: its id, name and slug. Needs an API key with the account scope.",
    rest: { method: "GET", path: "workspace", api: "account" },
    params: [],
  },
  {
    name: "list_projects",
    group: "Workspace",
    summary: "The workspace's projects, most recently updated first.",
    description:
      "List the workspace's projects (title, status, progress, GitHub repository), most recently updated first. Needs an API key with the account scope.",
    rest: { method: "GET", path: "projects", api: "account" },
    params: [],
  },
  {
    name: "get_project",
    group: "Workspace",
    summary: "One project with its status, progress and GitHub repository.",
    description:
      "Get a project: title, description, status, progress, GitHub repository and default branch. Needs an API key with the account scope.",
    rest: { method: "GET", path: "projects/:project_id", api: "account" },
    params: [PROJECT_ID],
  },
  {
    name: "update_project",
    group: "Workspace",
    summary: "Change a project's title, description, status or GitHub repository.",
    description:
      "Change a project; only the fields you pass change. github_repo (owner/name) and github_default_branch are where the project's plans open pull requests by default. Needs an API key with the account scope.",
    rest: { method: "PATCH", path: "projects/:project_id", api: "account" },
    params: [
      PROJECT_ID,
      { name: "title", type: "string", description: "New title" },
      { name: "description", type: "string", description: "New description" },
      { name: "status", type: "string", enum: PROJECT_STATUSES, description: "New status" },
      { name: "github_repo", type: "string", description: "The repository, as owner/name" },
      {
        name: "github_default_branch",
        type: "string",
        description: "The branch pull requests go to",
      },
    ],
  },
  {
    name: "list_tickets",
    group: "Workspace",
    summary: "The workspace's tickets, newest activity first, filtered by project or status.",
    description:
      "List the workspace's tickets (number, title, description, status, priority, type, assignee), most recently updated first, at most 100. Filter by project_id and by one status; the open queue is status open. Needs an API key with the account scope.",
    rest: { method: "GET", path: "tickets?project_id=&status=", api: "account" },
    notes: "Tickets are not planner tasks: put one on a plan with create_task_from_ticket.",
    params: [
      { name: "project_id", type: "string", description: "Only tickets of this project" },
      {
        name: "status",
        type: "string",
        enum: TICKET_STATUSES,
        description: "Only tickets with this status",
      },
    ],
  },
  {
    name: "get_ticket",
    group: "Workspace",
    summary: "One ticket in full.",
    description:
      "Get a ticket: number, title, description, status, priority, type, project, assignee, labels and dates. Needs an API key with the account scope.",
    rest: { method: "GET", path: "tickets/:ticket_id", api: "account" },
    params: [TICKET_ID],
  },
  {
    name: "create_ticket",
    group: "Workspace",
    summary: "File a ticket in a project.",
    description:
      "File a ticket in a project. Type defaults to bug and priority to medium. Needs an API key with the account scope.",
    rest: { method: "POST", path: "tickets", api: "account" },
    params: [
      { ...PROJECT_ID, description: "The project to file it in (from list_projects)" },
      { name: "title", type: "string", required: true, description: "Ticket title" },
      { name: "description", type: "string", description: "What is wrong or wanted" },
      { name: "type", type: "string", enum: TICKET_TYPES, description: "Defaults to bug" },
      {
        name: "priority",
        type: "string",
        enum: TICKET_PRIORITIES,
        description: "Defaults to medium",
      },
    ],
  },
  {
    name: "update_ticket",
    group: "Workspace",
    summary: "Change a ticket's status, title, description, priority, type or assignee.",
    description:
      "Change a ticket; only the fields you pass change. Move it with status as the work moves: in_progress when you start, in_review once there is a pull request, done when it is merged. Needs an API key with the account scope.",
    rest: { method: "PATCH", path: "tickets/:ticket_id", api: "account" },
    params: [
      TICKET_ID,
      { name: "status", type: "string", enum: TICKET_STATUSES, description: "New status" },
      { name: "title", type: "string", description: "New title" },
      { name: "description", type: "string", description: "New description" },
      { name: "priority", type: "string", enum: TICKET_PRIORITIES, description: "New priority" },
      { name: "type", type: "string", enum: TICKET_TYPES, description: "New type" },
      { name: "assignee_id", type: "string", description: "The id of the user to assign it to" },
    ],
  },
  {
    name: "create_task_from_ticket",
    group: "Workspace",
    summary: "Put a ticket on a plan as a task, so it can be claimed and worked like any task.",
    description:
      "Create a planner task from a ticket in a plan of the same project: the title, description, type tag and priority carry over and the task keeps its link to the ticket. Safe to repeat: when the plan already has a task for the ticket, that task comes back with created false. Then claim it with claim_task. Needs an API key with the account scope.",
    rest: { method: "POST", path: "tickets/:ticket_id/tasks", api: "account" },
    params: [
      TICKET_ID,
      { ...PLAN_ID, description: "The plan to put the task on (from list_plans)" },
      {
        name: "section_id",
        type: "string",
        description: "The section to put it in; defaults to the plan's first section",
      },
    ],
  },
];

export const toolByName = (name: string): CatalogTool => {
  const tool = TOOL_CATALOG.find((entry) => entry.name === name);
  if (!tool) throw new Error(`No catalog entry for tool "${name}". Add it to tool-catalog.ts.`);
  return tool;
};

/** A tool's REST call as a URL path, for display: `/api/planner/plans` or `/api/v1/tickets`. */
export function restUrlPath(rest: NonNullable<CatalogTool["rest"]>): string {
  return `${REST_API_BASE[rest.api ?? "planner"]}/${rest.path}`;
}

/** The catalog grouped for display, in the order of TOOL_GROUPS. */
export function toolsByGroup(
  tools: readonly CatalogTool[] = TOOL_CATALOG,
): Array<{ group: ToolGroup; tools: CatalogTool[] }> {
  return TOOL_GROUPS.map((group) => ({
    group,
    tools: tools.filter((tool) => tool.group === group),
  })).filter((entry) => entry.tools.length > 0);
}

/** Case-insensitive match on a tool's name, summary and parameter names. */
export function searchTools(query: string, tools: readonly CatalogTool[] = TOOL_CATALOG) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...tools];
  return tools.filter((tool) =>
    [tool.name, tool.summary, tool.rest?.path ?? "", ...tool.params.map((param) => param.name)]
      .join(" ")
      .toLowerCase()
      .includes(needle),
  );
}
