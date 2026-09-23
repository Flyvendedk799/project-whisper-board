import { describe, expect, it } from "vitest";
import { matchAccountRoute } from "./account-route";

const ID = "42e59bac-2151-4f3c-a470-1854c4aea567";

describe("matchAccountRoute", () => {
  it("maps the collection and detail paths", () => {
    expect(matchAccountRoute("")).toEqual({ name: "index" });
    expect(matchAccountRoute("projects")).toEqual({ name: "projects" });
    expect(matchAccountRoute(`projects/${ID}`)).toEqual({ name: "project", id: ID });
    expect(matchAccountRoute(`tickets/${ID}/tasks`)).toEqual({ name: "ticketTasks", id: ID });
    expect(matchAccountRoute(`plans/${ID}/tasks`)).toEqual({ name: "planTasks", id: ID });
  });

  it("rejects a path that is not a workspace resource", () => {
    expect(matchAccountRoute("projects/not-a-uuid")).toBeNull();
    expect(matchAccountRoute("billing")).toBeNull();
  });
});
