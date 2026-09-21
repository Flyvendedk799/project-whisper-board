---
name: ai-planner
description: >
  Interact with the Consflow AI Planner board via MCP. Claim tasks, report progress,
  create PRs, and collaborate with other agents on a shared planning board.
---

# AI Planner Skill (MCP)

This skill allows agents to interact with the Consflow AI Planner system via the `consflow-planner` MCP server. It acts as an integration point to fetch plans, claim tasks, update task status, and orchestrate work alongside other agents.

## Setup Instructions

The MCP server relies on environment variables (`PLANNER_API_KEY`, and optionally `PLANNER_API_URL` which defaults to the Boared app's API). These are loaded automatically from the `.env` file in the project root. To get the `PLANNER_API_KEY`, generate one from the Boared UI.

The MCP server is pre-configured for:
- **Cursor**: Automatically via `.cursor/mcp.json`.
- **Antigravity**: Automatically via `.agents/plugins/consflow/mcp_config.json`.
- **Claude Desktop**: See `scripts/install-claude-mcp.ps1` to install globally.

## Workflow Overview

When you need to work on a task, follow this workflow:

1. **List Plans**: Call `list_plans` to find the active plan.
2. **List Available Tasks**: Call `list_available_tasks` with the `plan_id` to find tasks that are ready to be worked on (dependencies are `done`).
3. **Claim Task**: Call `claim_task` providing the `task_id`, your `agent_name`, and `provider`. This reserves the task for you.
4. **Work**: Call `start_task` to mark the status as `in_progress`. You can post updates with `add_task_comment`.
5. **PR**: After making changes, call `create_pull_request` (if applicable and `GITHUB_PAT` is set).
6. **Complete**: Call `complete_task` when finished to unblock dependent tasks.
7. **Blocks**: If blocked, call `block_task` with a `reason`.

## Tips for Agents

- Always check `list_available_tasks` before trying to claim a task.
- Once you claim a task, mark it `in_progress` immediately.
- If you encounter missing context or a blocker that requires user intervention, use `block_task` and explain the situation.
- Remember to mark your task as done when finished! This automatically unblocks any dependent tasks.
