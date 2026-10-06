import { describe, expect, it } from "vitest";
import {
  assignmentTarget,
  excerptOf,
  inAppRow,
  mentionCandidates,
  mentionTargets,
  planTaskLink,
  ticketCommentTargets,
} from "./notify-targets";

const ADMIN = "admin-1";
const ADMIN_2 = "admin-2";
const CLIENT = "client-1";
const OTHER_CLIENT = "client-2";
const STRANGER_CLIENT = "client-3";

function comment(overrides: Partial<Parameters<typeof ticketCommentTargets>[0]> = {}) {
  return ticketCommentTargets({
    actorId: ADMIN,
    actorName: "Maja",
    workspaceId: "ws-1",
    ticketId: "t-1",
    label: "#42 Checkout fails",
    link: "/app/tickets/t-1",
    excerpt: "Looking now",
    internal: false,
    audience: [CLIENT, OTHER_CLIENT],
    mentioned: [],
    agencyIds: new Set([ADMIN, ADMIN_2]),
    actorIsAgency: true,
    ...overrides,
  });
}

const byUser = (targets: ReturnType<typeof comment>) =>
  Object.fromEntries(targets.map((target) => [target.userId, target.kind]));

describe("ticketCommentTargets", () => {
  it("tells the audience about a reply, but never the author", () => {
    expect(byUser(comment({ audience: [ADMIN, CLIENT, CLIENT] }))).toEqual({ [CLIENT]: "comment" });
  });

  it("tells someone mentioned once, as a mention, even outside the audience", () => {
    const targets = comment({ mentioned: [CLIENT, ADMIN_2, ADMIN] });
    expect(byUser(targets)).toEqual({
      [CLIENT]: "mention",
      [OTHER_CLIENT]: "comment",
      [ADMIN_2]: "mention",
    });
    expect(targets.find((t) => t.userId === CLIENT)).toMatchObject({
      title: "Maja mentioned you",
      workspaceId: "ws-1",
      actorId: ADMIN,
      link: "/app/tickets/t-1",
      emailSubject: "Maja mentioned you on #42 Checkout fails",
    });
  });

  it("sends an internal note only to the admins mentioned in it", () => {
    const targets = comment({ internal: true, mentioned: [CLIENT, ADMIN_2] });
    expect(byUser(targets)).toEqual({ [ADMIN_2]: "mention" });
    expect(targets[0]!.title).toBe("Maja mentioned you in an internal note");
  });

  it("sends an internal note with no admin mentioned to nobody", () => {
    expect(comment({ internal: true, mentioned: [CLIENT, OTHER_CLIENT] })).toEqual([]);
    expect(comment({ internal: true })).toEqual([]);
  });

  it("lets a client reach the agency and the ticket's people, not other clients", () => {
    const targets = comment({
      actorId: CLIENT,
      actorName: "Kim",
      actorIsAgency: false,
      audience: [OTHER_CLIENT, ADMIN],
      mentioned: [STRANGER_CLIENT, ADMIN_2, OTHER_CLIENT],
    });
    expect(byUser(targets)).toEqual({
      [OTHER_CLIENT]: "mention",
      [ADMIN]: "comment",
      [ADMIN_2]: "mention",
    });
  });

  it("lets the agency mention any workspace member", () => {
    expect(byUser(comment({ audience: [], mentioned: [STRANGER_CLIENT] }))).toEqual({
      [STRANGER_CLIENT]: "mention",
    });
  });

  it("falls back to the ticket label when there is no excerpt", () => {
    const [target] = comment({ excerpt: "", audience: [CLIENT] });
    expect(target).toMatchObject({ body: "On #42 Checkout fails", emailBody: undefined });
  });
});

describe("mentionCandidates", () => {
  const people = [
    { id: ADMIN, role: "admin" },
    { id: CLIENT, role: "client" },
    { id: OTHER_CLIENT, role: "client_admin" },
    { id: STRANGER_CLIENT, role: "client" },
  ];
  const ids = (list: typeof people) => list.map((person) => person.id);

  it("offers only admins in an internal note", () => {
    expect(
      ids(
        mentionCandidates(people, { internal: true, viewerIsAgency: true, projectMemberIds: [] }),
      ),
    ).toEqual([ADMIN]);
  });

  it("offers the agency everyone", () => {
    expect(
      ids(
        mentionCandidates(people, { internal: false, viewerIsAgency: true, projectMemberIds: [] }),
      ),
    ).toEqual(ids(people));
  });

  it("offers a client the agency and the project's people only", () => {
    expect(
      ids(
        mentionCandidates(people, {
          internal: false,
          viewerIsAgency: false,
          projectMemberIds: [CLIENT, OTHER_CLIENT],
        }),
      ),
    ).toEqual([ADMIN, CLIENT, OTHER_CLIENT]);
  });
});

describe("assignmentTarget", () => {
  const base = {
    actorId: ADMIN,
    actorName: "Maja",
    assigneeId: CLIENT,
    workspaceId: "ws-1",
    what: "#42 Checkout fails",
    link: "/app/tickets/t-1",
    relatedType: "ticket",
    relatedId: "t-1",
  };

  it("tells the new assignee", () => {
    expect(assignmentTarget(base)).toMatchObject({
      userId: CLIENT,
      kind: "assigned",
      title: "Maja assigned you #42 Checkout fails",
      actorId: ADMIN,
      workspaceId: "ws-1",
    });
  });

  it("says nothing when cleared, self-assigned or unchanged", () => {
    expect(assignmentTarget({ ...base, assigneeId: null })).toBeNull();
    expect(assignmentTarget({ ...base, assigneeId: ADMIN })).toBeNull();
    expect(assignmentTarget({ ...base, previousAssigneeId: CLIENT })).toBeNull();
  });
});

describe("mentionTargets", () => {
  it("tells each person once, never the author", () => {
    const targets = mentionTargets({
      actorId: ADMIN,
      actorName: "Maja",
      mentioned: [CLIENT, CLIENT, ADMIN],
      workspaceId: "ws-1",
      where: "Launch plan",
      link: planTaskLink("p-1", "task-1"),
      excerpt: "",
      relatedType: "plan_task",
      relatedId: "task-1",
    });
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      userId: CLIENT,
      kind: "mention",
      body: "On Launch plan",
      link: "/app/planner/p-1?task=task-1",
    });
  });
});

describe("inAppRow", () => {
  it("writes the workspace and actor only when known", () => {
    const target = { userId: CLIENT, kind: "mention" as const, title: "Hi" };
    expect(inAppRow(target)).toEqual({
      user_id: CLIENT,
      kind: "mention",
      title: "Hi",
      body: null,
      link: null,
    });
    expect(inAppRow({ ...target, workspaceId: "ws-1", actorId: ADMIN })).toMatchObject({
      workspace_id: "ws-1",
      actor_id: ADMIN,
    });
  });
});

describe("excerptOf", () => {
  it("reads mentions as @Name and drops markup and entities", () => {
    const html = `<p>Hi <span data-type="mention" data-id="x">@Ada</span>,</p><p>a &amp; b &lt;3</p>`;
    expect(excerptOf(html)).toBe("Hi @Ada, a & b <3");
    expect(excerptOf("ping @[Ada L](user:7d6f0c1e-1111-4a2b-8c3d-000000000001)")).toBe(
      "ping @Ada L",
    );
    expect(excerptOf(null)).toBe("");
  });

  it("cuts long text with an ellipsis", () => {
    const out = excerptOf("word ".repeat(100), 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith("…")).toBe(true);
  });
});
