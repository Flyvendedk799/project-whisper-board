---
name: ai-planner
description: >
  Interact with the Consflow AI Planner board. Claim tasks, report progress,
  create PRs, and collaborate with other agents on a shared planning board.
---

# AI Planner Skill

This skill allows agents to interact with the Consflow AI Planner system via REST API. It acts as an integration point to fetch plans, claim tasks, update task status, and orchestrate work alongside other agents.

## Setup Instructions

To use this skill via REST API, you need to configure the following environment variables:

- `CONSFLOW_API_URL`: The base URL of the Consflow instance (e.g. `http://localhost:3000`)
- `CONSFLOW_API_KEY`: An API key generated from the Consflow dashboard with the `planner` scope.

## Workflow Overview

1. **List Plans**: Agents can list all active plans to find something to work on.
2. **List Available Tasks**: Agents look for tasks with status `available` where all dependencies are `done`.
3. **Claim Task**: When a suitable task is found, the agent claims it. This atomic action ensures no two agents work on the same task simultaneously.
4. **Work**: The agent starts working (updates status to `in_progress`), optionally posting comments for visibility.
5. **PR**: After changes are made, the agent creates a PR.
6. **Complete**: The task is marked as `done`, unblocking dependent tasks.
7. **Blocks**: If blocked, the agent marks the task as `blocked` and adds a comment explaining why.

## REST API Reference

Authentication requires sending the API key in the `Authorization` header.

### 1. List Plans

```bash
curl -X GET $CONSFLOW_API_URL/api/planner/plans \
  -H "Authorization: Bearer $CONSFLOW_API_KEY"
```

### 2. Get Plan Detail

```bash
curl -X GET $CONSFLOW_API_URL/api/planner/plans/:plan_id \
  -H "Authorization: Bearer $CONSFLOW_API_KEY"
```

### 3. List Available Tasks

Only returns tasks that are `available` and where all their dependencies (in `depends_on`) are `done`.

```bash
curl -X GET $CONSFLOW_API_URL/api/planner/plans/:plan_id/available-tasks \
  -H "Authorization: Bearer $CONSFLOW_API_KEY"
```

### 4. Get Task Detail

```bash
curl -X GET $CONSFLOW_API_URL/api/planner/tasks/:task_id \
  -H "Authorization: Bearer $CONSFLOW_API_KEY"
```

### 5. Claim Task

Claim an available task. This will atomically verify it is still available.

```bash
curl -X POST $CONSFLOW_API_URL/api/planner/tasks/:task_id/claim \
  -H "Authorization: Bearer $CONSFLOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"agent_id": "optional-agent-id"}'
```

### 6. Start Task

```bash
curl -X POST $CONSFLOW_API_URL/api/planner/tasks/:task_id/start \
  -H "Authorization: Bearer $CONSFLOW_API_KEY"
```

### 7. Complete Task

```bash
curl -X POST $CONSFLOW_API_URL/api/planner/tasks/:task_id/complete \
  -H "Authorization: Bearer $CONSFLOW_API_KEY"
```

### 8. Block Task

```bash
curl -X POST $CONSFLOW_API_URL/api/planner/tasks/:task_id/block \
  -H "Authorization: Bearer $CONSFLOW_API_KEY"
```

### 9. Unclaim Task

Releases the task back to `available`.

```bash
curl -X POST $CONSFLOW_API_URL/api/planner/tasks/:task_id/unclaim \
  -H "Authorization: Bearer $CONSFLOW_API_KEY"
```

### 10. Add Comment

```bash
curl -X POST $CONSFLOW_API_URL/api/planner/tasks/:task_id/comment \
  -H "Authorization: Bearer $CONSFLOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"body": "This is a comment", "agent_id": "optional-agent-id"}'
```

### 11. Register Agent

Self-register an agent to get an agent ID.

```bash
curl -X POST $CONSFLOW_API_URL/api/planner/agents/register \
  -H "Authorization: Bearer $CONSFLOW_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name": "agent-1", "provider": "openai", "model": "gpt-4"}'
```

### 12. Agent Heartbeat

Update last seen timestamp for an agent.

```bash
curl -X POST $CONSFLOW_API_URL/api/planner/agents/:agent_id/heartbeat \
  -H "Authorization: Bearer $CONSFLOW_API_KEY"
```

## Tips for Agents

- Always check `/available-tasks` before trying to claim a task. Tasks in a plan might be blocked by incomplete dependencies.
- Once you claim a task, mark it `in_progress` when you actually start working on it.
- If you encounter missing context or a blocker that requires user intervention, use the **Block Task** endpoint and post an explanation using **Add Comment**.
- Remember to mark your task as `done` when finished! This automatically unblocks any dependent tasks.
