import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  decoratePlanForAgents,
  groupByTask,
  sharedAttachments,
  type AgentAttachment,
} from "./agent-media";

const file = (id: string, task_id: string | null): AgentAttachment => ({
  id,
  task_id,
  comment_id: null,
  file_name: `${id}.pdf`,
  mime_type: "application/pdf",
  size_bytes: 10,
  kind: "doc",
  marked_up: false,
  source_attachment_id: null,
  created_at: "2026-10-03T10:00:00Z",
  url: null,
  url_expires_in: 3600,
});

/**
 * A stand-in for the service-role client that records the filters a query was
 * given and answers with `rows`, however they are chained.
 */
function fakeAdmin(rows: Array<Record<string, unknown>>) {
  const calls: Array<[string, ...unknown[]]> = [];
  const query: Record<string, unknown> = {
    then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
  };
  for (const method of ["select", "eq", "is", "order"]) {
    query[method] = (...args: unknown[]) => {
      calls.push([method, ...args]);
      return query;
    };
  }
  const admin = {
    from: vi.fn(() => query),
    storage: {
      from: () => ({
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}` })),
          error: null,
        }),
      }),
    },
  } as unknown as SupabaseClient<Database>;
  return { admin, calls };
}

const row = (id: string, task_id: string | null) => ({
  id,
  task_id,
  comment_id: null,
  file_name: `${id}.pdf`,
  mime_type: "application/pdf",
  size_bytes: 10,
  source_attachment_id: null,
  created_at: "2026-10-03T10:00:00Z",
  storage_path: `u/p/${task_id ?? "plan"}/${id}`,
});

describe("files for agents", () => {
  it("groups a task's files under it and leaves the plan's own out", () => {
    const grouped = groupByTask([
      file("a", "t1"),
      file("b", null),
      file("c", "t1"),
      file("d", "t2"),
    ]);
    expect([...grouped.keys()]).toEqual(["t1", "t2"]);
    expect(grouped.get("t1")!.map((f) => f.id)).toEqual(["a", "c"]);
  });

  it("only ever asks for shared files, and for the plan's own when told to", async () => {
    const plain = fakeAdmin([row("a", "t1")]);
    await sharedAttachments(plain.admin, { planId: "p1" });
    expect(plain.calls).toContainEqual(["eq", "shared_with_agents", true]);
    expect(plain.calls.some(([method]) => method === "is")).toBe(false);

    const own = fakeAdmin([row("b", null)]);
    const files = await sharedAttachments(own.admin, { planId: "p1", planLevel: true });
    expect(own.calls).toContainEqual(["eq", "shared_with_agents", true]);
    expect(own.calls).toContainEqual(["eq", "plan_id", "p1"]);
    expect(own.calls).toContainEqual(["is", "task_id", null]);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ id: "b", task_id: null, url: "https://signed/u/p/plan/b" });
    expect(files[0]).not.toHaveProperty("storage_path");
  });

  it("puts the plan's files on the plan and each task's on its task", async () => {
    const { admin } = fakeAdmin([row("plan-file", null), row("task-file", "t1")]);
    const decorated = await decoratePlanForAgents(admin, {
      id: "p1",
      plan_sections: [{ plan_tasks: [{ id: "t1" }, { id: "t2" }] }],
    });
    expect(decorated.attachments.map((f) => f.id)).toEqual(["plan-file"]);
    const [t1, t2] = decorated.plan_sections[0].plan_tasks;
    expect(t1.attachments.map((f) => f.id)).toEqual(["task-file"]);
    expect(t2.attachments).toEqual([]);
  });
});
