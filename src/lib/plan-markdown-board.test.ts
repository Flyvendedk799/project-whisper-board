import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isBoardMarkdown, parseBoardMarkdown, serializeBoardMarkdown } from "./plan-markdown-board";
import {
  parsePlanMarkdown,
  planMarkdownCoverage,
  planMarkdownCounts,
  planMarkdownPreview,
  serializePlanMarkdown,
  type PlanMdDocument,
} from "./plan-markdown";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const SECTION_ID = "33333333-3333-4333-8333-333333333333";
const PLAN_ID = "44444444-4444-4444-8444-444444444444";

function rich(): PlanMdDocument {
  return {
    title: "Q4 Launch",
    plan: {
      id: PLAN_ID,
      status: "active",
      exportedAt: "2026-10-02",
      description: "Ship the new sign-in.",
      repo: "acme/app",
      base: "main",
      workMode: "new",
      workBranch: "plan/q4-launch",
    },
    sections: [
      {
        title: "Foundations",
        id: SECTION_ID,
        description: "Everything else stands on this.",
        goals: "Sign-in works end to end.",
        intentions: "Keep it boring.\n\n- no new vendors",
        clientSummary: "Vi har bygget loginsiden, og næste skridt er at teste den.",
        tags: ["infra", "security"],
        color: "#8b5cf6",
        tasks: [
          {
            title: "Auth gate",
            description: "Wire the session middleware.\n\nSee `auth/`.",
            id: TASK_ID,
            status: "blocked",
            priority: "high",
            size: "medium",
            tags: ["auth", "api"],
            color: "var(--chart-1)",
            assignee: "Ana Ruiz",
            clientTitle: "Tryggere login",
            clientSummary: "Man bliver nu logget ind på en sikker måde.",
            features: [
              { text: "Sign in with email", met: true },
              { text: "Sessions refresh silently", met: false },
            ],
            steps: [
              { text: "Write middleware", done: true, depth: 0, feature: 1 },
              { text: "Cookie refresh", done: false, depth: 1, feature: 2 },
              { text: "Docs", done: false, depth: 0 },
            ],
            acceptance: "Expired sessions redirect to sign-in.\n\nAnd nothing leaks.",
            context: "Uses `requireSupabaseAuth`.\n\n```ts\nconst x = 1;\n```",
            questions: [
              { body: "Which identity provider?", blocking: true, status: "open" },
              {
                body: "Do we need SSO?\nAsk legal.",
                blocking: false,
                status: "answered",
                answer: "Not for v1.\n\nRevisit in Q1.",
              },
              { body: "Support IE11?", blocking: false, status: "dismissed" },
              {
                body: "Was this once blocking?",
                blocking: true,
                status: "answered",
                answer: "No.",
              },
            ],
          },
          {
            title: "Password reset",
            description: "",
            status: "done",
            done: true,
            steps: [],
          },
        ],
      },
      { title: "Empty section", tasks: [] },
    ],
  };
}

const withoutMarks = ({ format: _format, structural: _structural, ...rest }: PlanMdDocument) =>
  rest;

describe("serializeBoardMarkdown", () => {
  it("writes a title, a header row, sections and tasks with their parts", () => {
    const md = serializeBoardMarkdown(rich());
    expect(
      md.startsWith("<!-- boared:plan-export v1 -->\n\n# Q4 Launch\n\n> **Status:** Active"),
    ).toBe(true);
    expect(md).toContain("**Branch:** `plan/q4-launch` (new branch)");
    expect(md).toContain(
      "## Foundations\n\n> **Tags:** `infra` `security` · **Colour:** Violet `#8b5cf6`",
    );
    expect(md).toContain(
      "### Auth gate\n\n> **Status:** Blocked · **Priority:** High · **Size:** Medium",
    );
    expect(md).toContain(
      "**Features**\n\n1. [x] Sign in with email\n2. [ ] Sessions refresh silently",
    );
    expect(md).toContain(
      "**Sub-steps**\n\n- [x] Write middleware → feature 1\n  - [ ] Cookie refresh → feature 2\n- [ ] Docs",
    );
    expect(md).toContain(
      "<details>\n<summary>Technical context</summary>\n\nUses `requireSupabaseAuth`.",
    );
    expect(md).toContain("- **Open · blocking** — Which identity provider?");
    expect(md).toContain("  > **Answer:** Not for v1.");
    expect(md).toContain(
      "**Client summary**\n\nVi har bygget loginsiden, og næste skridt er at teste den.",
    );
    expect(md).toContain("**Client title**\n\nTryggere login");
    expect(md).toContain("**Client summary**\n\nMan bliver nu logget ind på en sikker måde.");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("leaves out every part that is empty", () => {
    const md = serializeBoardMarkdown({
      title: "Bare",
      sections: [{ title: "S", tasks: [{ title: "T", description: "", steps: [] }] }],
    });
    expect(md).toBe(
      "<!-- boared:plan-export v1 -->\n\n# Bare\n\n## S\n\n### T\n\n> **Status:** Available\n",
    );
  });

  it("keeps free text from starting a section or a task", () => {
    const md = serializeBoardMarkdown({
      title: "P",
      sections: [
        {
          title: "S",
          description: "# loud\n## louder\n### loudest\n#### fine\n```\n## in code\n```",
          tasks: [{ title: "T", description: "intro\n\n### Not a task\ntext", steps: [] }],
        },
      ],
    });
    const parsed = parseBoardMarkdown(md);
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].tasks.map((t) => t.title)).toEqual(["T"]);
    expect(parsed.sections[0].description).toBe(
      "#### loud\n#### louder\n#### loudest\n#### fine\n```\n## in code\n```",
    );
    expect(parsed.sections[0].tasks[0].description).toBe("intro\n\n#### Not a task\ntext");
  });

  it("does not link a step to a feature that is not there", () => {
    const md = serializeBoardMarkdown({
      title: "P",
      sections: [
        {
          title: "S",
          tasks: [
            {
              title: "T",
              description: "",
              steps: [{ text: "x", done: false, depth: 0, feature: 3 }],
            },
          ],
        },
      ],
    });
    expect(md).toContain("- [ ] x\n");
    expect(md).not.toContain("feature");
  });
});

