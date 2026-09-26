import { describe, expect, it } from "vitest";
import {
  parsePlanMarkdown,
  planMarkdownFilename,
  planMarkdownPreview,
  planMarkdownStats,
  readTaskOutline,
  serializePlanMarkdown,
  type PlanMdDocument,
} from "./plan-markdown";

function titles(doc: PlanMdDocument) {
  return doc.sections.map((s) => ({
    title: s.title,
    tasks: s.tasks.map((t) => ({
      title: t.title,
      description: t.description,
    })),
  }));
}

describe("parsePlanMarkdown — numbered outlines", () => {
  it("maps 1 / 1.1 / 1.1.1 into sections, tasks, and nested description", () => {
    const doc = parsePlanMarkdown(`
1 Foundations
1.1 Auth gate
Wire the session middleware.

1.1.1 Cookie refresh
1.1.2 Logout path

1.2 Workspace switcher

2 Board UX
2.1 Drag cards
`);

    expect(titles(doc)).toEqual([
      {
        title: "Foundations",
        tasks: [
          {
            title: "Auth gate",
            description: "Wire the session middleware.\n\n- Cookie refresh\n- Logout path",
          },
          {
            title: "Workspace switcher",
            description: "",
          },
        ],
      },
      {
        title: "Board UX",
        tasks: [
          {
            title: "Drag cards",
            description: "",
          },
        ],
      },
    ]);
  });

  it("accepts multi-segment dotted keys with titles on the same line", () => {
    const doc = parsePlanMarkdown(`3 Backend
3.1 Migrations
3.1.1 Add index`);
    expect(doc.sections[0].title).toBe("Backend");
    expect(doc.sections[0].tasks[0].title).toBe("Migrations");
    expect(doc.sections[0].tasks[0].description).toContain("- Add index");
  });

  it("does not treat markdown ordered lists (1. Title) as outline keys", () => {
    const doc = parsePlanMarkdown(`
1 Foundations
1.1 Auth gate
Setup notes.

1. First ordered step under the task.
2. Second ordered step.

1.2 Workspace switcher
`);

    expect(doc.sections.map((s) => s.title)).toEqual(["Foundations"]);
    expect(doc.sections[0].tasks.map((t) => t.title)).toEqual(["Auth gate", "Workspace switcher"]);
    expect(doc.sections.map((s) => s.title)).not.toContain("First ordered step under the task.");
    expect(doc.sections[0].tasks[0].description).toContain("- First ordered step under the task.");
    expect(doc.sections[0].tasks[0].description).toContain("- Second ordered step.");
  });

  it("does not treat number-leading prose as a bare outline key", () => {
    const doc = parsePlanMarkdown(`
1 Foundations
1.1 Auth gate
2400 is four attended fields when workers are up.
25 ms is half the budget.
`);

    expect(doc.sections.map((s) => s.title)).toEqual(["Foundations"]);
    expect(doc.sections[0].tasks.map((t) => t.title)).toEqual(["Auth gate"]);
    expect(doc.sections[0].tasks[0].description).toContain("2400 is four attended fields");
    expect(doc.sections[0].tasks[0].description).toContain("25 ms is half the budget.");
  });
});

describe("parsePlanMarkdown — headings", () => {
  it("maps H1/H2/H3 to section/task/nested", () => {
    const doc = parsePlanMarkdown(`
# Alpha
## Task one
Details for task one.

### Nested A
### Nested B

## Task two

# Beta
## Only task
`);

    expect(doc.sections.map((s) => s.title)).toEqual(["Alpha", "Beta"]);
    expect(doc.sections[0].tasks.map((t) => t.title)).toEqual(["Task one", "Task two"]);
    expect(doc.sections[0].tasks[0].description).toContain("Details for task one.");
    expect(doc.sections[0].tasks[0].description).toContain("- Nested A");
    expect(doc.sections[0].tasks[0].description).toContain("- Nested B");
  });

  it("promotes a single H1 document title so ## chapters become sections", () => {
    const doc = parsePlanMarkdown(`
# Design doc title
Intro paragraph under the title (dropped, not a section).

## First chapter
### Task A
### Task B

## Second chapter
### Task C
`);

    expect(doc.sections.map((s) => s.title)).toEqual(["First chapter", "Second chapter"]);
    expect(doc.sections.map((s) => s.title)).not.toContain("Design doc title");
    expect(doc.sections[0].tasks.map((t) => t.title)).toEqual(["Task A", "Task B"]);
    expect(doc.sections[1].tasks.map((t) => t.title)).toEqual(["Task C"]);
  });

  it("strips inline markdown from section and task titles", () => {
    const doc = parsePlanMarkdown(`
# Doc
## **Bold chapter** with \`code\`
### __War port__ and \`TIDELINE_FIGHT_WORKERS\`
Body keeps **bold** and \`code\`.
`);

    expect(doc.sections[0].title).toBe("Bold chapter with code");
    expect(doc.sections[0].tasks[0].title).toBe("War port and TIDELINE_FIGHT_WORKERS");
    expect(doc.sections[0].tasks[0].description).toContain("**bold**");
    expect(doc.sections[0].tasks[0].description).toContain("`code`");
  });
});

