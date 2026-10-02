import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsePlanMarkdown, type PlanMdSection } from "./plan-markdown";
import {
  syncSections,
  titleKey,
  type ExistingSection,
  type NewStep,
  type NewTask,
  type SyncStore,
} from "./plan-sync";

type Row = {
  id: string;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  position: number;
  status: string;
  assigned_agent_id: string | null;
  pr_url: string | null;
  steps: Array<{ id: string; text: string; position: number; done: boolean }>;
};
type Sec = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  tasks: Row[];
};

/** A plan in memory. It records every write so a test can say what was and was not touched. */
function memoryStore(sections: Sec[]) {
  let counter = 0;
  const id = (prefix: string) => `${prefix}-${(counter += 1)}`;
  const writes: string[] = [];
  const store: SyncStore = {
    async load() {
      return structuredClone(sections) as ExistingSection[];
    },
    async createSection(input) {
      const row: Sec = {
        id: id("sec"),
        description: input.description,
        title: input.title,
        position: input.position,
        tasks: [],
      };
      sections.push(row);
      writes.push(`createSection:${input.title}`);
      return { id: row.id };
    },
    async updateSection(sectionId, patch) {
      sections.find((s) => s.id === sectionId)!.description = patch.description;
      writes.push(`updateSection:${sectionId}`);
    },
    async createTasks(sectionId, tasks: NewTask[]) {
      const section = sections.find((s) => s.id === sectionId)!;
      return tasks.map((task) => {
        const row: Row = {
          id: id("task"),
          title: task.title,
          description: task.description,
          acceptance_criteria: task.acceptance_criteria,
          position: task.position,
          status: task.status,
          assigned_agent_id: null,
          pr_url: null,
          steps: [],
        };
        section.tasks.push(row);
        writes.push(`createTask:${task.title}`);
        return { id: row.id };
      });
    },
    async updateTask(taskId, patch) {
      const row = sections.flatMap((s) => s.tasks).find((t) => t.id === taskId)!;
      Object.assign(row, patch);
      writes.push(`updateTask:${taskId}:${Object.keys(patch).join(",")}`);
    },
    async createSteps(steps: NewStep[]) {
      for (const step of steps) {
        const row = sections.flatMap((s) => s.tasks).find((t) => t.id === step.taskId)!;
        row.steps.push({
          id: id("step"),
          text: step.text,
          position: step.position,
          done: step.done,
        });
        writes.push(`createStep:${step.text}`);
      }
    },
  };
  return { store, sections, writes };
}

const limits = { maxStepDepth: 3, maxStepText: 500 };

function task(title: string, extra: Partial<Row> = {}): Row {
  return {
    id: `t-${title}`,
    title,
    description: null,
    acceptance_criteria: null,
    position: 1,
    status: "available",
    assigned_agent_id: null,
    pr_url: null,
    steps: [],
    ...extra,
  };
}

const doc = (...sections: PlanMdSection[]) => sections;

describe("titleKey", () => {
  it("ignores case, spacing, markdown and a finished-marker", () => {
    expect(titleKey("  ✅ **Phase 0** — `quick`  fixes ")).toBe(titleKey("phase 0 — quick fixes"));
  });
});

