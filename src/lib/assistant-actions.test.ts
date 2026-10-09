import { describe, expect, it } from "vitest";
import {
  ACTION_TYPES,
  ACTION_VOCABULARY,
  describeAction,
  parseAction,
  parseAssistantReply,
  RefIndex,
  sanitizeActions,
  type Action,
} from "./assistant-actions";

const PLAN = "11111111-1111-4111-8111-111111111111";
const SECTION = "22222222-2222-4222-8222-222222222222";
const TASK = "33333333-3333-4333-8333-333333333333";
const OTHER_TASK = "44444444-4444-4444-8444-444444444444";
const FEATURE = "55555555-5555-4555-8555-555555555555";
const QUESTION = "66666666-6666-4666-8666-666666666666";

function refs() {
  const index = new RefIndex();
  index.add("plan", PLAN, "Launch");
  index.add("section", SECTION, "Backend", PLAN);
  index.add("task", TASK, "Build the API", SECTION);
  index.add("task", OTHER_TASK, "Write docs", SECTION);
  index.add("feature", FEATURE, "Rate limited", TASK);
  index.add("question", QUESTION, "Which auth?", TASK);
  return index;
}

describe("RefIndex", () => {
  it("hands out stable short refs and resolves them back", () => {
    const index = refs();
    expect(index.aliasOf("task", TASK)).toBe("T1");
    expect(index.add("task", TASK)).toBe("T1");
    expect(index.resolve("task", "T2")).toBe(OTHER_TASK);
    expect(index.resolve("task", " #t1 ")).toBe(TASK);
    expect(index.resolve("task", "[T1]")).toBe(TASK);
  });

  it("only resolves refs of the right kind that were shown", () => {
    const index = refs();
    expect(index.resolve("section", "T1")).toBeUndefined();
    expect(index.resolve("task", "T9")).toBeUndefined();
    expect(index.resolve("task", SECTION)).toBeUndefined();
    expect(index.resolve("task", TASK)).toBe(TASK);
    expect(index.resolve("task", 42)).toBeUndefined();
  });

  it("knows what each thing is called", () => {
    expect(refs().names().tasks?.[TASK]).toBe("Build the API");
  });
});

