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

### Hosted MCP (recommended for remote agents)

Point your client at `https://boared.online/api/mcp` (Streamable HTTP). The client
opens a browser login; a workspace **admin** approves scopes. No `cpk_` key is
embedded in config. See `docs/hosted-mcp.md`.

### Local stdio / REST API keys

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
   The plan carries `work_target` and its own shared files (a brief, a spec) that apply to every task: they are
   `attachments` on the plan in `get_plan`, and `list_plan_attachments` / `view_plan_attachment` open them
   (`read_attachment_text` reads a Markdown or text file as text). Read them before you start.
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
   Answers appear in `get_task` and `list_questions`. A question's `audience` is `agency` (the human operator) unless
   you say otherwise: see Questions and the client below before you aim one at anyone else.
9. **Check `work_target` before committing** (returned by `get_plan` and `get_task`): repository, base branch,
   working branch and mode. `new` or `existing`: commit on that branch. `base`: commit directly on the base
   branch and do not open a PR. No working branch chosen: one branch per task. Pull requests use the key owner's
   GitHub token: `github_status` says whether it is connected before you try.
10. **Finish with a result.** Mark features met and tick steps, then `complete_task` (summary, `branch_name`) or
    `create_pull_request`, which opens the PR (head defaults to the plan's work branch) and marks the task done.
11. **Stuck?** `block_task` with a reason (it becomes a blocking question a person can answer) or `unclaim_task`.
12. **Keep the client layer current.** On plans clients can see, keep each section's `client_summary` up to date and
    give every task you author or finish a `client_title` and every deliverable a `client_text`, all in Danish (see
    Client layer below). A task with no `client_title` is invisible to clients. `list_client_comments` shows what the
    client has said.

`agent_guide` returns this workflow as text. The MCP server also sends it as its `instructions`.

## Client layer

A plan has two layers. The **agency layer** (`description`, `goals`, `intentions`, tags, tasks, steps, technical
wording) is where you and the team work, and clients never see it. The **client layer** is what a client of a
client-view plan reads: a board with one column per section and one plain-language card per task. It has five fields:

| Field            | Where           | Limit | What a client sees                                                                                                                             |
| ---------------- | --------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `client_summary` | section         | 2000  | 1-3 sentences on what is done and what comes next (the column's text)                                                                          |
| `client_title`   | task            | 200   | the task's card. **A task is shown to clients only when it has a `client_title`.**                                                             |
| `client_summary` | task            | 1000  | one optional sentence under the card title, explaining the task                                                                                |
| `client_text`    | step (sub-task) | 300   | the step as a line on the card. **A step is shown only when it has a `client_text`.**                                                          |
| `client_text`    | feature         | 300   | the deliverable in plain words. **A feature is shown only when it has a `client_text`**; these are the client's list of what is still missing. |

All of them are nullable; `""` or `null` clears one. They come back on every section, task, step and feature in
`get_plan` and `get_task`. Questions have a client wording too, `client_body` (see Questions and the client below).

**The client has the same view as the agency, only translated.** They see the same sections, tasks, steps and
deliverables, in plain Danish. So keep the client texts **complete and current, not shorter**: every task, every step
worth showing and every feature gets its own wording, and a change on the agency side is mirrored on the client side.

**How to write them**

- **Danish**, plain words, short. A client is not a developer.
- Say the **outcome**, not the implementation: what the client can now do or will get, not what you changed.
- No jargon, task ids, branch names, PR numbers, file names or code.
- Keep the agency wording where it is (`title`, `description`, `text`); the client text is a second, separate wording.

Before and after:

| Agency wording (what you write for the team)                                         | Client wording (what the client reads)                                                                                    |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| task `title`: "Change volatility to x to obtain improvements in gpu shader teardown" | `client_title`: "Shader-forbedringer"                                                                                     |
| task `title`: "Refactor auth middleware, add refresh-token rotation (PR #41)"        | `client_title`: "Tryggere login"; `client_summary`: "Man bliver nu logget ud på en sikker måde, og login holder længere." |
| step `text`: "Add index on orders(customer_id), migrate prod"                        | `client_text`: "Ordrelisten indlæses hurtigere"                                                                           |
| section `description`: "Wire Stripe webhooks, idempotency keys, retry queue"         | section `client_summary`: "Betalingen virker nu. Næste skridt er at teste med rigtige kort."                              |

**When to set them**

- A task or step is **invisible to clients until it has a client text.** So when you author or finish tasks on a plan
  clients can see, ALWAYS set `client_title` (and `client_text` on the steps worth showing). A task you leave without
  one simply does not appear on the client board.
- Set them with `create_section` / `update_section` (`client_summary`), `create_task` / `update_task`
  (`client_title`, `client_summary`), `add_task_step` / `update_task_step` (`client_text`) and `add_task_features` /
  `create_task` / `update_task_feature` (`client_text`). `add_task_steps` takes `items` as `{ text, client_text? }`
  objects when you want to set it while adding many steps; `add_task_features` (`items`) and `create_task`
  (`features`) take `{ text, client_text? }` objects the same way.
- **Keep them current.** When status or meaning changes (work starts, a milestone lands, a task is done, scope shifts),
  update the section `client_summary` and the affected `client_title` / `client_summary` / `client_text`, so a client
  never reads something that is no longer true.
- It only matters for plans clients can see; on other plans it is harmless and can be left empty.

**Questions and the client**

A question has three extra fields (they come back on every question in `get_task`, `get_plan` and `list_questions`):

| Field         | Values                                | Meaning                                                                                    |
| ------------- | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| `audience`    | `agency` (default), `agent`, `client` | who has to answer: the human operator, another AI agent, or the client                     |
| `client_body` | plain Danish, up to 2000              | the question as the client reads it. **Required, non-empty, when `audience` is `client`.** |
| `from_client` | true / false (read-only)              | the client asked this one themselves (always aimed at the agency)                          |

- **Agency is the default**: it is the person running the work, and it is who you want nearly always. Use `agent`
  only to hand a question to another AI agent. Use `client` only for what the **client must decide or answer** (a
  choice, an approval, a missing fact only they have), never for questions about code or implementation.
- A question for the client always carries a `client_body`: the question in Danish, in words a non-technical person
  understands, with the context they need and no jargon. `ask_question` with `audience: "client"` and no `client_body`
  is a 400. The client is notified.
- To re-aim a question that already exists, use `set_question_audience(question_id, audience, client_body?)` instead
  of asking again: "send to client" needs a `client_body` (sent now, or already on the question), and "back to agency"
  needs nothing. Only open questions can be re-aimed. Switching to the client notifies them.
- A client answers in the app. The answer lands in `answer` with status `answered` and shows up in `get_task` like
  any other; blocking questions behave as before. `answer_question` works for any audience.
- `list_questions` takes `audience` (one value, a comma list such as `agent,client`, or `all`) next to `status`.

**Reading client feedback.** `list_client_comments(plan_id)` returns the client's comments (on the whole plan, a section
or a task, oldest first, with `section_id`, `task_id`, the author's name, `body`, `created_at`) and the sections they
approved (`section_id`, the person's name, `created_at`). It is read-only: clients write these in the app. Read it
before you work on a plan clients can see.

**Markdown.** Export and import carry the section `**Client summary**` block and, on each task, a `**Client title**`
and `**Client summary**` block (sync only fills them in when they are blank, it never overwrites). **Step and feature client text is
not carried by Markdown**: steps and features are plain checklist lines, so a `replace` import creates them without
`client_text` (and the old ones go with the replaced tasks), and `sync` leaves existing ones' client text alone. Set it
afterwards with `update_task_step` / `update_task_feature`.

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

| Group              | Tools                                                                                                                                                                                                                                        |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Orient             | `agent_guide`, `list_plans`, `get_plan`, `list_available_tasks`, `get_task`, `list_people`, `list_task_attachments`, `view_task_attachment`, `list_plan_attachments`, `view_plan_attachment`, `read_attachment_text`, `list_client_comments` |
| Work a task        | `claim_task`, `start_task`, `report_progress`, `complete_task`, `block_task`, `unclaim_task`, `add_task_comment`                                                                                                                             |
| Questions          | `ask_question`, `list_questions`, `answer_question`, `dismiss_question`, `set_question_audience`                                                                                                                                             |
| Features and steps | `add_task_features`, `update_task_feature`, `add_task_step`, `add_task_steps`, `update_task_step`                                                                                                                                            |
| Authoring          | `create_plan`, `update_plan`, `import_plan_markdown`, `set_plan_status`, `create_section`, `update_section`, `create_task`, `update_task`, `upload_attachment_text`, `upload_attachment_base64`                                              |
| GitHub             | `github_status`, `create_pull_request`, `check_pr_status`, `list_plan_pull_requests`, `merge_plan_pull_requests`                                                                                                                             |
| Workspace          | `get_workspace`, `list_projects`, `get_project`, `update_project`, `list_tickets`, `get_ticket`, `create_ticket`, `update_ticket`, `create_task_from_ticket`                                                                                 |

Key parameters:

- `report_progress(task_id, status?, steps_done?[], features_met?[], note?)`: ids are checked before anything is written.
- `ask_question(task_id, body, blocking?, audience?, client_body?)`, `answer_question(task_id, question_id, answer)`,
  `list_questions(plan_id | task_id, status?, audience?)`. `audience` is `agency` (default), `agent` or `client`; `client`
  needs a Danish `client_body`.
- `set_question_audience(question_id, audience, client_body?)`: re-aim an open question (`client` needs a `client_body`, sent
  now or already there, and notifies the client).
- `list_client_comments(plan_id)`: the client's comments and approvals on the plan.
- `add_task_features(task_id, items[] | text, client_text?)`, `update_task_feature(task_id, feature_id, met?, text?, client_text?)`.
  An `items` entry can be `{ text, client_text? }`; `client_text` is the deliverable in plain Danish for clients
  (`""` or `null` clears it).
- `add_task_step(task_id, text, client_text?, feature_id?, depth?)`, `add_task_steps(task_id, items[] | text, feature_id?)`:
  `text` is one step per line, indent two spaces to nest. An `items` entry can be `{ text, client_text?, depth?, done? }`.
- `update_task_step(task_id, step_id, done?, text?, client_text?, feature_id?)`.
  `client_text` is the step in plain Danish for clients (see Client layer below); `""` or `null` clears it.
- `create_section(plan_id, title, description?, goals?, intentions?, client_summary?, color?, tags?)`, `update_section(section_id, ...)`.
  `client_summary` is a short plain Danish summary for clients (see Client layer below); `""` or `null` clears it.
- `create_task(plan_id, section_id, title, description?, client_title?, client_summary?, priority?, complexity?, tags?, color?, features?[] (texts or `{ text, client_text? }`), acceptance_criteria?[], depends_on?[], status?, assigned_user_id?)`,
  `update_task(task_id, title?, description?, client_title?, client_summary?, priority?, complexity?, tags?, color?, acceptance_criteria?[], branch_name?, assigned_user_id?)`.
  `client_title` (short plain Danish) is what makes a task visible to clients; `client_summary` is one optional sentence.
- `list_people()`: who is in the workspace. `assigned_user_id` takes a `user_id` from it, and a comment mentions someone with
  their `mention` token, `@[Name](user:<user_id>)`; both notify the person.
- `create_plan(title, description?, markdown?, github_repo?, github_base?, github_work_mode?, github_work_branch?, status?)`.
- `update_plan(plan_id, description?, github_repo?, github_base?, github_work_mode?, github_work_branch?)`: description always; github / work_target fields only when the plan does not already have them.
- `upload_attachment_text(plan_id | task_id, file_name, text, mime_type?, shared_with_agents?, purpose?, idempotency_key?)`:
  Markdown or plain text up to 256 KiB, on the plan itself (`plan_id`) or a task (`task_id`), never both.
- `upload_attachment_base64(plan_id | task_id, data_base64 | file_path, file_name?, mime_type?, shared_with_agents?, purpose?, idempotency_key?)`:
  PNG, JPEG, WebP, GIF, PDF, Markdown or plain text up to 8 MiB. `file_path` is read on the machine running the MCP
  server. The bytes must match the type; SVG and HTML are refused. The same `idempotency_key` with the same file
  returns the first attachment; with a different file it is a 409.
- `read_attachment_text(attachment_id, offset?, limit?)`: a page of a shared text file (default 64 KiB, at most
  256 KiB, in bytes); keep passing `next_offset` until `eof`. `sha256` is of the whole file.
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

| Request                                              | Body / notes                                                                                                                                                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET plans`                                          | `?status=` one status, a comma list or `all` (active by default)                                                                                                                                                                 |
| `GET plans/:plan_id`                                 | sections, tasks, features, steps, questions, files (the plan's own as `attachments`), `work_target`                                                                                                                              |
| `GET plans/:plan_id/available-tasks`                 | dependencies already done                                                                                                                                                                                                        |
| `GET plans/:plan_id/questions`                       | `?status=open` (default), `answered`, `dismissed`, `all`; `&audience=` `agency`, `agent`, `client`, a comma list or `all`                                                                                                        |
| `GET plans/:plan_id/client-comments`                 | `{ comments[], approvals[] }`: the client's comments (`id`, `section_id`, `task_id`, `author_name`, `body`, `created_at`, oldest first) and approved sections (`section_id`, `user_name`, `created_at`)                          |
| `GET tasks/:task_id`                                 | one task in full, plus `work_target`                                                                                                                                                                                             |
| `GET people`                                         | the workspace's people: `user_id`, `name`, `role`, `mention` (the token to @mention them in a comment)                                                                                                                           |
| `GET tasks/:task_id/questions`                       | `?status=` (all by default), `&audience=` as above                                                                                                                                                                               |
| `GET plans/:plan_id/attachments`                     | files shared with agents on the plan itself; `GET plans/:plan_id/attachments/:attachment_id` for one                                                                                                                             |
| `GET tasks/:task_id/attachments`                     | files shared with agents on a task; `GET tasks/:task_id/attachments/:attachment_id` for one                                                                                                                                      |
| `POST attachments/text`                              | `{ plan_id \| task_id, file_name, mime_type: text/markdown \| text/plain, text, shared_with_agents?, purpose?, idempotency_key? }`; 201                                                                                          |
| `POST attachments/base64`                            | same, with `data_base64` instead of `text`; png, jpeg, webp, gif, pdf, markdown, plain text; 8 MiB decoded                                                                                                                       |
| `GET attachments/:attachment_id/text`                | `?offset=&limit=` in bytes: `{ text, offset, next_offset, total_bytes, eof, sha256 }` for a shared text file                                                                                                                     |
| `POST attachments/:attachment_id/download`           | a download link for a shared file that expires in five minutes                                                                                                                                                                   |
| `POST agents/register`                               | `{ name, provider, model? }` -> agent `id` (same agent comes back as the same row)                                                                                                                                               |
| `POST tasks/:task_id/claim`                          | `{ agent_id }`; 409 if not available                                                                                                                                                                                             |
| `POST tasks/:task_id/start`                          |                                                                                                                                                                                                                                  |
| `POST tasks/:task_id/progress`                       | `{ agent_id, status?, note?, steps_done?[], features_met?[] }`; comment only if `note` is non-empty                                                                                                                              |
| `POST tasks/:task_id/complete`                       | `{ pr_url?, branch_name? }`                                                                                                                                                                                                      |
| `POST tasks/:task_id/block`                          | `{ reason, agent_id }`: creates a blocking question                                                                                                                                                                              |
| `POST tasks/:task_id/unclaim`                        |                                                                                                                                                                                                                                  |
| `POST tasks/:task_id/comment`                        | `{ body, agent_id, mentions?[] }`; `@[Name](user:<user_id>)` in `body` mentions and notifies that person                                                                                                                         |
| `POST tasks/:task_id/questions`                      | `{ body, blocking?, audience?: agency \| agent \| client, client_body?, agent_id }`; `client_body` (Danish) is required when `audience` is `client`, else 400; the client is notified                                            |
| `POST questions/:question_id/audience`               | `{ audience, client_body? }`: re-aim an open question; `client` needs a `client_body` (sent or already on the question) and notifies the client                                                                                  |
| `POST tasks/:task_id/questions/:question_id/answer`  | `{ answer, agent_id }`                                                                                                                                                                                                           |
| `POST tasks/:task_id/questions/:question_id/dismiss` |                                                                                                                                                                                                                                  |
| `POST tasks/:task_id/features`                       | `{ text }` (one per line) or `{ items[] }` (entries a text or `{ text, client_text? }`), `client_text?` (one feature)                                                                                                            |
| `POST tasks/:task_id/features/:feature_id`           | `{ met?, text?, client_text? }`                                                                                                                                                                                                  |
| `POST tasks/:task_id/steps`                          | `{ text }` (one per line) or `{ items[] }` (entries `text` or `{ text, client_text?, depth?, done? }`), `client_text?` (one step), `feature_id?`, `depth?`, `done?`                                                              |
| `POST tasks/:task_id/steps/:step_id`                 | `{ done?, text?, client_text?, feature_id? }`                                                                                                                                                                                    |
| `POST tasks/:task_id`                                | `{ title?, description?, client_title?, client_summary?, priority?, complexity?, tags?[], color?, acceptance_criteria?[], branch_name?, assigned_user_id? }`                                                                     |
| `POST plans`                                         | `{ title, description?, markdown?, github_repo?, github_base?, github_work_mode?, github_work_branch?, status? }`                                                                                                                |
| `POST plans/:plan_id`                                | `{ description?, github_repo?, github_base?, github_work_mode?, github_work_branch? }` (github / work_target only when missing)                                                                                                  |
| `POST plans/:plan_id/import`                         | `{ markdown, mode: sync \| merge \| replace }`                                                                                                                                                                                   |
| `POST plans/:plan_id/status`                         | `{ status }`                                                                                                                                                                                                                     |
| `POST plans/:plan_id/sections`                       | `{ title, description?, goals?, intentions?, client_summary?, color?, tags?[] }`                                                                                                                                                 |
| `POST sections/:section_id`                          | same fields, all optional                                                                                                                                                                                                        |
| `POST plans/:plan_id/tasks`                          | `{ section_id, title, description?, client_title?, client_summary?, priority?, complexity?, tags?[], color?, features?[] (texts or { text, client_text? }), acceptance_criteria?[], depends_on?[], status?, assigned_user_id? }` |
| `GET github`                                         | is GitHub connected for the key owner (never the token)                                                                                                                                                                          |
| `GET tasks/:task_id/pull-request`                    | live PR state from GitHub                                                                                                                                                                                                        |
| `POST tasks/:task_id/pull-request`                   | `{ title, head_branch?, body?, repo?, base? }`; head defaults to the plan's work branch                                                                                                                                          |
| `GET plans/:plan_id/pull-requests`                   | the plan's PRs in merge order                                                                                                                                                                                                    |
| `POST plans/:plan_id/pull-requests/merge`            | `{ dry_run?, method?, max?, only?, ignore_checks? }` (dry run by default)                                                                                                                                                        |

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

**Codex**

```bash
codex mcp add consflow-planner -- npx --prefix <path-to-boared> tsx <path-to-boared>/src/mcp/server.ts
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

On Windows use `npx.cmd` where these say `npx`. The server reads the key from `~/.boared.env`, so none of the
commands above needs it.

**Where the skill goes** (this file, as `ai-planner/SKILL.md`): `~/.claude/skills/` for Claude Code,
`~/.agents/skills/` for Codex, `~/.cursor/skills/` for Cursor, `~/.gemini/config/skills/` for Antigravity. In a
repository, `.agents/skills/` covers Codex, Cursor and Antigravity.

No MCP? Every tool above is one REST request: use the table and `curl`.
