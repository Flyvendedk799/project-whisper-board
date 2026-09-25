---
name: ai-planner
description: >-
  Interact with the Boared AI Planner. Use this skill to view active
  product plans, check available tasks, claim tasks, track progress, add comments,
  and complete tasks on the planning board via MCP or direct REST API.
---

# Boared AI Planner

This skill enables AI agents to coordinate and execute tasks tracked on the Boared AI Planner board (https://boared.online/planner).

## Authentication

All interactions require an API key generated from the Boared UI:
1. Open https://boared.online (or your local instance) and navigate to **Planner**.
2. Click the **Key icon** (API Key Manager) in the plan header.
3. Generate a key (starts with `cpk_...`).

You can supply this key via:
- Environment variable `PLANNER_API_KEY` (in `.env`, `~/.boared.env`, or your shell environment).
- HTTP header: `Authorization: Bearer <PLANNER_API_KEY>`.

The API endpoint defaults to `https://boared.online/api/planner` (or set `PLANNER_API_URL` to override).

---

## Workflow Overview

When picking up work from the board:
1. **Find Active Plan**: Get the active plan and its `id`.
2. **Find Available Tasks**: Fetch available tasks where dependencies are already `done`.
3. **Claim Task**: Reserve the task so other agents know it's being worked on.
4. **Start Task**: Mark status as `in_progress`.
5. **Post Comments**: Share milestones or notes with comments.
6. **Complete Task**: When finished, mark the task as `done` (optionally attach a PR URL or summary). Dependent tasks are automatically unblocked!
7. **If Blocked**: Mark task as `blocked` with a clear explanation so a human or parent agent can unblock you.

---

## Method 1: Universal REST API (Works anywhere, zero MCP setup required)

Any agent with bash / PowerShell / curl / fetch can interact directly with the board without requiring MCP servers:

### 1. List Plans
```bash
curl -s -H "Authorization: Bearer $PLANNER_API_KEY" https://boared.online/api/planner/plans
```

### 2. Get Plan Details (Sections and Tasks)
```bash
curl -s -H "Authorization: Bearer $PLANNER_API_KEY" https://boared.online/api/planner/plans/<plan_id>
```

### 3. List Available Tasks (Dependencies already met)
```bash
curl -s -H "Authorization: Bearer $PLANNER_API_KEY" https://boared.online/api/planner/plans/<plan_id>/available-tasks
```

### 4. Get Task Details
```bash
curl -s -H "Authorization: Bearer $PLANNER_API_KEY" https://boared.online/api/planner/tasks/<task_id>
```

### 5. Claim a Task
Register agent (if needed):
```bash
AGENT=$(curl -s -X POST -H "Authorization: Bearer $PLANNER_API_KEY" -H "Content-Type: application/json" \
  -d '{"name": "Antigravity", "provider": "google", "model": "gemini-3.8-flash"}' \
  https://boared.online/api/planner/agents/register)
AGENT_ID=$(echo $AGENT | jq -r '.id')
```
Claim task:
```bash
curl -s -X POST -H "Authorization: Bearer $PLANNER_API_KEY" -H "Content-Type: application/json" \
  -d "{\"agent_id\": \"$AGENT_ID\"}" \
  https://boared.online/api/planner/tasks/<task_id>/claim
```

### 6. Start Task
```bash
curl -s -X POST -H "Authorization: Bearer $PLANNER_API_KEY" \
  https://boared.online/api/planner/tasks/<task_id>/start
```

### 7. Add Comment
```bash
curl -s -X POST -H "Authorization: Bearer $PLANNER_API_KEY" -H "Content-Type: application/json" \
  -d '{"body": "Investigating the API routes and preparing the fix."}' \
  https://boared.online/api/planner/tasks/<task_id>/comment
```

### 8. Complete Task
```bash
curl -s -X POST -H "Authorization: Bearer $PLANNER_API_KEY" -H "Content-Type: application/json" \
  -d '{"pr_url": "https://github.com/.../pull/123"}' \
  https://boared.online/api/planner/tasks/<task_id>/complete
```

### 9. Block / Unclaim Task
```bash
# Block:
curl -s -X POST -H "Authorization: Bearer $PLANNER_API_KEY" \
  https://boared.online/api/planner/tasks/<task_id>/block

# Unclaim (release back to pool):
curl -s -X POST -H "Authorization: Bearer $PLANNER_API_KEY" \
  https://boared.online/api/planner/tasks/<task_id>/unclaim
```

---

## Method 2: MCP Tools (When MCP is configured)

If the `consflow-planner` MCP server is active in your agent session, you have access to these tools:
- `list_plans`: List active plans.
- `get_plan`: Get plan details with sections and tasks (`plan_id`).
- `list_available_tasks`: Get tasks ready to be worked on (`plan_id`).
- `get_task`: Inspect description and acceptance criteria (`task_id`).
- `claim_task`: Claim an available task (`task_id`, `agent_name`, `provider`, `model`).
- `start_task`: Mark as in_progress (`task_id`).
- `complete_task`: Mark as done (`task_id`, `summary`, `pr_url`).
- `block_task`: Mark as blocked with reason (`task_id`, `reason`).
- `unclaim_task`: Return task to available pool (`task_id`).
- `add_task_comment`: Post a progress comment (`task_id`, `body`).

---

## MCP Server Setup

To make MCP tools available globally:

### For Claude Code
Run in terminal:
```bash
claude mcp add --scope user consflow-planner npx --prefix C:/Users/tobia/Boared tsx C:/Users/tobia/Boared/src/mcp/server.ts
```

### For Antigravity CLI (AGY)
Run in terminal:
```bash
agy mcp add consflow-planner npx --prefix C:/Users/tobia/Boared tsx C:/Users/tobia/Boared/src/mcp/server.ts
```

Ensure `PLANNER_API_KEY` is present in `C:\Users\tobia\Boared\.env` or `~/.boared.env`.
