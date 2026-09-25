import { describe, expect, it } from "vitest";
import {
  parsePlanMarkdown,
  planMarkdownFilename,
  planMarkdownPreview,
  planMarkdownStats,
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

  it("accepts dotted keys with titles on the same line", () => {
    const doc = parsePlanMarkdown(`3 Backend
3.1 Migrations
3.1.1 Add index`);
    expect(doc.sections[0].title).toBe("Backend");
    expect(doc.sections[0].tasks[0].title).toBe("Migrations");
    expect(doc.sections[0].tasks[0].description).toContain("- Add index");
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

  it("builds a download filename from the plan title", () => {
    expect(planMarkdownFilename("My Cool Plan!")).toBe("my-cool-plan.md");
    expect(planMarkdownFilename("   ")).toBe("plan.md");
  });
});
