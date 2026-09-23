import { describe, expect, it } from "vitest";
import { allowsAccount, allowsPlanner, normalizeScopes } from "./api-scopes";

describe("api scopes", () => {
  it("lets planner keys into the planner API only", () => {
    expect(allowsPlanner(["planner"])).toBe(true);
    expect(allowsAccount(["planner"])).toBe(false);
  });

  it("lets account keys into both APIs", () => {
    expect(allowsPlanner(["account"])).toBe(true);
    expect(allowsAccount(["account"])).toBe(true);
  });

  it("falls back to planner when a key has no known scope", () => {
    expect(normalizeScopes(["billing"])).toEqual(["planner"]);
  });

  it("keeps known scopes and drops the rest", () => {
    expect(normalizeScopes(["account", "planner", "nope"])).toEqual(["planner", "account"]);
  });
});
