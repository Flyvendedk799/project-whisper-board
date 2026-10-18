import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpOAuthPrincipal } from "@/lib/integration-principal";

const handleAccountRequest = vi.fn();
const handlePlannerRequest = vi.fn();

vi.mock("@/lib/account-api", () => ({
  handleAccountRequest: (...args: unknown[]) => handleAccountRequest(...args),
}));
vi.mock("@/lib/planner-api", () => ({
  handlePlannerRequest: (...args: unknown[]) => handlePlannerRequest(...args),
}));

const { createInProcessAccountPort, createInProcessPlannerPort } =
  await import("./in-process-client");

const principal: McpOAuthPrincipal = {
  kind: "mcp_oauth",
  grantId: "g1",
  clientId: "c1",
  workspaceId: "00000000-0000-0000-0000-000000000001",
  userId: "00000000-0000-0000-0000-000000000002",
  scopes: ["planner:read", "account:read"],
};

const ok = () => new Response("[]", { status: 200 });

describe("in-process ports route on the path without its query string", () => {
  beforeEach(() => {
    handleAccountRequest.mockReset().mockImplementation(async () => ok());
    handlePlannerRequest.mockReset().mockImplementation(async () => ok());
  });

  it("account GET: the handler routes on `tickets`, and still reads the filters from the request", async () => {
    await createInProcessAccountPort(principal).get("tickets?project_id=p1&status=open");
    const [request, , path] = handleAccountRequest.mock.calls[0] as [Request, unknown, string];
    expect(path).toBe("tickets");
    const url = new URL(request.url);
    expect(url.pathname).toBe("/api/v1/tickets");
    expect(url.searchParams.get("status")).toBe("open");
    expect(url.searchParams.get("project_id")).toBe("p1");
  });

  it("account request with a method: the same", async () => {
    await createInProcessAccountPort(principal).request("tickets/t1?x=1", { method: "PATCH" });
    const [request, , path] = handleAccountRequest.mock.calls[0] as [Request, unknown, string];
    expect(path).toBe("tickets/t1");
    expect(request.method).toBe("PATCH");
    expect(new URL(request.url).searchParams.get("x")).toBe("1");
  });

  it("planner GET and POST: the handler routes on the path, the query stays on the request", async () => {
    const port = createInProcessPlannerPort(principal);
    await port.get("plans?status=all");
    await port.post("tasks/t1/progress?x=1", { status: "in_progress" });
    const [getRequest, , getPath] = handlePlannerRequest.mock.calls[0] as [
      Request,
      unknown,
      string,
    ];
    expect(getPath).toBe("plans");
    expect(new URL(getRequest.url).searchParams.get("status")).toBe("all");
    const [, , postPath] = handlePlannerRequest.mock.calls[1] as [Request, unknown, string];
    expect(postPath).toBe("tasks/t1/progress");
  });

  it("a path without a query is passed on unchanged", async () => {
    await createInProcessAccountPort(principal).get("workspace");
    await createInProcessPlannerPort(principal).get("plans/p1");
    expect((handleAccountRequest.mock.calls[0] as unknown[])[2]).toBe("workspace");
    expect((handlePlannerRequest.mock.calls[0] as unknown[])[2]).toBe("plans/p1");
  });
});