describe("parseBoardMarkdown — round trip", () => {
  it("reads back exactly what was written", () => {
    const doc = rich();
    const md = serializeBoardMarkdown(doc);
    const parsed = parsePlanMarkdown(md);
    expect(parsed.format).toBe("board");
    expect(withoutMarks(parsed)).toEqual(doc);
  });

  it("reads a task's client title and summary, apart from the section's summary", () => {
    const parsed = parsePlanMarkdown(serializeBoardMarkdown(rich()));
    const [section] = parsed.sections;
    expect(section.clientSummary).toBe(
      "Vi har bygget loginsiden, og næste skridt er at teste den.",
    );
    expect(section.tasks[0].clientTitle).toBe("Tryggere login");
    expect(section.tasks[0].clientSummary).toBe("Man bliver nu logget ind på en sikker måde.");
    expect(section.tasks[1].clientTitle).toBeUndefined();
  });

  it("is stable: writing the parsed document gives the same file", () => {
    const md = serializeBoardMarkdown(rich());
    expect(serializeBoardMarkdown(parsePlanMarkdown(md))).toBe(md);
  });

  it("places every line of the file", () => {
    const md = serializeBoardMarkdown(rich());
    const coverage = planMarkdownCoverage(md, parsePlanMarkdown(md));
    expect(coverage.missing).toEqual([]);
    expect(coverage.lines).toBeGreaterThan(30);
  });

  it("counts what the import dialog shows", () => {
    expect(planMarkdownCounts(parsePlanMarkdown(serializeBoardMarkdown(rich())))).toEqual({
      features: 2,
      questions: 4,
      openQuestions: 1,
      blockingQuestions: 1,
      tags: 4,
    });
  });

  it("previews features and questions under their task", () => {
    const preview = planMarkdownPreview(parsePlanMarkdown(serializeBoardMarkdown(rich())));
    const task = preview[0].children[0];
    expect(task.title).toBe("Auth gate");
    expect(task.children.filter((n) => n.feature).map((n) => n.title)).toEqual([
      "Sign in with email",
      "Sessions refresh silently",
    ]);
    expect(task.children.filter((n) => n.question)).toHaveLength(4);
    expect(task.children.filter((n) => n.step)).toHaveLength(3);
  });
});

