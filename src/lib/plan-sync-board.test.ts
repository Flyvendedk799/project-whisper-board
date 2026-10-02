import { describe, expect, it } from "vitest";
import { serializeBoardMarkdown } from "./plan-markdown-board";
import { parsePlanMarkdown, type PlanMdDocument, type PlanMdSection } from "./plan-markdown";
import {
  appendSections,
  syncSections,
  type ExistingSection,
  type NewFeature,
  type NewQuestion,
  type NewStep,
  type NewTask,
  type SyncStore,
} from "./plan-sync";

type TaskRow = NewTask & {
  id: string;
  sectionId: string;
  assigned_agent_id: string | null;
  pr_url: string | null;
};
type SectionRow = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  color?: string;
  goals?: string | null;
  intentions?: string | null;
  tags?: string[];
};
type StepRow = NewStep & { id: string };
type FeatureRow = NewFeature & { id: string };
type QuestionRow = NewQuestion & { id: string };

/** A whole plan in memory, features, steps and questions included, recording every write. */
function memoryBoard(seed?: { sections?: SectionRow[]; tasks?: TaskRow[] }) {
  let counter = 0;
  const id = (prefix: string) => `${prefix}-${(counter += 1)}`;
  const sections: SectionRow[] = seed?.sections ?? [];
  const tasks: TaskRow[] = seed?.tasks ?? [];
  const steps: StepRow[] = [];
  const features: FeatureRow[] = [];
  const questions: QuestionRow[] = [];
  const writes: string[] = [];

  const store: SyncStore = {
    async load() {
      return sections.map<ExistingSection>((section) => ({
        ...section,
        tasks: tasks
          .filter((task) => task.sectionId === section.id)
          .map((task) => ({
            ...task,
            steps: steps
              .filter((s) => s.taskId === task.id)
              .map((s) => ({ ...s, feature_id: s.featureId })),
            features: features.filter((f) => f.taskId === task.id),
            questions: questions.filter((q) => q.taskId === task.id).map((q) => ({ ...q })),
          })),
      }));
    },
    async createSection(input) {
      const row: SectionRow = { id: id("sec"), ...input };
      sections.push(row);
      writes.push(`createSection:${input.title}`);
      return { id: row.id };
    },
    async updateSection(sectionId, patch) {
      sections.find((s) => s.id === sectionId)!.description = patch.description;
      writes.push(`updateSection:${sectionId}`);
    },
    async updateSectionFields(sectionId, patch) {
      Object.assign(sections.find((s) => s.id === sectionId)!, patch);
      writes.push(`updateSectionFields:${Object.keys(patch).join(",")}`);
    },
    async createTasks(sectionId, input) {
      return input.map((task) => {
        const row: TaskRow = {
          ...task,
          id: id("task"),
          sectionId,
          assigned_agent_id: null,
          pr_url: null,
        };
        tasks.push(row);
        writes.push(`createTask:${task.title}`);
        return { id: row.id };
      });
    },
    async updateTask(taskId, patch) {
      Object.assign(tasks.find((t) => t.id === taskId)!, patch);
      writes.push(`updateTask:${Object.keys(patch).join(",")}`);
    },
    async createSteps(input) {
      for (const step of input) {
        steps.push({ ...step, id: id("step") });
        writes.push(`createStep:${step.text}`);
      }
    },
    async createFeatures(input) {
      return input.map((feature) => {
        const row = { ...feature, id: id("feat") };
        features.push(row);
        writes.push(`createFeature:${feature.text}`);
        return { id: row.id };
      });
    },
    async createQuestions(input) {
      for (const question of input) {
        questions.push({ ...question, id: id("q") });
        writes.push(`createQuestion:${question.body}`);
      }
    },
  };
  return { store, sections, tasks, steps, features, questions, writes };
}

const limits = { maxStepDepth: 3, maxStepText: 500 };

const DOC: PlanMdDocument = {
  title: "Plan",
  sections: [
    {
      title: "Foundations",
      description: "Note.",
      goals: "Goal.",
      intentions: "Intent.",
      tags: ["infra"],
      color: "#8b5cf6",
      tasks: [
        {
          title: "Auth gate",
          description: "Brief.",
          status: "blocked",
          priority: "high",
          size: "large",
          tags: ["auth", "api"],
          color: "#3b82f6",
          acceptance: "Works.",
          context: "Context.",
          features: [
            { text: "Sign in", met: true },
            { text: "Refresh", met: false },
          ],
          steps: [
            { text: "Middleware", done: true, depth: 0, feature: 1 },
            { text: "Cookie", done: false, depth: 1, feature: 2 },
            { text: "Docs", done: false, depth: 0 },
          ],
          questions: [
            { body: "Which provider?", blocking: true, status: "open" },
            { body: "SSO?", blocking: false, status: "answered", answer: "Later." },
          ],
        },
        { title: "Reset", description: "", steps: [], status: "done", done: true },
      ],
    },
  ],
};

