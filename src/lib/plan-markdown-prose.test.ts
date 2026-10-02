import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parsePlanMarkdown,
  planMarkdownCoverage,
  serializePlanMarkdown,
  type PlanMdSection,
} from "./plan-markdown";

const real = readFileSync(new URL("./__fixtures__/openbot-v2-plan.md", import.meta.url), "utf8");

function section(doc: ReturnType<typeof parsePlanMarkdown>, prefix: string): PlanMdSection {
  const found = doc.sections.find((s) => s.title.startsWith(prefix));
  if (!found) throw new Error(`no section starting with ${prefix}`);
  return found;
}

describe("prose sections — the real OpenBot v2 plan", () => {
  const doc = parsePlanMarkdown(real);

  it("still places every line of the document", () => {
    const coverage = planMarkdownCoverage(real, doc);
    expect(coverage.lines).toBeGreaterThan(250);
    expect(coverage.missing).toEqual([]);
  });

  it("§6: the Implementation list becomes tasks, Acceptance becomes their criteria", () => {
    const six = section(doc, "6.");

    expect(six.tasks.map((t) => t.title)).toEqual([
      "New ToolCallGroup in ui/src/components/ToolCallCard.tsx (keep ToolCallRow = existing details body).",
      "normalizeToolCalls(list)",
      "Stop persisting the flat shape: store paired calls in messages.tool_calls (conversation.ts:543-569); normalizer keeps old rows readable.",
      "Reuse ToolCallGroup in the issue timeline transcript and in the Code narrative (§8) so tool bars look identical everywhere.",
    ]);
    for (const task of six.tasks) {
      expect(task.acceptance).toContain("5 sequential calls render as one ≤32px line");
      expect(task.done).toBeUndefined();
    }
    // A title cut at its first clause keeps the whole line in the description.
    expect(six.tasks[1].description).toContain("accepts both the live shape");
  });

  it("§6: what is not a task stays in the note, in source order", () => {
    const note = section(doc, "6.").description ?? "";

    expect(note.indexOf("**Today:**")).toBeLessThan(note.indexOf("**Target:**"));
    expect(note.indexOf("**Target:**")).toBeLessThan(note.indexOf("Rules:"));
    expect(note.indexOf("Rules:")).toBeLessThan(note.indexOf("* While running"));
    expect(note.indexOf("* While running")).toBeLessThan(note.indexOf("**Implementation**"));
    // The Rules bullets are rules, not work: they stay text, right under their label.
    expect(note).toContain("* While running: one line");
    expect(note).toContain("* Failed calls turn the dot red");
    expect(note).toContain("Used 5 tools");
    // What became a task is not repeated, and neither is the Acceptance line.
    expect(note).not.toContain("New `ToolCallGroup`");
    expect(note).not.toContain("**Acceptance:**");
    expect(note.trimEnd().endsWith("---")).toBe(false);
  });

  it("§7: the numbered Plan becomes tasks, and the finished spike is marked done", () => {
    const seven = section(doc, "7.");

    expect(seven.tasks.map((t) => t.title)).toEqual([
      "Spike done (2026-10-02, with your approval, one call, on the VPS using the app's own modules; token never printed, script deleted afterwards)",
      "Implement chatGeminiSubscription as an SSE reader mirroring chatGemini (ai-client.ts:313-360)",
      "Fallback (now only needed if long answers turn out to arrive as one frame)",
      "Work/coding runs stream too",
    ]);
    expect(seven.tasks.map((t) => t.done === true)).toEqual([true, false, false, false]);
    // The spike's evidence (nested bullets) is kept with it.
    expect(seven.tasks[0].description).toContain("first frame at **2.85 s**");
    expect(seven.tasks[0].description).toContain("HTTP 200");
    expect(seven.tasks[1].acceptance).toContain("first token visible < 2s");
    expect(seven.description).toContain("**Cause.**");
  });

  it("§2: an open-items list becomes tasks and the done paragraph stays a note", () => {
    const two = section(doc, "2.");

    expect(two.tasks.map((t) => t.title)).toEqual([
      "No periodic heartbeat — only manual (§11, Phase 5).",
      "Issue comments exist in the API/agent tools but are not rendered anywhere in the UI yet (§4 fixes this).",
      'The "agent → coder" hand-off is invisible: you see a Ceo job *and* a coding job but nothing connects them as one story (§4 timeline).',
    ]);
    expect(two.description).toContain("**Done in #35:**");
  });

  it("reference sections with no to-do list stay notes and get no invented tasks", () => {
    for (const prefix of ["0.", "1.", "3.", "11.", "13.", "Appendix A", "Appendix B"]) {
      const s = section(doc, prefix);
      expect(s.tasks, prefix).toEqual([]);
      expect(s.description, prefix).toBeTruthy();
    }
  });

  it("sections that already had sub-headings keep their tasks unchanged", () => {
    expect(section(doc, "8.").tasks).toHaveLength(5);
    expect(section(doc, "9.").tasks.map((t) => t.title.slice(0, 2))).toEqual(["9a", "9b", "9c"]);
    expect(section(doc, "10.").tasks).toHaveLength(6);
    expect(section(doc, "12.").tasks).toHaveLength(5);
  });

  it("an Acceptance line inside a sub-heading task becomes its criteria, not description", () => {
    const task = section(doc, "9.").tasks[1];

    expect(task.acceptance).toContain("process gone within 5 s");
    expect(task.description).not.toContain("**Acceptance:**");
  });

  it("round-trips through the numbered export with the same tasks, flags and criteria", () => {
    const again = parsePlanMarkdown(serializePlanMarkdown(doc));
    const shape = (d: typeof doc) =>
      d.sections.map((s) => ({
        title: s.title,
        tasks: s.tasks.map((t) => [t.title, t.done === true, t.acceptance ?? ""]),
      }));

    expect(shape(again)).toEqual(shape(doc));
    // The only line the export drops is the document title, which is the plan's own title.
    expect(planMarkdownCoverage(real, again).missing).toEqual([
      "# Plan: clean work surfaces, live visibility and runtime fixes",
    ]);
  });
});

