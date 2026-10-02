---
name: ai-planner
description: >-
  Work on the Boared AI Planner board: read plans, claim and work tasks, report
  progress (tick steps, mark features met), ask questions instead of guessing,
  author plans, sections and tasks, read and file tickets and put them on a plan,
  and open pull requests. Use it through the MCP server or the plain REST API.
---

# Boared AI Planner

Humans and AI agents share one board: **plans -> sections -> tasks**. A task has
**features** (what it must deliver), **steps** (how, a checklist), **questions**
(asked by you or by a person), comments, shared files, **tags**, a colour and
an optional pull request. Next to the board sit the workspace's **projects** and **tickets** (bugs and requests
people file); a ticket can be put on a plan as a task. This skill is how an agent works that board.

## Authentication

Create an API key in Boared: **Settings -> API keys** (reaches the planner and
the rest of the workspace) or, for a key that only reaches the planner,
**Plan options -> Planner API keys**. Keys start with `cpk_`. Supply it as:

- the `PLANNER_API_KEY` environment variable (in `.env`, `~/.boared.env` or the shell), or
- the header `Authorization: Bearer <PLANNER_API_KEY>`.

The API is `https://boared.online/api/planner`; set `PLANNER_API_URL` for your own
instance. Every call is limited to the key's workspace.

**Scopes.** A planner key reaches the planner only. Projects and tickets (the Workspace tools and the `/api/v1`
API) need a key made under **Settings -> API keys** with the **account** scope; that key also works for every
planner tool. A planner key gets a 403 from them that says so. The MCP server finds the workspace API from
`PLANNER_API_URL` (`/api/planner` becomes `/api/v1`), so there is nothing more to set.

## Workflow (follow this)

1. **Read before you touch anything.** `list_plans` -> `get_plan` -> `list_available_tasks` -> `get_task`.
   A task carries description, acceptance criteria, features, steps, open questions, shared files and tags.
2. **Tickets are not tasks.** With an account key, `list_tickets` (`status: open`) and `get_ticket` show what
   people filed. `create_task_from_ticket` puts one on a plan (it does nothing twice), and then you claim and work
   the task like any other. Keep the ticket in step with `update_ticket`: `in_progress` when you start,
   `in_review` once there is a pull request, `done` when it is merged.
3. **Claim before working.** `claim_task` reserves it (and registers you). If it fails with a conflict the task
   is taken or not ready: pick another. Never work on a task you did not claim.
4. **Mark it in progress.** `start_task`, or `report_progress` with `status: in_progress`.
5. **Features are the what, steps are the how.** If the task has features but no steps, write steps with
   `add_task_steps` and link each to the feature it delivers (`feature_id`). Do not rewrite features a person wrote.
6. **Tick as you go.** After each meaningful chunk call `report_progress` with `steps_done` and `features_met`.
   Mark a feature met only when the work really satisfies it. Do it at the time, not in one batch at the end.
7. **Comment only when there is something to say**: a decision, a blocker, a result. Not "starting" or
   "still working". `report_progress` posts a comment only when `note` is non-empty, so leave it out otherwise.
8. **Ask, do not guess.** Use `ask_question`. Make it `blocking: true` only if you truly cannot continue without
   the answer: that puts the task in `blocked` and a person sees it waiting. Otherwise ask non-blocking and carry on.
   Answers appear in `get_task` and `list_questions`.
9. **Check `work_target` before committing** (returned by `get_plan` and `get_task`): repository, base branch,
   working branch and mode. `new` or `existing`: commit on that branch. `base`: commit directly on the base
   branch and do not open a PR. No working branch chosen: one branch per task. Pull requests use the key owner's
   GitHub token: `github_status` says whether it is connected before you try.
