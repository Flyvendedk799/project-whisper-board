import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { agentGuideText, MCP_INSTRUCTIONS, WORKFLOW_RULES } from "./agent-guide";
import { createPlannerMcpServer } from "./create-server";
import type { PlannerToolPorts } from "./ports";
import {
  REST_API_BASE,
  restUrlPath,
  searchTools,
  TOOL_CATALOG,
  TOOL_GROUPS,
  toolByName,
  toolsByGroup,
  type CatalogTool,
} from "./tool-catalog";
import { toolDescription, toolShape } from "./tool-schema";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const noopPorts: PlannerToolPorts = {
  mode: "stdio",
  planner: { get: async () => ({}), post: async () => ({}) },
  account: { get: async () => ({}), request: async () => ({}) },
  resolveAgent: (id) => id,
  rememberClaim: () => {},
};

/** Names registered via createPlannerMcpServer / registerPlannerTools (in-memory). */
function registeredTools(): string[] {
  return createPlannerMcpServer(noopPorts).registeredTools;
}

const catalogNames = TOOL_CATALOG.map((tool) => tool.name);
const skill = read(".agents/skills/ai-planner/SKILL.md").replace(/\r\n/g, "\n");

describe("tool catalog and register-tools", () => {
  it("registers every tool once", () => {
    const names = registeredTools();
    expect(names.length).toBeGreaterThan(0);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has a catalog entry for every tool the server registers", () => {
    const missing = registeredTools().filter((name) => !catalogNames.includes(name));
    expect(missing, `Add to src/mcp/tool-catalog.ts: ${missing.join(", ")}`).toEqual([]);
  });

  it("has a registration for every catalog entry", () => {
    const registered = registeredTools();
    const orphans = catalogNames.filter((name) => !registered.includes(name));
    expect(orphans, `In the catalog but not registered: ${orphans.join(", ")}`).toEqual([]);
  });

  it("lists each tool once", () => {
    expect(new Set(catalogNames).size).toBe(catalogNames.length);
  });
});

describe("tool catalog entries", () => {
  it.each(TOOL_CATALOG.map((tool) => [tool.name, tool] as const))(
    "%s is well formed",
    (_, tool) => {
      expect(TOOL_GROUPS).toContain(tool.group);
      expect(tool.summary.trim().length).toBeGreaterThan(10);
      const names = tool.params.map((param) => param.name);
      expect(new Set(names).size).toBe(names.length);
      for (const param of tool.params) expect(param.description.trim()).not.toBe("");
      // Every :placeholder in the REST path is a parameter of the tool.
      for (const [, placeholder] of (tool.rest?.path ?? "").matchAll(/:([a-z_]+)/g)) {
        expect(names, `${tool.name}: ${placeholder} is in the path but not a param`).toContain(
          placeholder,
        );
      }
    },
  );

  it("builds a zod shape and description for every tool", () => {
    for (const tool of TOOL_CATALOG) {
      expect(Object.keys(toolShape(tool.name))).toEqual(tool.params.map((param) => param.name));
      expect(toolDescription(tool.name).length).toBeGreaterThan(10);
    }
  });

  it("marks required params as required in the shape", () => {
    const shape = toolShape("claim_task");
    expect(shape.task_id.isOptional()).toBe(false);
    expect(shape.model.isOptional()).toBe(true);
    expect(toolShape("report_progress").steps_done.isOptional()).toBe(true);
  });

  it("covers the whole authoring and question surface", () => {
    for (const name of [
      "report_progress",
      "ask_question",
      "list_questions",
      "answer_question",
      "add_task_features",
      "update_task_feature",
      "add_task_steps",
      "create_section",
      "update_section",
      "create_plan",
      "update_plan",
      "create_task",
      "update_task",
      "agent_guide",
    ]) {
      expect(catalogNames).toContain(name);
    }
  });
});