describe("parseBoardMarkdown — written by hand", () => {
  const hand = `# Hand made

> **Status:** Draft · **Repo:** \`acme/app\`

Intro.

## Build

> **Color:** teal · **Tags:** #Front-End, api

### Wire it up

> **Status:** in_progress · **Priority:** CRITICAL · **Complexity:** large · **Labels:** \`x\` \`y\`

The brief.

**Requirements**

- [x] First one
- Second one
3) Third one

**Steps**

- [ ] top → feature 2
    - deep
- [ ] nothing here -> feature 9

**Acceptance criteria:** It works.

**Open questions**

- Who owns this?
- [x] Is it done?
- **Dismissed** — Not needed
`;

  const parsed = parsePlanMarkdown(hand);

  it("is read as the board format", () => {
    expect(parsed.format).toBe("board");
    expect(parsed.title).toBe("Hand made");
    expect(parsed.plan).toEqual({ status: "draft", repo: "acme/app", description: "Intro." });
  });

  it("understands words, aliases and plain lists", () => {
    const section = parsed.sections[0];
    expect(section).toMatchObject({ title: "Build", color: "#14b8a6", tags: ["front-end", "api"] });
    expect(section.tasks[0]).toMatchObject({
      title: "Wire it up",
      description: "The brief.",
      status: "in_progress",
      priority: "critical",
      size: "large",
      tags: ["x", "y"],
      acceptance: "It works.",
      features: [
        { text: "First one", met: true },
        { text: "Second one", met: false },
        { text: "Third one", met: false },
      ],
      questions: [
        { body: "Who owns this?", blocking: false, status: "open" },
        { body: "Is it done?", blocking: false, status: "answered" },
        { body: "Not needed", blocking: false, status: "dismissed" },
      ],
    });
  });

  it("links steps to features that exist and leaves other markers in the text", () => {
    expect(parsed.sections[0].tasks[0].steps).toEqual([
      { text: "top", done: false, depth: 0, feature: 2 },
      { text: "deep", done: false, depth: 1 },
      { text: "nothing here -> feature 9", done: false, depth: 0 },
    ]);
  });

  it("places every line", () => {
    expect(planMarkdownCoverage(hand, parsed).missing).toEqual([]);
  });

  it("keeps values it cannot read in the text instead of dropping them", () => {
    const doc = parsePlanMarkdown(
      `<!-- boared:plan-export v1 -->\n# P\n\n## S\n\n### T\n\n> **Status:** Someday · **Priority:** High · **Colour:** mauve\n\nBrief.`,
    );
    const task = doc.sections[0].tasks[0];
    expect(task.priority).toBe("high");
    expect(task.status).toBeUndefined();
    expect(task.description).toBe("Brief.\n\n**Status:** Someday\n\n**Colour:** mauve");
  });

  it("leaves prose after a bold word alone", () => {
    const doc = parsePlanMarkdown(
      `<!-- boared:plan-export v1 -->\n# P\n\n## S\n\n### T\n\n**Features** are listed in the spec.\n\n**Acceptance:** Done.`,
    );
    const task = doc.sections[0].tasks[0];
    expect(task.description).toBe("**Features** are listed in the spec.");
    expect(task.acceptance).toBe("Done.");
    expect(task.features).toBeUndefined();
  });

  it("does not read a task from a heading inside a code fence", () => {
    const doc = parsePlanMarkdown(
      "<!-- boared:plan-export v1 -->\n# P\n\n## S\n\n### T\n\n```md\n### Not a task\n**Features**\n```",
    );
    expect(doc.sections[0].tasks).toHaveLength(1);
    expect(doc.sections[0].tasks[0].description).toContain("### Not a task");
    expect(doc.sections[0].tasks[0].features).toBeUndefined();
  });
});

describe("isBoardMarkdown", () => {
  it("recognises the marker, or a heading followed by two known meta keys", () => {
    expect(isBoardMarkdown("<!-- boared:plan-export v1 -->\n# P")).toBe(true);
    expect(
      isBoardMarkdown("# P\n\n## S\n\n### T\n\n> **Status:** Done · **Priority:** High\n"),
    ).toBe(true);
  });

  it("leaves every other document to the outline parser", () => {
    expect(isBoardMarkdown("# P\n\n## S\n\n### T\n\n> **Status:** Done\n")).toBe(false);
    expect(isBoardMarkdown("# P\n\n> **Status:** Done · **Owner:** me\n")).toBe(false);
    expect(isBoardMarkdown("1 Foundations\n1.1 Auth\n")).toBe(false);
    expect(isBoardMarkdown("- a\n  - b\n")).toBe(false);
    expect(isBoardMarkdown("```\n<!-- boared:plan-export v1 -->\n```")).toBe(false);
    expect(
      isBoardMarkdown(
        readFileSync(new URL("./__fixtures__/openbot-v2-plan.md", import.meta.url), "utf8"),
      ),
    ).toBe(false);
  });
});

describe("legacy documents still import as before", () => {
  it("numbered outline: sections, tasks, nested description, no board fields", () => {
    const doc = parsePlanMarkdown(
      "1 Foundations\n1.1 Auth gate\nWire it.\n\n1.1.1 Cookie\n1.2 Switcher",
    );
    expect(doc).toEqual({
      sections: [
        {
          title: "Foundations",
          tasks: [
            { title: "Auth gate", description: "Wire it.\n\n- Cookie", steps: [] },
            { title: "Switcher", description: "", steps: [] },
          ],
        },
      ],
    });
  });

  it("a wrapping title with a status row stays a preamble, not a plan header", () => {
    const doc = parsePlanMarkdown(
      "# Design\n\n> **Status:** draft\n\n## One\n\n- [ ] a\n\n## Two\n\nProse.",
    );
    expect(doc.format).toBeUndefined();
    expect(doc.plan).toBeUndefined();
    expect(doc.title).toBe("Design");
    expect(doc.preamble).toBe("> **Status:** draft");
    expect(doc.sections.map((s) => s.title)).toEqual(["One", "Two"]);
  });

  it("the openbot fixture parses without any board field", () => {
    const doc = parsePlanMarkdown(
      readFileSync(new URL("./__fixtures__/openbot-v2-plan.md", import.meta.url), "utf8"),
    );
    expect(doc.format).toBeUndefined();
    expect(doc.structural).toBeUndefined();
    expect(doc.sections.length).toBeGreaterThan(10);
    for (const task of doc.sections.flatMap((s) => s.tasks)) {
      expect(task.status).toBeUndefined();
      expect(task.features).toBeUndefined();
      expect(task.questions).toBeUndefined();
    }
  });

  it("the legacy serializer is unchanged", () => {
    expect(
      serializePlanMarkdown({
        sections: [{ title: "S", tasks: [{ title: "T", description: "d", steps: [] }] }],
      }),
    ).toBe("1 S\n1.1 T\nd\n");
  });
});
