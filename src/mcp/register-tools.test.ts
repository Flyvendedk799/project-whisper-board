import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createPlannerMcpServer } from "./create-server";
import type { PlannerToolPorts } from "./ports";

async function completeTask(post: PlannerToolPorts["planner"]["post"]) {
  const posted: string[] = [];
  const ports: PlannerToolPorts = {
    mode: "stdio",
    planner: {
      get: async () => ({}),
      post: async (path, body) => {
        posted.push(path);
        return post(path, body);
      },
    },
    account: { get: async () => ({}), request: async () => ({}) },
    resolveAgent: (id) => id,
    rememberClaim: () => {},
  };
  const { server } = createPlannerMcpServer(ports);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "1.0.0" });
  await client.connect(clientTransport);
  const result = await client.callTool({
    name: "complete_task",
    arguments: { task_id: "t1", summary: "Shipped it" },
  });
  await client.close();
  const [content] = result.content as Array<{ text: string }>;
  return { posted, isError: result.isError, body: JSON.parse(content.text) };
}

describe("complete_task", () => {
  it("returns the task without warnings when the summary comment is saved", async () => {
    const { posted, body } = await completeTask(async (path) =>
      path.endsWith("/complete") ? { id: "t1", status: "done" } : {},
    );
    expect(posted).toEqual(["tasks/t1/comment", "tasks/t1/complete"]);
    expect(body).toEqual({ id: "t1", status: "done" });
  });

  it("still completes the task but warns when the summary comment fails", async () => {
    const { posted, isError, body } = await completeTask(async (path) => {
      if (path.endsWith("/comment")) throw new Error("comment rejected");
      return { id: "t1", status: "done" };
    });
    expect(posted).toEqual(["tasks/t1/comment", "tasks/t1/complete"]);
    expect(isError).toBeFalsy();
    expect(body.status).toBe("done");
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toContain("comment rejected");
    expect(body.warnings[0]).toContain("add_task_comment");
  });
});
