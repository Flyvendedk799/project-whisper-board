import { describe, expect, it } from "vitest";
import { TOOL_CATALOG } from "./tool-catalog";
import {
  assertHostedToolAllowed,
  HOSTED_TOOL_POLICY,
  InsufficientScopeError,
  requiredScopesForCall,
  unmappedCatalogTools,
} from "./tool-policy";

describe("hosted tool policy", () => {
  it("maps every catalog tool", () => {
    expect(unmappedCatalogTools()).toEqual([]);
    for (const tool of TOOL_CATALOG) {
      expect(HOSTED_TOOL_POLICY[tool.name], tool.name).toBeDefined();
    }
  });

  it("allows agent_guide with any token", () => {
    expect(() => assertHostedToolAllowed("agent_guide", [])).not.toThrow();
  });

  it("requires planner:read for list_plans", () => {
    expect(() => assertHostedToolAllowed("list_plans", [])).toThrow(InsufficientScopeError);
    expect(() => assertHostedToolAllowed("list_plans", ["planner:read"])).not.toThrow();
  });

  it("defaults merge dry-run to read scopes; actual merge needs write+merge", () => {
    expect(requiredScopesForCall("merge_plan_pull_requests", {})).toEqual([
      "planner:read",
      "github:read",
    ]);
    expect(requiredScopesForCall("merge_plan_pull_requests", { dry_run: false })).toEqual([
      "planner:read",
      "planner:write",
      "github:read",
      "github:merge",
    ]);
  });

  it("create_task_from_ticket needs account+planner read/write", () => {
    expect(HOSTED_TOOL_POLICY.create_task_from_ticket.scopes).toEqual([
      "account:read",
      "account:write",
      "planner:read",
      "planner:write",
    ]);
  });
});