describe("prose sections — rules", () => {
  const wrap = (body: string) => `# Doc\n\n## Chapter\n\n${body}\n`;
  const first = (md: string) => parsePlanMarkdown(wrap(md)).sections[0];

  it("only a list directly under an action label is a to-do list", () => {
    const s = first(`Intro.\n\n**Rules**\n\n* one\n* two\n\n**Notes**\n\n- three\n`);
    expect(s.tasks).toEqual([]);
    // Kept as written, in order, with their labels.
    expect(s.description).toBe("Intro.\n\n**Rules**\n\n* one\n* two\n\n**Notes**\n\n- three");
  });

  it("an action label with text on the same line is a sentence, not a list header", () => {
    const s = first(`**Fix:** change the parser.\n\n- keep this\n- and this\n`);
    expect(s.tasks).toEqual([]);
  });

  it("an Acceptance block with no action list stays in the note", () => {
    const s = first(`Prose.\n\n**Acceptance:** it works.\n`);
    expect(s.tasks).toEqual([]);
    expect(s.description).toContain("**Acceptance:** it works.");
  });

  it("takes each list entry as a task, with nested bullets kept in its description", () => {
    const s = first(
      [
        "Why.",
        "",
        "**Implementation**",
        "",
        "1. Add the parser",
        "   - cover fences",
        "   - cover tables",
        "2. Wire the API",
        "",
        "**Acceptance:** all green.",
      ].join("\n"),
    );

    expect(s.tasks.map((t) => t.title)).toEqual(["Add the parser", "Wire the API"]);
    expect(s.tasks[0].description).toBe("- cover fences\n- cover tables");
    expect(s.tasks[0].acceptance).toBe("all green.");
    expect(s.description).toBe("Why.\n\n**Implementation**");
  });

  it("turns ticked nested items into steps", () => {
    const s = first(["**Steps**", "", "- Build it", "  - [x] design", "  - [ ] ship"].join("\n"));

    expect(s.tasks).toHaveLength(1);
    expect(s.tasks[0].steps).toEqual([
      { text: "design", done: true, depth: 0 },
      { text: "ship", done: false, depth: 0 },
    ]);
  });

  it("reads a leading check emoji or ticked box as done, and strips it from the title", () => {
    const s = first(
      ["**Plan**", "", "- ✅ Shipped it", "- [x] Also shipped", "- [ ] Not yet"].join("\n"),
    );

    expect(s.tasks.map((t) => [t.title, t.done === true])).toEqual([
      ["Shipped it", true],
      ["Also shipped", true],
      ["Not yet", false],
    ]);
  });

  it("ignores labels and lists inside code fences", () => {
    const s = first(["Prose.", "", "```md", "**Plan**", "", "- not a task", "```"].join("\n"));

    expect(s.tasks).toEqual([]);
    expect(s.description).toContain("- not a task");
  });

  it("keeps a long first line whole in the description when the title is cut to its first clause", () => {
    const long = `Do the thing properly now: ${"and then more of it, ".repeat(15)}done`;
    const s = first(`**Plan**\n\n- ${long}\n`);

    expect(s.tasks[0].title).toBe("Do the thing properly now");
    expect(s.tasks[0].description).toBe(long);
  });

  it("does not touch a section whose body is only a list", () => {
    const s = first(`- First thing\n- Second thing\n`);
    expect(s.tasks.map((t) => t.title)).toEqual(["First thing", "Second thing"]);
    expect(s.description).toBeUndefined();
  });

  it("does not look inside a section that has sub-headings", () => {
    const s = first(`**Plan**\n\n- one\n- two\n\n### Real task\n\nBody.\n`);
    expect(s.tasks.map((t) => t.title)).toEqual(["Real task"]);
    expect(s.description).toContain("- one");
  });
});