describe("parseAction", () => {
  it("accepts every type in the vocabulary", () => {
    const samples: unknown[] = [
      { type: "create_task", sectionId: "S1", title: "x" },
      { type: "update_task", taskId: "T1", status: "done" },
      { type: "create_section", title: "x" },
      { type: "update_section", sectionId: "S1", title: "x" },
      { type: "add_features", taskId: "T1", items: ["a"] },
      { type: "add_steps", taskId: "T1", items: ["a"] },
      { type: "ask_question", taskId: "T1", body: "why?" },
      { type: "answer_question", questionId: "Q1", answer: "because" },
      { type: "add_comment", taskId: "T1", body: "hi" },
    ];
    expect(samples.map((sample) => parseAction(sample)?.type)).toEqual([...ACTION_TYPES]);
    for (const type of ACTION_TYPES) expect(ACTION_VOCABULARY).toContain(`"${type}"`);
  });

  it("is forgiving about how enums are written, and strict about what they mean", () => {
    expect(
      parseAction({
        type: "Create-Task",
        sectionId: "S1",
        title: "x",
        status: "In progress",
        priority: "Urgent",
      }),
    ).toMatchObject({ type: "create_task", status: "in_progress", priority: "critical" });
    expect(parseAction({ type: "update_task", taskId: "T1", status: "claimed" })).toBeNull();
    expect(parseAction({ type: "update_task", taskId: "T1", priority: "whenever" })).toBeNull();
    expect(parseAction({ type: "delete_task", taskId: "T1" })).toBeNull();
    expect(parseAction("create_task")).toBeNull();
    expect(parseAction(null)).toBeNull();
  });

  it("normalizes tags and colours, and refuses a colour that is not one", () => {
    const ok = parseAction({
      type: "update_task",
      taskId: "T1",
      tags: ["#Front End", "front-end", ""],
      color: "red",
    });
    expect(ok).toMatchObject({ tags: ["front-end"], color: "#ef4444" });
    expect(parseAction({ type: "update_task", taskId: "T1", color: "#3b82f6" })).toMatchObject({
      color: "#3b82f6",
    });
    expect(parseAction({ type: "update_task", taskId: "T1", color: null })).toMatchObject({
      color: null,
    });
    expect(
      parseAction({ type: "update_task", taskId: "T1", color: "javascript:alert(1)" }),
    ).toBeNull();
  });

  it("cuts long text instead of refusing it, but refuses empty", () => {
    const long = parseAction({ type: "add_comment", taskId: "T1", body: "x".repeat(9000) });
    expect(long && "body" in long && long.body.length).toBe(4000);
    expect(parseAction({ type: "add_comment", taskId: "T1", body: "   " })).toBeNull();
    expect(parseAction({ type: "add_features", taskId: "T1", items: [] })).toBeNull();
    expect(parseAction({ type: "add_features", taskId: "T1", items: ["", "  "] })).toBeNull();
  });

  it("reads steps as strings or objects and clamps depth", () => {
    const action = parseAction({
      type: "add_steps",
      taskId: "T1",
      items: ["one", { text: "two", depth: 9 }, { text: "three", depth: -1 }],
    });
    expect(action).toMatchObject({
      items: [
        { text: "one", depth: 0 },
        { text: "two", depth: 3 },
        { text: "three", depth: 0 },
      ],
    });
  });

  it("reads a step's client text, and a task's client title and summary (empty clears)", () => {
    const steps = parseAction({
      type: "add_steps",
      taskId: "T1",
      items: ["plain", { text: "shown", client_text: "  Ny   forside " }],
    });
    expect(steps).toMatchObject({
      items: [{ text: "plain" }, { text: "shown", client_text: "Ny forside" }],
    });
    expect(steps && "items" in steps && steps.items[0]).not.toHaveProperty("client_text");

    expect(
      parseAction({ type: "update_task", taskId: "T1", client_title: " Tryggere login " }),
    ).toMatchObject({ client_title: "Tryggere login" });
    expect(parseAction({ type: "update_task", taskId: "T1", client_title: "" })).toMatchObject({
      client_title: "",
    });
    expect(
      parseAction({
        type: "create_task",
        sectionId: "S1",
        title: "Refactor auth",
        client_title: "Tryggere login",
        client_summary: "Man bliver logget ind på en sikker måde.",
      }),
    ).toMatchObject({
      client_title: "Tryggere login",
      client_summary: "Man bliver logget ind på en sikker måde.",
    });
  });
});

describe("sanitizeActions", () => {
  it("resolves refs to ids and fills a new task's plan from its section", () => {
    const { actions, dropped } = sanitizeActions(
      [
        { type: "create_task", sectionId: "S1", title: "Add rate limiting" },
        { type: "update_task", taskId: "T1", status: "in_progress" },
        { type: "answer_question", questionId: "Q1", answer: "OAuth" },
      ],
      refs(),
    );
    expect(dropped).toBe(0);
    expect(actions[0]).toMatchObject({ type: "create_task", sectionId: SECTION, planId: PLAN });
    expect(actions[1]).toMatchObject({ type: "update_task", taskId: TASK });
    expect(actions[2]).toMatchObject({ type: "answer_question", questionId: QUESTION });
  });

  it("drops actions that name something the model was not shown", () => {
    const { actions, dropped } = sanitizeActions(
      [
        { type: "update_task", taskId: "T7", status: "done" },
        { type: "create_task", sectionId: "S9", title: "x" },
        { type: "update_task", taskId: "99999999-9999-4999-8999-999999999999", status: "done" },
        { type: "answer_question", questionId: "Q4", answer: "x" },
        { type: "add_comment", taskId: "T2", body: "ok" },
      ],
      refs(),
    );
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: "add_comment", taskId: OTHER_TASK });
    expect(dropped).toBe(4);
  });

  it("drops invalid shapes, empty updates and duplicates", () => {
    const { actions, dropped } = sanitizeActions(
      [
        { type: "nope" },
        "string",
        { type: "update_task", taskId: "T1" },
        { type: "update_section", sectionId: "S1" },
        { type: "add_comment", taskId: "T1", body: "same" },
        { type: "add_comment", taskId: "T1", body: "same" },
      ],
      refs(),
    );
    expect(actions).toHaveLength(1);
    expect(dropped).toBe(4);
  });

  it("keeps steps but unlinks a feature that is not the task's", () => {
    const index = refs();
    index.add("feature", "77777777-7777-4777-8777-777777777777", "Other", OTHER_TASK);
    const { actions } = sanitizeActions(
      [
        { type: "add_steps", taskId: "T1", featureId: "F1", items: ["a"] },
        { type: "add_steps", taskId: "T1", featureId: "F2", items: ["b"] },
        { type: "add_steps", taskId: "T1", featureId: "F9", items: ["c"] },
      ],
      index,
    );
    expect(actions.map((action) => (action.type === "add_steps" ? action.featureId : "x"))).toEqual(
      [FEATURE, null, null],
    );
  });

  it("defaults a new section to the only plan, and refuses when it is ambiguous", () => {
    expect(
      sanitizeActions([{ type: "create_section", title: "Ops" }], refs()).actions[0],
    ).toMatchObject({ planId: PLAN });
    const two = refs();
    two.add("plan", "88888888-8888-4888-8888-888888888888", "Other");
    expect(sanitizeActions([{ type: "create_section", title: "Ops" }], two).actions).toHaveLength(
      0,
    );
    expect(
      sanitizeActions([{ type: "create_section", planId: "P2", title: "Ops" }], two).actions,
    ).toHaveLength(1);
  });

  it("caps how many actions get through", () => {
    const many = Array.from({ length: 40 }, (_, i) => ({
      type: "add_comment",
      taskId: "T1",
      body: `n${i}`,
    }));
    const { actions, dropped } = sanitizeActions(many, refs());
    expect(actions).toHaveLength(25);
    expect(dropped).toBe(15);
    expect(sanitizeActions("nope", refs())).toEqual({ actions: [], dropped: 0 });
  });
});