describe("appendSections — a board export", () => {
  it("creates tasks with their status, priority, size, tags, colour and context", async () => {
    const board = memoryBoard();
    const out = await appendSections(board.store, DOC.sections, limits, 1);
    expect(out).toMatchObject({
      createdSections: 1,
      createdTasks: 2,
      createdSteps: 3,
      createdFeatures: 2,
      createdQuestions: 2,
    });
    expect(board.sections[0]).toMatchObject({
      title: "Foundations",
      goals: "Goal.",
      intentions: "Intent.",
      tags: ["infra"],
      color: "#8b5cf6",
    });
    expect(board.tasks[0]).toMatchObject({
      title: "Auth gate",
      status: "blocked",
      priority: "high",
      complexity: "large",
      labels: ["auth", "api"],
      color: "#3b82f6",
      acceptance_criteria: "Works.",
      ai_context: "Context.",
      // So answering the blocking question puts the task back somewhere.
      blocked_from: "available",
    });
    expect(board.tasks[1]).toMatchObject({ title: "Reset", status: "done" });
  });

  it("links steps to the features they were written under", async () => {
    const board = memoryBoard();
    await appendSections(board.store, DOC.sections, limits, 1);
    const feature = (text: string) => board.features.find((f) => f.text === text)!;
    expect(board.features.map((f) => [f.text, f.met, f.position])).toEqual([
      ["Sign in", true, 1],
      ["Refresh", false, 2],
    ]);
    expect(board.steps.map((s) => [s.text, s.featureId ?? null, s.depth, s.done])).toEqual([
      ["Middleware", feature("Sign in").id, 0, true],
      ["Cookie", feature("Refresh").id, 1, false],
      ["Docs", null, 0, false],
    ]);
  });

  it("keeps questions, with blocking and answers", async () => {
    const board = memoryBoard();
    await appendSections(board.store, DOC.sections, limits, 1);
    expect(board.questions.map((q) => [q.body, q.blocking, q.status, q.answer])).toEqual([
      ["Which provider?", true, "open", null],
      ["SSO?", false, "answered", "Later."],
    ]);
  });

  it("round-trips: what is written back out is the document that went in", async () => {
    const board = memoryBoard();
    const original = parsePlanMarkdown(serializeBoardMarkdown(DOC));
    await appendSections(board.store, original.sections, limits, 1);

    const rebuilt: PlanMdDocument = {
      title: "Plan",
      sections: board.sections.map<PlanMdSection>((section) => ({
        title: section.title,
        ...(section.description && { description: section.description }),
        ...(section.goals && { goals: section.goals }),
        ...(section.intentions && { intentions: section.intentions }),
        ...(section.tags?.length && { tags: section.tags }),
        ...(section.color && { color: section.color }),
        tasks: board.tasks
          .filter((task) => task.sectionId === section.id)
          .map((task) => {
            const taskFeatures = board.features.filter((f) => f.taskId === task.id);
            return {
              title: task.title,
              description: task.description ?? "",
              status: task.status,
              ...(task.status === "done" && { done: true }),
              ...(task.priority && { priority: task.priority }),
              ...(task.complexity && { size: task.complexity }),
              ...(task.labels?.length && { tags: task.labels }),
              ...(task.color && { color: task.color }),
              ...(task.acceptance_criteria && { acceptance: task.acceptance_criteria }),
              ...(task.ai_context && { context: task.ai_context }),
              ...(taskFeatures.length > 0 && {
                features: taskFeatures.map((f) => ({ text: f.text, met: f.met })),
              }),
              steps: board.steps
                .filter((s) => s.taskId === task.id)
                .map((s) => ({
                  text: s.text,
                  done: s.done,
                  depth: s.depth,
                  ...(s.featureId && {
                    feature: taskFeatures.findIndex((f) => f.id === s.featureId) + 1,
                  }),
                })),
              ...(board.questions.some((q) => q.taskId === task.id) && {
                questions: board.questions
                  .filter((q) => q.taskId === task.id)
                  .map((q) => ({
                    body: q.body,
                    blocking: q.blocking,
                    status: q.status,
                    ...(q.answer && { answer: q.answer }),
                  })),
              }),
            };
          }),
      })),
    };
    expect(serializeBoardMarkdown(rebuilt)).toBe(serializeBoardMarkdown(DOC));
  });
});