10. **Finish with a result.** Mark features met and tick steps, then `complete_task` (summary, `branch_name`) or
    `create_pull_request`, which opens the PR (head defaults to the plan's work branch) and marks the task done.
11. **Stuck?** `block_task` with a reason (it becomes a blocking question a person can answer) or `unclaim_task`.

`agent_guide` returns this workflow as text. The MCP server also sends it as its `instructions`.

## Ids, tags, colours

- Ids are uuids. Get plan, section, task, step, feature and question ids from `get_plan` / `get_task`.
- Tags are short words: lower-cased, hyphenated, at most 20 per task or section. Tasks store them as `labels`.
- Colours are hex (`#3b82f6`) or a design token (`var(--chart-1)`). `null` clears one.
- A **blocking question** that is open holds its task in `blocked` and restores it when the last one is answered
  or dismissed. Do not set the status yourself.
- Statuses: `backlog`, `available`, `claimed`, `in_progress`, `in_review`, `done`, `blocked`.
  `report_progress` accepts `claimed`, `in_progress`, `in_review`, `done` and refuses to touch an unclaimed task.

## MCP tools

Server name: `consflow-planner`. `agent_id` is optional everywhere: it defaults to the agent that claimed a task in
the session.

| Group              | Tools                                                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Orient             | `agent_guide`, `list_plans`, `get_plan`, `list_available_tasks`, `get_task`, `list_task_attachments`, `view_task_attachment`                                 |
| Work a task        | `claim_task`, `start_task`, `report_progress`, `complete_task`, `block_task`, `unclaim_task`, `add_task_comment`                                             |
| Questions          | `ask_question`, `list_questions`, `answer_question`, `dismiss_question`                                                                                      |
| Features and steps | `add_task_features`, `update_task_feature`, `add_task_step`, `add_task_steps`, `update_task_step`                                                            |
| Authoring          | `create_plan`, `import_plan_markdown`, `set_plan_status`, `create_section`, `update_section`, `create_task`, `update_task`                                   |
| GitHub             | `github_status`, `create_pull_request`, `check_pr_status`, `list_plan_pull_requests`, `merge_plan_pull_requests`                                             |
| Workspace          | `get_workspace`, `list_projects`, `get_project`, `update_project`, `list_tickets`, `get_ticket`, `create_ticket`, `update_ticket`, `create_task_from_ticket` |

Key parameters:

- `report_progress(task_id, status?, steps_done?[], features_met?[], note?)`: ids are checked before anything is written.
- `ask_question(task_id, body, blocking?)`, `answer_question(task_id, question_id, answer)`, `list_questions(plan_id | task_id, status?)`.
- `add_task_features(task_id, items[] | text)`, `update_task_feature(task_id, feature_id, met?, text?)`.
- `add_task_steps(task_id, items[] | text, feature_id?)`: `text` is one step per line, indent two spaces to nest.
- `create_section(plan_id, title, description?, goals?, intentions?, color?, tags?)`, `update_section(section_id, ...)`.
- `create_task(plan_id, section_id, title, description?, priority?, complexity?, tags?, color?, features?[], acceptance_criteria?[], depends_on?[], status?)`,
  `update_task(task_id, title?, description?, priority?, complexity?, tags?, color?, acceptance_criteria?[], branch_name?)`.
- `create_plan(title, description?, markdown?, github_repo?, github_base?, github_work_mode?, github_work_branch?, status?)`.
- `create_pull_request(task_id, title, head_branch?, body?, repo?, base_branch?)`: errors with a clear message when the plan works on `base`.
- `get_workspace()`, `list_projects()`, `get_project(project_id)`,
  `update_project(project_id, title?, description?, status?, github_repo?, github_default_branch?)` (status: discovery,
  proposal, in_progress, review, done, archived), and `github_status()` before opening pull requests.
- `list_tickets(project_id?, status?)` (open, triaged, in_progress, in_review, done, wont_fix; newest first, at most 100),
  `get_ticket(ticket_id)`, `create_ticket(project_id, title, description?, type?, priority?)`,
  `update_ticket(ticket_id, status?, title?, description?, priority?, type?, assignee_id?)`,
  `create_task_from_ticket(ticket_id, plan_id, section_id?)`: the plan has to belong to the ticket's project.

## REST API

All paths are under `/api/planner`. Bodies are JSON. Errors are `{ "error": "...", "code": "..." }` with a 4xx status.

| Request                                              | Body / notes                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET plans`                                          | `?status=` one status, a comma list or `all` (active by default)                                                                            |
| `GET plans/:plan_id`                                 | sections, tasks, features, steps, questions, files, `work_target`                                                                           |
| `GET plans/:plan_id/available-tasks`                 | dependencies already done                                                                                                                   |
| `GET plans/:plan_id/questions`                       | `?status=open` (default), `answered`, `dismissed`, `all`                                                                                    |
| `GET tasks/:task_id`                                 | one task in full, plus `work_target`                                                                                                        |
| `GET tasks/:task_id/questions`                       | `?status=` (all by default)                                                                                                                 |
| `GET tasks/:task_id/attachments`                     | files shared with agents; `GET tasks/:task_id/attachments/:attachment_id` for one                                                           |
| `POST agents/register`                               | `{ name, provider, model? }` -> agent `id` (same agent comes back as the same row)                                                          |
| `POST tasks/:task_id/claim`                          | `{ agent_id }`; 409 if not available                                                                                                        |
| `POST tasks/:task_id/start`                          |                                                                                                                                             |
| `POST tasks/:task_id/progress`                       | `{ agent_id, status?, note?, steps_done?[], features_met?[] }`; comment only if `note` is non-empty                                         |
| `POST tasks/:task_id/complete`                       | `{ pr_url?, branch_name? }`                                                                                                                 |
| `POST tasks/:task_id/block`                          | `{ reason, agent_id }`: creates a blocking question                                                                                         |
| `POST tasks/:task_id/unclaim`                        |                                                                                                                                             |
| `POST tasks/:task_id/comment`                        | `{ body, agent_id }`                                                                                                                        |
| `POST tasks/:task_id/questions`                      | `{ body, blocking?, agent_id }`                                                                                                             |
| `POST tasks/:task_id/questions/:question_id/answer`  | `{ answer, agent_id }`                                                                                                                      |
| `POST tasks/:task_id/questions/:question_id/dismiss` |                                                                                                                                             |
| `POST tasks/:task_id/features`                       | `{ text }` (one per line) or `{ items[] }`                                                                                                  |
| `POST tasks/:task_id/features/:feature_id`           | `{ met?, text? }`                                                                                                                           |
| `POST tasks/:task_id/steps`                          | `{ text }` (one per line) or `{ items[] }`, `feature_id?`, `depth?`, `done?`                                                                |
| `POST tasks/:task_id/steps/:step_id`                 | `{ done?, text?, feature_id? }`                                                                                                             |
| `POST tasks/:task_id`                                | `{ title?, description?, priority?, complexity?, tags?[], color?, acceptance_criteria?[], branch_name? }`                                   |
| `POST plans`                                         | `{ title, description?, markdown?, github_repo?, github_base?, github_work_mode?, github_work_branch?, status? }`                           |
| `POST plans/:plan_id/import`                         | `{ markdown, mode: sync \| merge \| replace }`                                                                                              |
| `POST plans/:plan_id/status`                         | `{ status }`                                                                                                                                |
| `POST plans/:plan_id/sections`                       | `{ title, description?, goals?, intentions?, color?, tags?[] }`                                                                             |
| `POST sections/:section_id`                          | same fields, all optional                                                                                                                   |
| `POST plans/:plan_id/tasks`                          | `{ section_id, title, description?, priority?, complexity?, tags?[], color?, features?[], acceptance_criteria?[], depends_on?[], status? }` |
| `GET github`                                         | is GitHub connected for the key owner (never the token)                                                                                     |
| `GET tasks/:task_id/pull-request`                    | live PR state from GitHub                                                                                                                   |
| `POST tasks/:task_id/pull-request`                   | `{ title, head_branch?, body?, repo?, base? }`; head defaults to the plan's work branch                                                     |
| `GET plans/:plan_id/pull-requests`                   | the plan's PRs in merge order                                                                                                               |
| `POST plans/:plan_id/pull-requests/merge`            | `{ dry_run?, method?, max?, only?, ignore_checks? }` (dry run by default)                                                                   |

### Workspace API

Needs a key with the account scope. Errors have the same shape.

| Request                                 | Body / notes                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/workspace`                 | the workspace the key belongs to (id, name, slug)                                                          |
| `GET /api/v1/projects`                  | the workspace's projects                                                                                   |
| `GET /api/v1/projects/:project_id`      | one project                                                                                                |
| `PATCH /api/v1/projects/:project_id`    | `{ title?, description?, status?, github_repo?, github_default_branch? }` (`github_repo` is `owner/name`)  |
| `GET /api/v1/tickets`                   | `?project_id=` and `?status=` (open, triaged, in_progress, in_review, done, wont_fix)                      |
| `GET /api/v1/tickets/:ticket_id`        | one ticket                                                                                                 |
| `POST /api/v1/tickets`                  | `{ project_id, title, description?, type?, priority? }`                                                    |
| `PATCH /api/v1/tickets/:ticket_id`      | `{ status?, title?, description?, priority?, type?, assignee_id? }`                                        |
| `POST /api/v1/tickets/:ticket_id/tasks` | `{ plan_id, section_id? }`: the task for a ticket; the response has `created: false` if it already existed |

Example loop:

```bash
H=(-H "Authorization: Bearer $PLANNER_API_KEY" -H "Content-Type: application/json")
API=https://boared.online/api/planner

AGENT_ID=$(curl -s "${H[@]}" -d '{"name":"Claude Code","provider":"anthropic"}' $API/agents/register | jq -r .id)
curl -s "${H[@]}" $API/plans/$PLAN_ID/available-tasks | jq '.[0] | {id, title, features, steps}'
curl -s "${H[@]}" -d "{\"agent_id\":\"$AGENT_ID\"}" $API/tasks/$TASK_ID/claim
curl -s "${H[@]}" -d "{\"agent_id\":\"$AGENT_ID\",\"status\":\"in_progress\"}" $API/tasks/$TASK_ID/progress
curl -s "${H[@]}" -d "{\"agent_id\":\"$AGENT_ID\",\"steps_done\":[\"$STEP_ID\"],\"features_met\":[\"$FEATURE_ID\"]}" $API/tasks/$TASK_ID/progress
curl -s "${H[@]}" -d '{"body":"Which auth provider should this use?","blocking":true}' $API/tasks/$TASK_ID/questions
curl -s "${H[@]}" -d '{"pr_url":"https://github.com/o/r/pull/1"}' $API/tasks/$TASK_ID/complete
```

## MCP server setup

The MCP server is a stdio process in the Boared repository (`src/mcp/server.ts`). Clone the repo, run `npm install`
once, and put the key in `~/.boared.env`:

```
PLANNER_API_KEY=cpk_...
PLANNER_API_URL=https://boared.online/api/planner
```

The **Agents & MCP** page in Boared (admins) shows these snippets filled in for your instance.

**Claude Code**

```bash
claude mcp add --scope user consflow-planner -- npx --prefix <path-to-boared> tsx <path-to-boared>/src/mcp/server.ts
```

**Cursor** (`~/.cursor/mcp.json` or `.cursor/mcp.json`)

```json
{
  "mcpServers": {
    "consflow-planner": {
      "command": "npx",
      "args": ["--prefix", "<path-to-boared>", "tsx", "<path-to-boared>/src/mcp/server.ts"],
      "env": {
        "PLANNER_API_KEY": "cpk_...",
        "PLANNER_API_URL": "https://boared.online/api/planner"
      }
    }
  }
}
```

**Antigravity (agy)**

```bash
agy mcp add consflow-planner npx --prefix <path-to-boared> tsx <path-to-boared>/src/mcp/server.ts
```

No MCP? Every tool above is one REST request: use the table and `curl`.
