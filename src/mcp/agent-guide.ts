/**
 * How an agent is expected to work a task. One text, used four ways: the MCP
 * server's `instructions`, the `agent_guide` tool, the Workflow tab of the
 * Agents & MCP page, and (written out by hand) the skill. Nothing here imports
 * anything, so the page and the stdio server can both load it.
 */

export interface WorkflowRule {
  id: string;
  title: string;
  body: string;
}

export const WORKFLOW_RULES: readonly WorkflowRule[] = [
  {
    id: "read",
    title: "Read the task before you touch anything",
    body: "list_plans, get_plan, list_available_tasks, then get_task. A task carries its description, acceptance criteria, features (what it must deliver), steps (how), open questions, shared files and tags. The plan carries work_target: where commits go. It can also carry its own files (a brief, a spec) that apply to every task: they are the plan's attachments in get_plan, and list_plan_attachments and view_plan_attachment open them (read_attachment_text reads a Markdown or text file as text). Read them before you start. On a plan clients can see, list_client_comments shows what the client has said and approved: read it before you work. To leave a file for people or other agents (a review, a screenshot), use upload_attachment_text or upload_attachment_base64.",
  },
  {
    id: "tickets",
    title: "Tickets are not tasks",
    body: "Bugs and requests people file are tickets, and need an API key with the account scope. list_tickets (status open) and get_ticket read them; create_task_from_ticket puts one on a plan so you can claim and work it like any task, and does nothing twice. Keep the ticket in step with update_ticket: in_progress when you start, in_review once there is a pull request, done when it is merged.",
  },
  {
    id: "claim",
    title: "Claim a task before working on it",
    body: "claim_task reserves it so no other agent starts the same work. If the claim fails the task is taken or not ready: pick another. Never work on a task you did not claim.",
  },
  {
    id: "start",
    title: "Mark it in progress",
    body: "start_task, or report_progress with status in_progress. The board shows the card moving, which is how people know it is being worked on.",
  },
  {
    id: "plan",
    title: "Features are the what, steps are the how",
    body: "If the task has features but no steps, write the steps with add_task_steps and point each at the feature it delivers (feature_id). Do not rewrite features a person wrote; add steps beneath them.",
  },
  {
    id: "tick",
    title: "Tick as you go",
    body: "After each meaningful chunk call report_progress with steps_done and features_met. Mark a feature met only when the work really satisfies it. Do the ticking at the time, not in one batch at the end.",
  },
  {
    id: "comment",
    title: "Comment only when there is something to say",
    body: "A decision, a blocker, a result. Not 'starting' or 'still working': the status and ticks already say that. report_progress posts a comment only when `note` is not empty, so leave it out when you have nothing to add. To bring a person in, @mention them with their token from list_people (`@[Name](user:<user_id>)`): they are notified.",
  },
  {
    id: "ask",
    title: "Ask, do not guess",
    body: "When the task is ambiguous, ask_question. Make it blocking only if you truly cannot continue without the answer: a blocking question puts the task in blocked and a person sees it waiting. Otherwise ask non-blocking and carry on with what you can. Answers show up in get_task and list_questions. Every question has an audience: agency is the default (the human operator), so leave it alone unless the question is for someone else. Use agent only to hand a question to another AI agent. Use client only for what the client must decide or answer, and then ALWAYS give a client_body: the question in plain DANISH that a non-technical person understands. To re-aim a question that already exists (send it to the client, or back to the agency), use set_question_audience instead of asking again. A client answers in the app and the answer lands in get_task like any other; answer_question works for any audience.",
  },
  {
    id: "target",
    title: "Check work_target before committing",
    body: "get_plan returns work_target: repository, base branch, working branch and mode. new or existing: commit on that branch. base: commit directly on the base branch, no pull request. No working branch chosen: use one branch per task. Pull requests are opened with the key owner's GitHub token: github_status tells you whether it is connected before you try.",
  },
  {
    id: "finish",
    title: "Finish with a result",
    body: "Mark the features you met and tick the steps, then complete_task (with a summary and branch_name) or create_pull_request, which opens the PR and marks the task done. Its head branch defaults to the plan's work branch.",
  },
  {
    id: "client",
    title: "Keep the client layer current",
    body: "Clients of a shared plan only read plain DANISH, never the technical wording: no jargon, task ids, branch names, PR numbers or code, and the outcome rather than the implementation. Every section has a client_summary (1-3 sentences on what is done and what comes next), every task a client_title (a SHORT plain name) and an optional client_summary (one sentence), and every step an optional client_text. A task is shown to clients ONLY when it has a client_title and a step ONLY when it has a client_text, so when you author or finish tasks on a plan clients can see, ALWAYS set client_title (create_task or update_task; client_text with add_task_step or update_task_step; client_summary on sections with create_section or update_section). Keep them current: update them when status or meaning changes, for example after you finish a task. Features work the same way: a feature has an optional client_text (plain DANISH, set with add_task_features, create_task or update_task_feature), a client sees a feature ONLY when it has one, and the clients' list of what is still missing is exactly those features, so give every deliverable one. Clients have the same view as the agency, only translated: keep the client texts complete and current, not shorter than the agency wording. Markdown carries section and task client text but not step or feature client_text.",
  },
  {
    id: "stuck",
    title: "If you cannot continue",
    body: "block_task with a reason: it becomes a blocking question a person can answer. Or unclaim_task to put the task back for someone else.",
  },
];

/** The short version sent to every MCP client in the server's `instructions`. */
/** Hosted endpoint for remote agents (OAuth). Local stdio still uses PLANNER_API_KEY. */
export const HOSTED_MCP_URL = "https://boared.online/api/mcp";

export const MCP_INSTRUCTIONS = [
  "Boared AI Planner: humans and AI agents share plans, sections and tasks on one board, next to the workspace's projects and tickets.",
  "",
  ...WORKFLOW_RULES.map((rule, index) => `${index + 1}. ${rule.title}. ${rule.body}`),
  "",
  "Call agent_guide for this text again. Ids are uuids: take them from get_plan and get_task.",
].join("\n");

/** What the `agent_guide` tool returns. */
export function agentGuideText(): string {
  return [
    "# Working a Boared task",
    "",
    ...WORKFLOW_RULES.map((rule, index) => `${index + 1}. **${rule.title}.** ${rule.body}`),
    "",
    "Tags are words on a task or section (get_task shows them as labels). Colours are hex like #3b82f6. Questions can be asked by you or by a person; both are visible on the task.",
  ].join("\n");
}