describe("syncSections — a board export", () => {
  const existingBoard = () =>
    memoryBoard({
      sections: [{ id: "S1", title: "Renamed on the board", description: "Mine.", position: 1 }],
      tasks: [
        {
          id: "T1",
          sectionId: "S1",
          title: "Auth gate (renamed)",
          description: "Hand written.",
          acceptance_criteria: null,
          status: "in_progress",
          position: 1,
          labels: ["auth"],
          color: null as unknown as string,
          assigned_agent_id: "agent-1",
          pr_url: "https://github.com/o/r/pull/9",
        },
      ],
    });

  const doc = (): PlanMdSection[] => [
    {
      ...DOC.sections[0],
      id: "S1",
      description: "Document note.",
      tasks: [{ ...DOC.sections[0].tasks[0], id: "T1" }, DOC.sections[0].tasks[1]],
    },
  ];

  it("matches by id even when titles differ, and does not duplicate", async () => {
    const board = existingBoard();
    const out = await syncSections(board.store, doc(), limits, { refreshNotes: false });
    expect(out).toMatchObject({
      createdSections: 0,
      matchedSections: 1,
      matchedTasks: 1,
      createdTasks: 1,
    });
    expect(board.tasks.map((t) => t.title)).toEqual(["Auth gate (renamed)", "Reset"]);
  });

  it("never writes status, claim or pull request, and keeps what people wrote", async () => {
    const board = existingBoard();
    await syncSections(board.store, doc(), limits, { refreshNotes: false });
    expect(board.tasks[0]).toMatchObject({
      status: "in_progress",
      assigned_agent_id: "agent-1",
      pr_url: "https://github.com/o/r/pull/9",
      description: "Hand written.",
    });
    expect(board.tasks[0]).not.toHaveProperty("priority");
    expect(board.sections[0].description).toBe("Mine.");
  });

  it("fills what is empty: acceptance, context, colour, goals, intentions; and only adds tags", async () => {
    const board = existingBoard();
    await syncSections(board.store, doc(), limits, { refreshNotes: false });
    expect(board.tasks[0]).toMatchObject({
      acceptance_criteria: "Works.",
      ai_context: "Context.",
      color: "#3b82f6",
      labels: ["auth", "api"],
    });
    expect(board.sections[0]).toMatchObject({
      goals: "Goal.",
      intentions: "Intent.",
      tags: ["infra"],
    });
  });

  it("adds the features, steps and questions the task lacks, with the step links", async () => {
    const board = existingBoard();
    const out = await syncSections(board.store, doc(), limits, { refreshNotes: false });
    expect(out).toMatchObject({ createdFeatures: 2, createdSteps: 3, createdQuestions: 2 });
    const mine = board.features.filter((f) => f.taskId === "T1");
    expect(mine.map((f) => f.text)).toEqual(["Sign in", "Refresh"]);
    expect(board.steps.find((s) => s.text === "Cookie")!.featureId).toBe(
      mine.find((f) => f.text === "Refresh")!.id,
    );
  });

  it("does not add a feature or question the task already has, and leaves met and answers alone", async () => {
    const board = existingBoard();
    board.features.push({ id: "F0", taskId: "T1", text: "sign  IN", met: false, position: 1 });
    board.questions.push({
      id: "Q0",
      taskId: "T1",
      body: "Which provider?",
      blocking: true,
      status: "answered",
      answer: "Auth0",
    });
    await syncSections(board.store, doc(), limits, { refreshNotes: false });
    expect(board.features.filter((f) => f.taskId === "T1").map((f) => f.text)).toEqual([
      "sign  IN",
      "Refresh",
    ]);
    expect(board.features[0]).toMatchObject({ met: false });
    expect(board.questions.filter((q) => q.taskId === "T1").map((q) => q.body)).toEqual([
      "Which provider?",
      "SSO?",
    ]);
    expect(board.questions[0]).toMatchObject({ status: "answered", answer: "Auth0" });
    // The existing feature is the one the step points at.
    expect(board.steps.find((s) => s.text === "Middleware")!.featureId).toBe("F0");
  });

  it("is idempotent: a second run writes nothing", async () => {
    const board = existingBoard();
    await syncSections(board.store, doc(), limits, { refreshNotes: false });
    const before = board.writes.length;
    const again = await syncSections(board.store, doc(), limits, { refreshNotes: false });
    expect(board.writes.slice(before)).toEqual([]);
    expect(again).toMatchObject({
      createdTasks: 0,
      createdSteps: 0,
      createdFeatures: 0,
      createdQuestions: 0,
      updatedTasks: 0,
      updatedSections: 0,
    });
  });

  it("falls back to titles when the ids are from another board", async () => {
    const board = memoryBoard({
      sections: [{ id: "S9", title: "Foundations", description: null, position: 1 }],
      tasks: [
        {
          id: "T9",
          sectionId: "S9",
          title: "Auth gate",
          description: null,
          acceptance_criteria: null,
          status: "available",
          position: 1,
          assigned_agent_id: null,
          pr_url: null,
        },
      ],
    });
    const sections = [
      {
        ...DOC.sections[0],
        id: "other-board-section",
        tasks: [{ ...DOC.sections[0].tasks[0], id: "other-board-task" }],
      },
    ];
    const out = await syncSections(board.store, sections, limits, { refreshNotes: false });
    expect(out).toMatchObject({
      createdSections: 0,
      matchedSections: 1,
      matchedTasks: 1,
      createdTasks: 0,
    });
    expect(board.tasks[0].description).toBe("Brief.");
  });

  it("still refreshes a section note when it gains tasks, for outlines (the default)", async () => {
    const board = memoryBoard({
      sections: [{ id: "S1", title: "S", description: "old", position: 1 }],
    });
    await syncSections(
      board.store,
      [{ title: "S", description: "new", tasks: [{ title: "T", description: "", steps: [] }] }],
      limits,
    );
    expect(board.sections[0].description).toBe("new");
  });
});
