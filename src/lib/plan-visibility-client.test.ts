import { describe, expect, it } from "vitest";
import { clientVisibilityOf } from "./plan-visibility";

describe("clientVisibilityOf", () => {
  it("is visible only when shared with clients and attached to a project", () => {
    expect(clientVisibilityOf({ clients_can_view: true, project_id: "p1" })).toBe("visible");
  });

  it("flags a shared plan with no project, which no client can actually open", () => {
    expect(clientVisibilityOf({ clients_can_view: true, project_id: null })).toBe("no_project");
    expect(clientVisibilityOf({ clients_can_view: true })).toBe("no_project");
  });

  it("is internal when not shared, whatever the project", () => {
    expect(clientVisibilityOf({ clients_can_view: false, project_id: "p1" })).toBe("internal");
    expect(clientVisibilityOf({ clients_can_view: null, project_id: null })).toBe("internal");
    expect(clientVisibilityOf({})).toBe("internal");
  });
});
