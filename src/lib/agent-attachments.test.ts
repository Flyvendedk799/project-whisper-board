import { beforeEach, describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors";
import {
  readAttachmentText,
  signAttachmentDownload,
  uploadAgentAttachment,
  type AttachmentPorts,
  type AttachmentRow,
} from "./agent-attachments";
import { parseBase64Upload, parseTextUpload, sha256Hex } from "./attachment-policy";
import { isPlanAttachmentPath } from "./upload";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";
const PLAN = "44444444-4444-4444-8444-444444444444";
const OTHER_PLAN = "55555555-5555-4555-8555-555555555555";
const TASK = "66666666-6666-4666-8666-666666666666";
const OTHER_TASK = "77777777-7777-4777-8777-777777777777";
const MISSING = "88888888-8888-4888-8888-888888888888";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

/** Storage and the database in memory, with the same workspace scoping as the real ports. */
function fakePorts() {
  const plans = new Map([
    [PLAN, WS],
    [OTHER_PLAN, OTHER_WS],
  ]);
  const tasks = new Map([
    [TASK, PLAN],
    [OTHER_TASK, OTHER_PLAN],
  ]);
  const members = new Set([`${WS}:${USER}`]);
  const objects = new Map<string, Buffer>();
  const rows: AttachmentRow[] = [];
  const events: Array<{ planId: string; taskId: string | null; fileName: string }> = [];
  const writes: string[] = [];
  let failInsert = false;

  const ports: AttachmentPorts = {
    isMember: async (workspaceId, userId) => members.has(`${workspaceId}:${userId}`),
    planInWorkspace: async (planId, workspaceId) =>
      plans.get(planId) === workspaceId ? { id: planId } : null,
    taskInWorkspace: async (taskId, workspaceId) => {
      const planId = tasks.get(taskId);
      return planId && plans.get(planId) === workspaceId ? { id: taskId, plan_id: planId } : null;
    },
    attachmentById: async (id) => rows.find((row) => row.id === id) ?? null,
    attachmentByPathPrefix: async (planId, prefix) =>
      rows.find((row) => row.plan_id === planId && row.storage_path.startsWith(prefix)) ?? null,
    insertAttachment: async (row) => {
      if (failInsert) throw new Error("insert failed");
      const saved: AttachmentRow = {
        id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(rows.length + 1).padStart(12, "0")}`,
        plan_id: row.plan_id!,
        task_id: row.task_id ?? null,
        comment_id: null,
        uploader_id: row.uploader_id ?? null,
        storage_path: row.storage_path,
        file_name: row.file_name,
        mime_type: row.mime_type ?? null,
        size_bytes: row.size_bytes ?? null,
        shared_with_agents: row.shared_with_agents ?? true,
        source_attachment_id: null,
        created_at: new Date(0).toISOString(),
      };
      rows.push(saved);
      return saved;
    },
    logAttachmentAdded: async (event) => {
      events.push(event);
    },
    upload: async (path, bytes) => {
      writes.push(path);
      if (objects.has(path)) return "exists";
      objects.set(path, Buffer.from(bytes));
      return "ok";
    },
    download: async (path) => {
      const bytes = objects.get(path);
      if (!bytes) throw new Error("missing object");
      return bytes;
    },
    remove: async (path) => {
      objects.delete(path);
    },
    sign: async (path, seconds, downloadAs) =>
      `https://storage.test/${path}?expires=${seconds}${downloadAs ? `&download=${downloadAs}` : ""}`,
  };
  return {
    ports,
    rows,
    objects,
    events,
    writes,
    members,
    failNextInsert: () => {
      failInsert = true;
    },
  };
}

const key = { workspaceId: WS, userId: USER };

const markdown = (overrides: Record<string, unknown> = {}) =>
  parseTextUpload({
    plan_id: PLAN,
    file_name: "REVIEW.md",
    mime_type: "text/markdown",
    text: "# Review\n\nÆøå ✓\n",
    ...overrides,
  });

async function failure(action: () => Promise<unknown>): Promise<AppError> {
  try {
    await action();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("expected an AppError");
}

let fake: ReturnType<typeof fakePorts>;
beforeEach(() => {
  fake = fakePorts();
});

describe("uploadAgentAttachment", () => {
  it("stores a plan-level file under the uploader's folder and records it", async () => {
    const { attachment, created } = await uploadAgentAttachment(
      fake.ports,
      key,
      markdown({ purpose: "source review" }),
    );
    expect(created).toBe(true);
    expect(attachment).toMatchObject({
      plan_id: PLAN,
      task_id: null,
      file_name: "REVIEW.md",
      mime_type: "text/markdown",
      kind: "doc",
      shared_with_agents: true,
      purpose: "source review",
      idempotent_replay: false,
    });
    expect(attachment.sha256).toBe(sha256Hex(Buffer.from("# Review\n\nÆøå ✓\n")));
    expect(attachment.url).toContain("https://storage.test/");

    const [row] = fake.rows;
    expect(row.uploader_id).toBe(USER);
    expect(
      isPlanAttachmentPath(row.storage_path, { userId: USER, planId: PLAN, taskId: null }),
    ).toBe(true);
    expect(fake.events).toEqual([
      expect.objectContaining({ planId: PLAN, taskId: null, fileName: "REVIEW.md" }),
    ]);
  });

  it("puts a task's file on the task's actual plan", async () => {
    const intent = parseBase64Upload({
      task_id: TASK,
      file_name: "shot.png",
      mime_type: "image/png",
      data_base64: PNG.toString("base64"),
    });
    const { attachment } = await uploadAgentAttachment(fake.ports, key, intent);
    expect(attachment).toMatchObject({ plan_id: PLAN, task_id: TASK, kind: "image" });
    expect(fake.rows[0].storage_path.startsWith(`${USER}/${PLAN}/${TASK}/`)).toBe(true);
  });

  it("answers the same 404 for another workspace's plan or task as for a missing one, before writing", async () => {
    const attempts = [
      markdown({ plan_id: OTHER_PLAN }),
      markdown({ plan_id: MISSING }),
      markdown({ plan_id: undefined, task_id: OTHER_TASK }),
      markdown({ plan_id: undefined, task_id: MISSING }),
      markdown({ workspace_id: OTHER_WS }),
    ];
    const errors = await Promise.all(
      attempts.map((intent) => failure(() => uploadAgentAttachment(fake.ports, key, intent))),
    );
    for (const error of errors) {
      expect(error.status).toBe(404);
      expect(error.message).toBe(errors[0].message);
    }
    expect(fake.writes).toEqual([]);
    expect(fake.rows).toEqual([]);
  });

  it("accepts the key's own workspace_id", async () => {
    const { created } = await uploadAgentAttachment(
      fake.ports,
      key,
      markdown({ workspace_id: WS }),
    );
    expect(created).toBe(true);
  });

  it("refuses a key whose owner left the workspace, or has no owner", async () => {
    fake.members.clear();
    expect((await failure(() => uploadAgentAttachment(fake.ports, key, markdown()))).status).toBe(
      403,
    );
    expect(
      (await failure(() => uploadAgentAttachment(fake.ports, { ...key, userId: null }, markdown())))
        .status,
    ).toBe(403);
    expect(fake.writes).toEqual([]);
  });

  it("returns the first attachment for a retry with the same key and content", async () => {
    const first = await uploadAgentAttachment(
      fake.ports,
      key,
      markdown({ idempotency_key: "review-1" }),
    );
    const again = await uploadAgentAttachment(
      fake.ports,
      key,
      markdown({ idempotency_key: "review-1" }),
    );
    expect(again.created).toBe(false);
    expect(again.attachment.id).toBe(first.attachment.id);
    expect(again.attachment.idempotent_replay).toBe(true);
    expect(fake.rows).toHaveLength(1);
    expect(fake.writes).toHaveLength(1);
  });

  it("refuses the same key with different content or a different name (409)", async () => {
    await uploadAgentAttachment(fake.ports, key, markdown({ idempotency_key: "review-1" }));
    const changed = await failure(() =>
      uploadAgentAttachment(fake.ports, key, markdown({ idempotency_key: "review-1", text: "x" })),
    );
    expect(changed.status).toBe(409);
    const renamed = await failure(() =>
      uploadAgentAttachment(
        fake.ports,
        key,
        markdown({ idempotency_key: "review-1", file_name: "other.md" }),
      ),
    );
    expect(renamed.status).toBe(409);
    expect(fake.rows).toHaveLength(1);
  });

  it("scopes a key to its target: the same key on another target is a new upload", async () => {
    await uploadAgentAttachment(fake.ports, key, markdown({ idempotency_key: "k" }));
    const onTask = await uploadAgentAttachment(
      fake.ports,
      key,
      markdown({ idempotency_key: "k", plan_id: undefined, task_id: TASK }),
    );
    expect(onTask.created).toBe(true);
    expect(fake.rows).toHaveLength(2);
  });

  it("makes a new file each time without a key", async () => {
    await uploadAgentAttachment(fake.ports, key, markdown());
    await uploadAgentAttachment(fake.ports, key, markdown());
    expect(fake.rows).toHaveLength(2);
    expect(fake.rows[0].storage_path).not.toBe(fake.rows[1].storage_path);
  });

  it("takes the object back out when the row cannot be written", async () => {
    fake.failNextInsert();
    await expect(uploadAgentAttachment(fake.ports, key, markdown())).rejects.toThrow(
      "insert failed",
    );
    expect(fake.objects.size).toBe(0);
  });

  it("gives no URL for a file hidden from agents", async () => {
    const { attachment } = await uploadAgentAttachment(
      fake.ports,
      key,
      markdown({ shared_with_agents: false }),
    );
    expect(attachment.url).toBeNull();
    expect(fake.rows[0].shared_with_agents).toBe(false);
  });
});

describe("readAttachmentText", () => {
  it("reads back exactly what was uploaded, with the same hash", async () => {
    const { attachment } = await uploadAgentAttachment(fake.ports, key, markdown());
    const read = await readAttachmentText(fake.ports, key, attachment.id, {
      offset: 0,
      limit: 65536,
    });
    expect(read.text).toBe("# Review\n\nÆøå ✓\n");
    expect(read.sha256).toBe(attachment.sha256);
    expect(read.eof).toBe(true);
  });

  it("pages through a file", async () => {
    const { attachment } = await uploadAgentAttachment(fake.ports, key, markdown());
    const first = await readAttachmentText(fake.ports, key, attachment.id, { offset: 0, limit: 5 });
    expect(first).toMatchObject({ text: "# Rev", next_offset: 5, eof: false });
  });

  it("refuses a file that is not text", async () => {
    const intent = parseBase64Upload({
      plan_id: PLAN,
      file_name: "shot.png",
      mime_type: "image/png",
      data_base64: PNG.toString("base64"),
    });
    const { attachment } = await uploadAgentAttachment(fake.ports, key, intent);
    const error = await failure(() =>
      readAttachmentText(fake.ports, key, attachment.id, { offset: 0, limit: 10 }),
    );
    expect(error.status).toBe(415);
  });

  it("answers 404 for a hidden file, another workspace's file, a missing id or a bad id", async () => {
    const hidden = await uploadAgentAttachment(
      fake.ports,
      key,
      markdown({ shared_with_agents: false }),
    );
    const mine = await uploadAgentAttachment(fake.ports, key, markdown());
    const outsider = { workspaceId: OTHER_WS, userId: USER };
    fake.members.add(`${OTHER_WS}:${USER}`);
    const range = { offset: 0, limit: 10 };
    for (const [who, id] of [
      [key, hidden.attachment.id],
      [outsider, mine.attachment.id],
      [key, MISSING],
      [key, "not-a-uuid"],
    ] as const) {
      const error = await failure(() => readAttachmentText(fake.ports, who, id, range));
      expect(error.status, id).toBe(404);
    }
  });
});

describe("signAttachmentDownload", () => {
  it("signs a short download link for a shared file", async () => {
    const { attachment } = await uploadAgentAttachment(fake.ports, key, markdown());
    const link = await signAttachmentDownload(fake.ports, key, attachment.id);
    expect(link.expires_in).toBe(300);
    expect(link.url).toContain("download=REVIEW.md");
  });

  it("answers 404 for another workspace", async () => {
    const { attachment } = await uploadAgentAttachment(fake.ports, key, markdown());
    fake.members.add(`${OTHER_WS}:${USER}`);
    const error = await failure(() =>
      signAttachmentDownload(fake.ports, { workspaceId: OTHER_WS, userId: USER }, attachment.id),
    );
    expect(error.status).toBe(404);
  });
});