describe("parsePlanMarkdown — Tideline design-doc skeleton", () => {
  const tidelineSkeleton = `
# Tideline — Four cores

Intro under the title is dropped.

## What is already true, and must stay true

## 0. Four fight workers

### What moves, and what does not

### The fight is not a pure function

### Slice order inside this section

1. Add the port. Every \`this.world\` use in engagement.ts goes through it.
2. Run two engagements on two workers. A snap generated on a worker is received.
3. Only then does production set \`TIDELINE_FIGHT_WORKERS=4\`.

### The budget follows the workers that are actually up

## 1. Soldiers

## 2. Vehicles the war actually crews

### Driver and gunner

### How many, and when

## 3. Boats

## 4. Helicopters

## 5. Smarter soldiers

## 6. Five that belong in this patch because the code already has a hook

### 6.1 The sky has to be answerable

### 6.2 NPC aircraft do not spend the player's strike

## 7. Two biomes, not a new map

### Ridge

### Wharf

## What this patch does not do

## Order of work

1. **War port, workers off.** In-process ticks unchanged.
2. **Two workers, one snap, one seam.** Then production may set workers.
3. **Budget function.** 1080 at zero workers, 2400 at four.

## Tests that define done
`;

  it("maps Tideline H2 chapters to sections and H3s to tasks", () => {
    const doc = parsePlanMarkdown(tidelineSkeleton);

    expect(doc.sections.map((s) => s.title)).toEqual([
      "What is already true, and must stay true",
      "0. Four fight workers",
      "1. Soldiers",
      "2. Vehicles the war actually crews",
      "3. Boats",
      "4. Helicopters",
      "5. Smarter soldiers",
      "6. Five that belong in this patch because the code already has a hook",
      "7. Two biomes, not a new map",
      "What this patch does not do",
      "Order of work",
      "Tests that define done",
    ]);
    expect(doc.sections.map((s) => s.title)).not.toContain("Tideline — Four cores");

    // Ordered-list prose must not become columns.
    const sectionTitles = doc.sections.map((s) => s.title);
    expect(sectionTitles.some((t) => t.startsWith("Add the port"))).toBe(false);
    expect(sectionTitles.some((t) => t.startsWith("Run two engagements"))).toBe(false);
    expect(sectionTitles.some((t) => t.includes("TIDELINE_FIGHT_WORKERS=4"))).toBe(false);
    expect(sectionTitles.some((t) => t.includes("War port, workers off"))).toBe(false);

    const workers = doc.sections.find((s) => s.title === "0. Four fight workers");
    expect(workers?.tasks.map((t) => t.title)).toEqual([
      "What moves, and what does not",
      "The fight is not a pure function",
      "Slice order inside this section",
      "The budget follows the workers that are actually up",
    ]);
    expect(workers?.tasks[2].description).toContain("- Add the port.");
    expect(workers?.tasks[2].description).toContain("- Run two engagements");
    expect(workers?.tasks[2].description).toContain(
      "- Only then does production set `TIDELINE_FIGHT_WORKERS=4`.",
    );

    const order = doc.sections.find((s) => s.title === "Order of work");
    expect(order?.tasks.map((t) => t.title)).toEqual([
      "War port, workers off. In-process ticks unchanged.",
      "Two workers, one snap, one seam. Then production may set workers.",
      "Budget function. 1080 at zero workers, 2400 at four.",
    ]);
    for (const task of order?.tasks ?? []) {
      expect(task.title).not.toMatch(/\*\*/);
      expect(task.title).not.toMatch(/`/);
    }

    const vehicles = doc.sections.find((s) => s.title === "2. Vehicles the war actually crews");
    expect(vehicles?.tasks.map((t) => t.title)).toEqual([
      "Driver and gunner",
      "How many, and when",
    ]);

    const soldiers = doc.sections.find((s) => s.title === "1. Soldiers");
    expect(soldiers?.tasks).toEqual([]);
  });

  it("round-trips Tideline skeleton through numbered export", () => {
    const fromHeadings = parsePlanMarkdown(tidelineSkeleton);
    const again = parsePlanMarkdown(serializePlanMarkdown(fromHeadings));
    expect(titles(again)).toEqual(titles(fromHeadings));
  });
});

describe("parsePlanMarkdown — nested lists", () => {
  it("treats top-level list items as sections", () => {
    const doc = parsePlanMarkdown(`
- Delivery
  - Ship import
  - Ship export
    - Round-trip tests
- Polish
  - Empty states
`);

    expect(titles(doc)).toEqual([
      {
        title: "Delivery",
        tasks: [
          { title: "Ship import", description: "" },
          {
            title: "Ship export",
            description: "- Round-trip tests",
          },
        ],
      },
      {
        title: "Polish",
        tasks: [{ title: "Empty states", description: "" }],
      },
    ]);
  });
});

describe("serializePlanMarkdown", () => {
  it("emits numbered outlines left-to-right", () => {
    const md = serializePlanMarkdown({
      sections: [
        {
          title: "Foundations",
          tasks: [
            {
              title: "Auth gate",
              description: "Wire the session middleware.\n\n- Cookie refresh\n- Logout path",
            },
            { title: "Workspace switcher", description: "" },
          ],
        },
        {
          title: "Board UX",
          tasks: [{ title: "Drag cards", description: "" }],
        },
      ],
    });

    expect(md).toBe(`1 Foundations
1.1 Auth gate
Wire the session middleware.
1.1.1 Cookie refresh
1.1.2 Logout path
1.2 Workspace switcher

2 Board UX
2.1 Drag cards
`);
  });
});

describe("round-trip", () => {
  it("import(export(board)) preserves section/task titles and nesting", () => {
    const original = parsePlanMarkdown(`
1 Foundations
1.1 Auth gate
Wire the session middleware.

1.1.1 Cookie refresh
1.1.2 Logout path

1.2 Workspace switcher

2 Board UX
2.1 Drag cards
`);

    const again = parsePlanMarkdown(serializePlanMarkdown(original));
    expect(titles(again)).toEqual(titles(original));
  });

  it("normalizes headings into the numbered shape and round-trips", () => {
    const fromHeadings = parsePlanMarkdown(`
# Alpha
## Task one
Body

### Nested
## Task two
# Beta
## Only
`);
    const again = parsePlanMarkdown(serializePlanMarkdown(fromHeadings));
    expect(titles(again)).toEqual(titles(fromHeadings));
  });

  it("round-trips nested list outlines", () => {
    const fromLists = parsePlanMarkdown(`
- Delivery
  - Ship import
  - Ship export
    - Round-trip tests
- Polish
  - Empty states
`);
    const again = parsePlanMarkdown(serializePlanMarkdown(fromLists));
    expect(titles(again)).toEqual(titles(fromLists));
  });
});

describe("helpers", () => {
  it("returns empty document for blank input", () => {
    expect(parsePlanMarkdown("")).toEqual({ sections: [] });
    expect(parsePlanMarkdown("   \n\n")).toEqual({ sections: [] });
    expect(planMarkdownStats({ sections: [] })).toEqual({ sections: 0, tasks: 0 });
  });

  it("builds a preview tree", () => {
    const doc = parsePlanMarkdown(`1 A\n1.1 B\n1.1.1 C`);
    expect(planMarkdownPreview(doc)).toEqual([
      {
        title: "A",
        children: [{ title: "B", children: [{ title: "C", children: [] }] }],
      },
    ]);
  });

  it("reads nested outline back out of a task description", () => {
    expect(
      readTaskOutline("Wire the session middleware.\n\n- Cookie refresh\n- Logout path"),
    ).toEqual({
      body: "Wire the session middleware.",
      nested: [
        { title: "Cookie refresh", body: "", children: [] },
        { title: "Logout path", body: "", children: [] },
      ],
    });
    expect(readTaskOutline("- Parent\n  - Child\n    keeps the wire")).toEqual({
      body: "",
      nested: [
        {
          title: "Parent",
          body: "",
          children: [{ title: "Child", body: "keeps the wire", children: [] }],
        },
      ],
    });
    expect(readTaskOutline("Just a paragraph.")).toEqual({
      body: "Just a paragraph.",
      nested: [],
    });
    expect(readTaskOutline(null)).toEqual({ body: "", nested: [] });
  });

  it("builds a download filename from the plan title", () => {
    expect(planMarkdownFilename("My Cool Plan!")).toBe("my-cool-plan.md");
    expect(planMarkdownFilename("   ")).toBe("plan.md");
  });
});