describe("workspace tools", () => {
  const workspace = TOOL_CATALOG.filter((tool) => tool.group === "Workspace");

  it("covers the workspace, its projects and the whole ticket flow", () => {
    expect(workspace.map((tool) => tool.name)).toEqual([
      "get_workspace",
      "list_projects",
      "get_project",
      "update_project",
      "list_tickets",
      "get_ticket",
      "create_ticket",
      "update_ticket",
      "create_task_from_ticket",
    ]);
  });

  it("calls the workspace API, and says it needs an account key", () => {
    for (const tool of workspace) {
      expect(tool.rest?.api, tool.name).toBe("account");
      expect(tool.description ?? "", tool.name).toMatch(/account scope/);
    }
    expect(TOOL_CATALOG.filter((tool) => tool.group !== "Workspace" && tool.rest?.api)).toEqual([]);
  });

  it("shows the URL under the API each tool calls", () => {
    expect(restUrlPath(toolByName("list_tickets").rest!)).toBe(
      "/api/v1/tickets?project_id=&status=",
    );
    expect(restUrlPath(toolByName("update_ticket").rest!)).toBe("/api/v1/tickets/:ticket_id");
    expect(restUrlPath(toolByName("get_plan").rest!)).toBe("/api/planner/plans/:plan_id");
  });

  it("offers the ticket statuses and types the API accepts", () => {
    expect(toolShape("list_tickets").status.safeParse("open").success).toBe(true);
    expect(toolShape("list_tickets").status.safeParse("closed").success).toBe(false);
    expect(toolShape("create_ticket").type.safeParse("change_request").success).toBe(true);
    expect(toolShape("create_ticket").priority.safeParse("critical").success).toBe(false);
  });

  it("requires what the API requires", () => {
    expect(toolShape("create_ticket").project_id.isOptional()).toBe(false);
    expect(toolShape("create_ticket").title.isOptional()).toBe(false);
    expect(toolShape("create_task_from_ticket").plan_id.isOptional()).toBe(false);
    expect(toolShape("create_task_from_ticket").section_id.isOptional()).toBe(true);
    expect(toolShape("update_ticket").status.isOptional()).toBe(true);
  });
});

describe("the skill", () => {
  it("is named ai-planner", () => {
    expect(skill).toMatch(/^---\nname: ai-planner\n/);
  });

  it.each(catalogNames)("mentions the tool %s", (name) => {
    expect(skill, `Add ${name} to .agents/skills/ai-planner/SKILL.md`).toContain(name);
  });

  it("lists the REST path of every tool", () => {
    const missing: string[] = [];
    for (const tool of TOOL_CATALOG as readonly CatalogTool[]) {
      if (!tool.rest) continue;
      for (const candidate of tool.rest.path.split(" or ")) {
        // The workspace API is listed with its full path; the planner's paths are relative to it.
        const route = candidate.split("?")[0];
        const listed = tool.rest.api === "account" ? `${REST_API_BASE.account}/${route}` : route;
        if (!skill.includes(listed)) missing.push(`${tool.name}: ${listed}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("states the progress rules agents have to follow", () => {
    expect(skill).toMatch(/Claim before working/);
    expect(skill).toMatch(/only when `note` is non-empty/);
    expect(skill).toMatch(/work_target/);
  });
});

describe("the agent guide", () => {
  it("only names tools that exist", () => {
    const verbs =
      /^(list|get|claim|start|complete|block|unclaim|add|ask|answer|create|update|import|set|check|merge|report|dismiss|view)_/;
    const text = [MCP_INSTRUCTIONS, agentGuideText(), ...WORKFLOW_RULES.map((rule) => rule.body)];
    for (const [token] of text.join("\n").matchAll(/\b[a-z]+(?:_[a-z]+)+\b/g)) {
      if (verbs.test(token)) expect(catalogNames, `${token} is not a tool`).toContain(token);
    }
  });

  it("tells agents to claim, tick, ask and check the work target", () => {
    for (const phrase of ["claim_task", "report_progress", "ask_question", "work_target"]) {
      expect(MCP_INSTRUCTIONS).toContain(phrase);
    }
    expect(MCP_INSTRUCTIONS).toMatch(/only when `note` is not empty/);
  });

  it("is numbered rule by rule", () => {
    expect(MCP_INSTRUCTIONS).toContain(`${WORKFLOW_RULES.length}. `);
    expect(new Set(WORKFLOW_RULES.map((rule) => rule.id)).size).toBe(WORKFLOW_RULES.length);
  });
});

describe("catalog helpers", () => {
  it("groups tools in group order and drops nothing", () => {
    const grouped = toolsByGroup();
    expect(grouped.map((entry) => entry.group)).toEqual([...TOOL_GROUPS]);
    expect(grouped.flatMap((entry) => entry.tools)).toHaveLength(TOOL_CATALOG.length);
  });

  it("searches names, summaries, paths and parameters", () => {
    expect(searchTools("").length).toBe(TOOL_CATALOG.length);
    expect(searchTools("report_progress").map((tool) => tool.name)).toContain("report_progress");
    expect(searchTools("features_met").map((tool) => tool.name)).toContain("report_progress");
    expect(searchTools("questions").map((tool) => tool.name)).toContain("ask_question");
    expect(searchTools("zzzz-no-such-thing")).toEqual([]);
  });
});