describe("syncSections", () => {
  it("adds a task that is missing and leaves the ones that are there alone", async () => {
    const { store, sections, writes } = memoryStore([
      {
        id: "s1",
        title: "Phase 0",
        description: "note",
        position: 1,
        tasks: [
          task("Existing", {
            status: "done",
            assigned_agent_id: "agent-1",
            pr_url: "https://github.com/o/r/pull/9",
            position: 1,
          }),
        ],
      },
    ]);

    const out = await syncSections(
      store,
      doc({
        title: "Phase 0",
        description: "note",
        tasks: [
          { title: "Existing", description: "", steps: [] },
          { title: "Brand new", description: "Do it.", steps: [] },
        ],
      }),
      limits,
    );

    expect(out).toMatchObject({
      createdSections: 0,
      createdTasks: 1,
      matchedSections: 1,
      matchedTasks: 1,
      updatedTasks: 0,
    });
    expect(sections[0].tasks.map((t) => t.title)).toEqual(["Existing", "Brand new"]);
    expect(sections[0].tasks[1]).toMatchObject({
      status: "available",
      description: "Do it.",
      position: 2,
    });
    expect(writes).toEqual(["createTask:Brand new"]);
  });

  it("keeps done tasks done, and never writes status, assignee or pull request", async () => {
    const { store, sections, writes } = memoryStore([
      {
        id: "s1",
        title: "Phase 4",
        description: null,
        position: 1,
        tasks: [
          task("Shipped", {
            status: "done",
            assigned_agent_id: "agent-1",
            pr_url: "https://github.com/o/r/pull/40",
            acceptance_criteria: null,
            description: null,
          }),
          task("Underway", { status: "in_progress", assigned_agent_id: "agent-2" }),
        ],
      },
    ]);

    await syncSections(
      store,
      doc({
        title: "Phase 4",
        tasks: [
          {
            title: "Shipped",
            description: "Now with text.",
            steps: [],
            acceptance: "It works.",
            done: false,
          },
          { title: "Underway", description: "More text.", steps: [], done: true },
        ],
      }),
      limits,
    );

    const [shipped, underway] = sections[0].tasks;
    expect(shipped).toMatchObject({
      status: "done",
      assigned_agent_id: "agent-1",
      pr_url: "https://github.com/o/r/pull/40",
    });
    expect(underway).toMatchObject({ status: "in_progress", assigned_agent_id: "agent-2" });
    // Only description and acceptance criteria are ever written to an existing task.
    expect(
      writes
        .filter((w) => w.startsWith("updateTask"))
        .every((w) =>
          /:(description|acceptance_criteria)(,(description|acceptance_criteria))?$/.test(w),
        ),
    ).toBe(true);
  });

  it("fills empty fields but never overwrites text someone wrote", async () => {
    const { store, sections } = memoryStore([
      {
        id: "s1",
        title: "S",
        description: null,
        position: 1,
        tasks: [
          task("Empty"),
          task("Written", { description: "Mine.", acceptance_criteria: "Mine too." }),
        ],
      },
    ]);

    const out = await syncSections(
      store,
      doc({
        title: "S",
        tasks: [
          {
            title: "Empty",
            description: "From the document.",
            acceptance: "Doc criteria.",
            steps: [],
          },
          {
            title: "Written",
            description: "From the document.",
            acceptance: "Doc criteria.",
            steps: [],
          },
        ],
      }),
      limits,
    );

    expect(out.updatedTasks).toBe(1);
    expect(sections[0].tasks[0]).toMatchObject({
      description: "From the document.",
      acceptance_criteria: "Doc criteria.",
    });
    expect(sections[0].tasks[1]).toMatchObject({
      description: "Mine.",
      acceptance_criteria: "Mine too.",
    });
  });

  it("matches by title however it is written, so a re-import does not duplicate", async () => {
    const { store, sections } = memoryStore([
      {
        id: "s1",
        title: "6. Tool-call bars",
        description: null,
        position: 1,
        tasks: [task("Reuse the group")],
      },
    ]);

    const out = await syncSections(
      store,
      doc({
        title: "6. **Tool-call** bars",
        tasks: [{ title: "reuse  the `group`", description: "", steps: [] }],
      }),
      limits,
    );

    expect(out).toMatchObject({ createdSections: 0, createdTasks: 0, matchedTasks: 1 });
    expect(sections).toHaveLength(1);
  });

  it("creates a section that is not on the board yet, with all of its tasks, steps and finished flags", async () => {
    const { store, sections } = memoryStore([
      { id: "s1", title: "Old", description: null, position: 4, tasks: [] },
    ]);

    const out = await syncSections(
      store,
      doc({
        title: "New",
        description: "About it.",
        tasks: [
          { title: "Done already", description: "", steps: [], done: true },
          {
            title: "To do",
            description: "",
            steps: [
              { text: "first", done: false, depth: 0 },
              { text: "second", done: true, depth: 1 },
            ],
          },
        ],
      }),
      limits,
    );

    expect(out).toMatchObject({ createdSections: 1, createdTasks: 2, createdSteps: 2 });
    const created = sections[1];
    expect(created).toMatchObject({ title: "New", description: "About it.", position: 5 });
    expect(created.tasks.map((t) => [t.title, t.status])).toEqual([
      ["Done already", "done"],
      ["To do", "available"],
    ]);
    expect(created.tasks[1].steps.map((s) => [s.text, s.done])).toEqual([
      ["first", false],
      ["second", true],
    ]);
  });

  it("adds steps that are missing and leaves ticked ones as they are", async () => {
    const { store, sections } = memoryStore([
      {
        id: "s1",
        title: "S",
        description: null,
        position: 1,
        tasks: [task("T", { steps: [{ id: "st1", text: "wire it", position: 1, done: true }] })],
      },
    ]);

    const out = await syncSections(
      store,
      doc({
        title: "S",
        tasks: [
          {
            title: "T",
            description: "",
            steps: [
              { text: "Wire it", done: false, depth: 0 },
              { text: "test it", done: false, depth: 0 },
            ],
          },
        ],
      }),
      limits,
    );

    expect(out.createdSteps).toBe(1);
    expect(sections[0].tasks[0].steps.map((s) => [s.text, s.done, s.position])).toEqual([
      ["wire it", true, 1],
      ["test it", false, 2],
    ]);
  });

  it("refreshes a section's note only when it gains tasks (text moved out of it) or had none", async () => {
    const { store, sections } = memoryStore([
      {
        id: "a",
        title: "Gains",
        description: "old note with the plan list",
        position: 1,
        tasks: [],
      },
      {
        id: "b",
        title: "Unchanged",
        description: "hand edited note",
        position: 2,
        tasks: [task("T")],
      },
      { id: "c", title: "Empty", description: null, position: 3, tasks: [] },
    ]);

    const out = await syncSections(
      store,
      doc(
        {
          title: "Gains",
          description: "new note",
          tasks: [{ title: "Split out", description: "", steps: [] }],
        },
        {
          title: "Unchanged",
          description: "document note",
          tasks: [{ title: "T", description: "", steps: [] }],
        },
        { title: "Empty", description: "filled", tasks: [] },
      ),
      limits,
    );

    expect(out.updatedSections).toBe(2);
    expect(sections.map((s) => s.description)).toEqual(["new note", "hand edited note", "filled"]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    const { store, writes } = memoryStore([
      { id: "s1", title: "S", description: null, position: 1, tasks: [] },
    ]);
    const sections = doc({
      title: "S",
      description: "note",
      tasks: [
        {
          title: "A",
          description: "a",
          steps: [{ text: "s", done: false, depth: 0 }],
          acceptance: "ok",
        },
      ],
    });

    await syncSections(store, sections, limits);
    const afterFirst = writes.length;
    const second = await syncSections(store, sections, limits);

    expect(writes.length).toBe(afterFirst);
    expect(second).toMatchObject({
      createdSections: 0,
      createdTasks: 0,
      createdSteps: 0,
      updatedSections: 0,
      updatedTasks: 0,
    });
  });

  it("keeps tasks that exist only on the board", async () => {
    const { store, sections } = memoryStore([
      { id: "s1", title: "S", description: null, position: 1, tasks: [task("Added by hand")] },
    ]);

    await syncSections(
      store,
      doc({ title: "S", tasks: [{ title: "From doc", description: "", steps: [] }] }),
      limits,
    );

    expect(sections[0].tasks.map((t) => t.title)).toEqual(["Added by hand", "From doc"]);
  });
});

describe("syncSections — the real OpenBot v2 plan, as the first import left it", () => {
  const real = parsePlanMarkdown(
    readFileSync(new URL("./__fixtures__/openbot-v2-plan.md", import.meta.url), "utf8"),
  );

  /**
   * The board as the first (lossy) import made it: sections 6 and 7 have no tasks, the work in the
   * phased plan has been claimed and finished.
   */
  function boardAsFirstImported() {
    let n = 0;
    return real.sections.map<Sec>((s, index) => {
      const tasks = ["6.", "7.", "2."].some((p) => s.title.startsWith(p)) ? [] : s.tasks;
      return {
        id: `sec-${index}`,
        title: s.title,
        description: s.description ?? null,
        position: index + 1,
        tasks: tasks.map((t, i) => ({
          id: `task-${(n += 1)}`,
          title: t.title,
          description: t.description || null,
          acceptance_criteria: null,
          position: i + 1,
          status: s.title.startsWith("10.") ? "done" : "available",
          assigned_agent_id: s.title.startsWith("10.") ? "agent-1" : null,
          pr_url: s.title.startsWith("10.") ? "https://github.com/o/r/pull/40" : null,
          steps: [],
        })),
      };
    });
  }

  it("gives sections 6, 7 and 2 their tasks without touching finished work or adding duplicates", async () => {
    const { store, sections } = memoryStore(boardAsFirstImported());
    const before = structuredClone(sections.filter((s) => s.title.startsWith("10.")));

    const out = await syncSections(store, real.sections, limits);

    const titles = (prefix: string) =>
      sections.find((s) => s.title.startsWith(prefix))!.tasks.map((t) => t.title);
    expect(titles("6.")).toHaveLength(4);
    expect(titles("7.")).toHaveLength(4);
    expect(titles("2.")).toHaveLength(3);
    expect(out.createdTasks).toBe(11);
    expect(out.createdSections).toBe(0);

    // The phased plan: every task still done, claimed and linked to its PR.
    const phased = sections.find((s) => s.title.startsWith("10."))!;
    expect(phased.tasks.map((t) => [t.status, t.assigned_agent_id, t.pr_url])).toEqual(
      before[0].tasks.map((t) => [t.status, t.assigned_agent_id, t.pr_url]),
    );
    // Tasks that already existed keep their count: nothing was duplicated.
    for (const prefix of ["4.", "5.", "8.", "9.", "10.", "12."]) {
      expect(titles(prefix), prefix).toHaveLength(
        real.sections.find((s) => s.title.startsWith(prefix))!.tasks.length,
      );
    }
    // The spike that the plan marks as finished arrives finished.
    const seven = sections.find((s) => s.title.startsWith("7."))!;
    expect(seven.tasks.map((t) => t.status)).toEqual([
      "done",
      "available",
      "available",
      "available",
    ]);

    const again = await syncSections(store, real.sections, limits);
    expect(again).toMatchObject({
      createdSections: 0,
      createdTasks: 0,
      createdSteps: 0,
      updatedSections: 0,
    });
  });
});