describe("parseAssistantReply", () => {
  it("reads the JSON the model was asked for, fenced or not", () => {
    const body = JSON.stringify({
      reply: "Done.",
      actions: [{ type: "add_comment", taskId: "T1", body: "hi" }, { type: "bogus" }],
    });
    for (const raw of [body, "```json\n" + body + "\n```", `Sure! ${body} Hope that helps.`]) {
      const reply = parseAssistantReply(raw, refs());
      expect(reply.reply).toBe("Done.");
      expect(reply.actions).toHaveLength(1);
      expect(reply.dropped).toBe(1);
    }
  });

  it("treats plain prose as a reply with no actions", () => {
    expect(parseAssistantReply("Just words.", refs())).toEqual({
      reply: "Just words.",
      actions: [],
      dropped: 0,
    });
  });

  it("never lets a missing reply become an empty bubble", () => {
    expect(parseAssistantReply('{"actions":[]}', refs()).reply).not.toBe("");
  });
});

describe("describeAction", () => {
  const names = refs().names();
  const describeRaw = (action: unknown) => {
    const parsed = sanitizeActions([action], refs()).actions[0] as Action;
    return describeAction(parsed, names);
  };

  it("says what would change in plain words", () => {
    expect(
      describeRaw({ type: "update_task", taskId: "T1", status: "in_progress", priority: "high" }),
    ).toBe('Update task "Build the API": set status to In progress, set priority to high');
    expect(
      describeRaw({
        type: "create_task",
        sectionId: "S1",
        title: "Cache",
        features: ["a", "b"],
        steps: ["x"],
      }),
    ).toBe('Create task "Cache" in section "Backend" with 2 features and 1 sub-step');
    expect(
      describeRaw({ type: "ask_question", taskId: "T1", body: "Which db?", blocking: true }),
    ).toBe('Ask (blocking) on task "Build the API": "Which db?"');
    expect(describeRaw({ type: "update_task", taskId: "T1", tags: [], color: "teal" })).toContain(
      "clear the tags, set colour to Teal",
    );
    expect(describeRaw({ type: "answer_question", questionId: "Q1", answer: "OAuth" })).toBe(
      'Answer "Which auth?": "OAuth"',
    );
  });

  it("works without names", () => {
    const action = parseAction({ type: "add_comment", taskId: "x", body: "hi" }) as Action;
    expect(describeAction(action)).toBe('Comment on a task: "hi"');
  });
});
