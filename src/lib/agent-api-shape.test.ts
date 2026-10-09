import { describe, expect, it } from "vitest";
import {
  byPosition,
  progressSummary,
  questionAuthorIds,
  shapeClientFeedback,
  withQuestionAuthors,
  type QuestionRow,
} from "./agent-api-shape";

const question = (over: Partial<QuestionRow> & { id: string }) => ({
  asked_by_agent_id: null,
  asked_by_user_id: null,
  answered_by_agent_id: null,
  answered_by_user_id: null,
  created_at: "2026-10-01T10:00:00Z",
  ...over,
});

describe("byPosition", () => {
  it("orders by position and tolerates null", () => {
    expect(
      byPosition([{ position: 3 }, { position: 1 }, { position: 2 }]).map((r) => r.position),
    ).toEqual([1, 2, 3]);
    expect(byPosition(null)).toEqual([]);
  });

  it("does not reorder the input", () => {
    const rows = [{ position: 2 }, { position: 1 }];
    byPosition(rows);
    expect(rows[0].position).toBe(2);
  });
});

describe("question authors", () => {
  const names = {
    agents: new Map([["agent-1", "Claude Code"]]),
    people: new Map([["user-1", "Tobias"]]),
  };

  it("names who asked and who answered, oldest first", () => {
    const rows = withQuestionAuthors(
      [
        question({ id: "b", created_at: "2026-10-01T12:00:00Z", asked_by_user_id: "user-1" }),
        question({
          id: "a",
          asked_by_agent_id: "agent-1",
          answered_by_user_id: "user-1",
        }),
      ],
      names,
    );
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(rows[0].asked_by).toEqual({ kind: "agent", id: "agent-1", name: "Claude Code" });
    expect(rows[0].answered_by).toEqual({ kind: "person", id: "user-1", name: "Tobias" });
    expect(rows[1].asked_by?.kind).toBe("person");
    expect(rows[1].answered_by).toBeNull();
  });

  it("falls back to a plain name for an id it has no name for", () => {
    const [row] = withQuestionAuthors(
      [question({ id: "a", asked_by_agent_id: "gone", answered_by_user_id: "stranger" })],
      names,
    );
    expect(row.asked_by?.name).toBe("Agent");
    expect(row.answered_by?.name).toBe("A teammate");
  });

  it("collects each id once", () => {
    expect(
      questionAuthorIds([
        question({ id: "a", asked_by_agent_id: "agent-1", answered_by_agent_id: "agent-1" }),
        question({ id: "b", asked_by_user_id: "user-1", answered_by_user_id: "user-2" }),
      ]),
    ).toEqual({ agents: ["agent-1"], people: ["user-1", "user-2"] });
  });
});

describe("progressSummary", () => {
  it("counts steps, features and what waits on an answer", () => {
    expect(
      progressSummary({
        steps: [{ done: true }, { done: false }, { done: true }],
        features: [{ met: true }, { met: false }],
        questions: [
          { status: "open", blocking: true },
          { status: "open", blocking: false },
          { status: "answered", blocking: true },
        ],
      }),
    ).toEqual({
      steps: { done: 2, total: 3 },
      features: { met: 1, total: 2 },
      open_questions: 2,
      blocking_questions: 1,
    });
  });

  it("is all zeros for a task with nothing on it", () => {
    expect(progressSummary({})).toEqual({
      steps: { done: 0, total: 0 },
      features: { met: 0, total: 0 },
      open_questions: 0,
      blocking_questions: 0,
    });
  });
});

describe("question audience", () => {
  it("keeps audience, client_body and from_client on a question", () => {
    const [out] = withQuestionAuthors(
      [
        question({
          id: "q1",
          audience: "client",
          client_body: "Hvilken farve vil du have?",
          from_client: false,
        } as Partial<QuestionRow> & { id: string }),
      ],
      { agents: new Map(), people: new Map() },
    );
    expect(out).toMatchObject({
      audience: "client",
      client_body: "Hvilken farve vil du have?",
      from_client: false,
    });
  });
});

describe("shapeClientFeedback", () => {
  const names = new Map([
    ["u1", "Karen"],
    ["u2", "Mads"],
  ]);
  const sectionTitles = new Map([["s1", "Design"]]);
  const taskTitles = new Map([["t1", "Forside"]]);

  it("lists comments and approvals oldest first with names and titles", () => {
    const out = shapeClientFeedback({
      comments: [
        {
          id: "c2",
          section_id: null,
          task_id: "t1",
          author_id: "u2",
          body: "Senere",
          created_at: "2026-10-03T10:00:00Z",
        },
        {
          id: "c1",
          section_id: "s1",
          task_id: null,
          author_id: "u1",
          body: "Først",
          created_at: "2026-10-02T10:00:00Z",
        },
      ],
      approvals: [{ section_id: "s1", user_id: "u1", created_at: "2026-10-04T10:00:00Z" }],
      names,
      sectionTitles,
      taskTitles,
    });
    expect(out.comments.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(out.comments[0]).toMatchObject({
      section_title: "Design",
      task_id: null,
      task_title: null,
      author_name: "Karen",
      body: "Først",
    });
    expect(out.comments[1]).toMatchObject({ task_title: "Forside", author_name: "Mads" });
    expect(out.approvals).toEqual([
      {
        section_id: "s1",
        section_title: "Design",
        user_id: "u1",
        user_name: "Karen",
        created_at: "2026-10-04T10:00:00Z",
      },
    ]);
  });

  it("falls back for an unknown person and is empty when there is nothing", () => {
    expect(
      shapeClientFeedback({
        comments: [],
        approvals: [{ section_id: "s9", user_id: "ghost", created_at: "2026-10-04T10:00:00Z" }],
        names,
        sectionTitles,
        taskTitles,
      }),
    ).toEqual({
      comments: [],
      approvals: [
        {
          section_id: "s9",
          section_title: null,
          user_id: "ghost",
          user_name: "A teammate",
          created_at: "2026-10-04T10:00:00Z",
        },
      ],
    });
  });
});
