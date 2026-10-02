/**
 * Every tool the Boared MCP server offers, described once.
 *
 * `server.ts` takes each tool's description and input schema from here, the
 * Agents & MCP page renders it, and `tool-catalog.test.ts` fails when a tool in
 * `server.ts` is missing here, when an entry here has no tool, or when the skill
 * does not mention one. Adding a tool means adding it here, and the docs follow.
 *
 * Plain data and no imports, so the browser and the stdio server both load it.
 * Paths are relative to the planner API (`/api/planner`).
 */

export type ParamType = "string" | "integer" | "boolean" | "string[]";

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
  rest: { method: "GET" | "POST"; path: string } | null;
  /** What else the tool does around that call. */
  notes?: string;
  params: readonly ToolParam[];
}

const PLAN_STATUSES = ["draft", "active", "paused", "completed", "archived"] as const;
const PRIORITIES = ["low", "medium", "high", "critical"] as const;
const COMPLEXITIES = ["trivial", "small", "medium", "large", "epic"] as const;

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
const AGENT_ID: ToolParam = {
  name: "agent_id",
  type: "string",
  description:
    "The agent acting. Defaults to the agent that claimed a task in this session, so you rarely pass it.",
};
const COLOR: ToolParam = {
  name: "color",
  type: "string",
  description: "A hex colour like #3b82f6 or a design token like var(--chart-1)",
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
    summary: "A plan with its sections, tasks, features, steps and questions, and its work_target.",
    description:
      "Get a plan with its sections (goals, intentions, tags, colour) and tasks (tags as labels, colour, ai_context, features, steps with feature_id, questions with who asked and answered). work_target says where commits go: repo, base, branch, mode and a summary.",
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
      "Get a task: description, acceptance criteria, tags (labels), colour, ai_context, features, steps (with feature_id), questions (with who asked and answered), the files shared with agents, and the plan's work_target.",
    rest: { method: "GET", path: "tasks/:task_id" },
    params: [TASK_ID],
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
          "A comment for the discussion. Only posted when not empty. Max 5000 characters.",
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
      { name: "body", type: "string", required: true, description: "The comment" },
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
      "Ask a question on a task instead of guessing. A blocking question puts the task in blocked until someone answers (then it goes back where it was); a non-blocking one just asks and you carry on. People can ask too: list_questions shows both.",
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
      AGENT_ID,
    ],
  },
  {
    name: "list_questions",
    group: "Questions",
    summary: "Questions on a plan or a task, with who asked and who answered.",
    description:
      "List questions with who asked and who answered. Pass plan_id for a whole plan (open ones by default) or task_id for one task (all by default).",
    rest: { method: "GET", path: "plans/:plan_id/questions?status= or tasks/:task_id/questions" },
    params: [
      { name: "plan_id", type: "string", description: "All questions on this plan" },
      { name: "task_id", type: "string", description: "Questions on this task" },
      {
        name: "status",
        type: "string",
        enum: ["open", "answered", "dismissed", "all"],
        description: "Defaults to open for a plan and all for a task",
      },
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
      "Add features to the end of a task's feature list: what the task must deliver. Pass items (one per feature) or text (one per line; bullets, numbers and [ ] are understood).",
    rest: { method: "POST", path: "tasks/:task_id/features" },
    params: [
      TASK_ID,
      { name: "items", type: "string[]", description: "One feature per entry" },
      { name: "text", type: "string", description: "Features, one per line" },
      AGENT_ID,
    ],
  },
  {
    name: "update_task_feature",
    group: "Features and steps",
    summary: "Mark a feature met when the work satisfies it, or reword it.",
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
    ],
  },
  {
    name: "add_task_step",
    group: "Features and steps",
    summary: "Add a sub-step to the end of a task's checklist.",
    description:
      "Add a sub-step to the end of a task's checklist. Point it at the feature it delivers with feature_id. Several lines in text become several steps (indent two spaces to nest).",
    rest: { method: "POST", path: "tasks/:task_id/steps" },
    params: [
      TASK_ID,
      { name: "text", type: "string", required: true, description: "The step" },
      { name: "feature_id", type: "string", description: "The feature this step delivers" },
      { name: "depth", type: "integer", description: "Nesting level, 0 to 3" },
    ],
  },
  {
    name: "add_task_steps",
    group: "Features and steps",
    summary: "Add several sub-steps at once, optionally all for one feature.",
    description:
      "Add several sub-steps to a task at once. Pass items (one per step) or text (one per line, indented two spaces per level). feature_id links every one to the same feature.",
    rest: { method: "POST", path: "tasks/:task_id/steps" },
    params: [
      TASK_ID,
      { name: "items", type: "string[]", description: "One step per entry" },
      { name: "text", type: "string", description: "Steps, one per line" },
      { name: "feature_id", type: "string", description: "The feature these steps deliver" },
      AGENT_ID,
    ],
  },
  {
    name: "update_task_step",
    group: "Features and steps",
    summary: "Tick or untick a sub-step, reword it, or link it to a feature.",
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
    summary: "Add a section to a plan, with goals, intentions, tags and a colour.",
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
      COLOR,
      TAGS,
    ],
  },
  {
    name: "update_section",
    group: "Authoring",
    summary: "Change a section's title, description, goals, intentions, colour or tags.",
    rest: { method: "POST", path: "sections/:section_id" },
    params: [
      { ...SECTION_ID },
      { name: "title", type: "string", description: "New title" },
      { name: "description", type: "string", description: "New description" },
      { name: "goals", type: "string", description: "New goals" },
      { name: "intentions", type: "string", description: "New intentions" },
      COLOR,
      TAGS,
    ],
  },
  {
    name: "create_task",
    group: "Authoring",
    summary: "Add a task to a section, with features, tags, a colour and dependencies.",
    description:
      "Add a task to a section of a plan. features is the list of things it must deliver; depends_on lists task IDs in the same plan that must be done first. status is backlog or available (the default).",
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
      { name: "priority", type: "string", enum: PRIORITIES, description: "Defaults to medium" },
      { name: "complexity", type: "string", enum: COMPLEXITIES, description: "How big it is" },
      TAGS,
      COLOR,
      {
        name: "features",
        type: "string[]",
        description: "What the task must deliver, one per entry",
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
    ],
  },
  {
    name: "update_task",
    group: "Authoring",
    summary:
      "Change a task's title, description, priority, size, tags, colour, criteria or branch.",
    rest: { method: "POST", path: "tasks/:task_id" },
    params: [
      TASK_ID,
      { name: "title", type: "string", description: "New title" },
      { name: "description", type: "string", description: "New description" },
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
];

export const toolByName = (name: string): CatalogTool => {
  const tool = TOOL_CATALOG.find((entry) => entry.name === name);
  if (!tool) throw new Error(`No catalog entry for tool "${name}". Add it to tool-catalog.ts.`);
  return tool;
};

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
