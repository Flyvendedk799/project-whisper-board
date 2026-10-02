/**
 * Round-trip markdown ↔ plan board (sections → tasks → nested-in-description).
 *
 * Canonical export shape is a numbered outline:
 *   1 Section
 *   1.1 Task
 *   body…
 *   1.1.1 Nested (stored inside the task description as a markdown list)
 *
 * Import also accepts ATX headings (# / ## / ###) and nested markdown lists.
 * Outline keys are only bare `1 Title` or multi-segment `1.1 Title` —
 * markdown ordered lists (`1. Title`) are never outline keys.
 * A single wrapping `#` document title whose children are `##` chapters is
 * promoted away so chapters become sections (typical design-doc shape). Its
 * intro text is kept as the document `preamble`.
 * Outline keys are stripped from stored titles and regenerated on export.
 *
 * Nothing in the source is dropped:
 * - prose, tables and code under a section become the section `description`;
 * - bullets under a section that has prose or sub-headings stay text in that
 *   description (a section that is *only* a list still turns its items into
 *   tasks);
 * - lines inside ``` / ~~~ fences are never structure, even if they start
 *   with `#`, `-` or `1.`;
 * - a title cut to fit its column keeps the full text at the top of the
 *   description.
 * `planMarkdownCoverage` proves it by listing any source line that is missing.
 */

import {
  blankLine,
  collapseSpaces,
  FENCE,
  fencedLines,
  joinBody,
  MAX_STEP_DEPTH,
  STEP_TEXT_MAX,
} from "@/lib/plan-markdown-text";
import type {
  PlanStatus,
  PlanTaskComplexity,
  PlanTaskPriority,
  PlanTaskStatus,
} from "@/data/enums";
import type { WorkMode } from "@/lib/plan-fields";
import { isBoardMarkdown, parseBoardMarkdown } from "@/lib/plan-markdown-board";

export { MAX_STEP_DEPTH, STEP_TEXT_MAX };

/** One line of a task's checklist. `depth` is 0 for a top-level step. */
export type PlanMdStep = {
  text: string;
  done: boolean;
  depth: number;
  /** 1-based number of the task feature this step delivers (board format only). */
  feature?: number;
};

/** A requirement written after the brief. Stored as plan_task_features. */
export type PlanMdFeature = {
  text: string;
  met: boolean;
};

/** A question on a task. Stored as plan_task_questions. */
export type PlanMdQuestion = {
  body: string;
  /** Only an open, blocking question holds the task in "blocked". */
  blocking: boolean;
  status: "open" | "answered" | "dismissed";
  answer?: string;
};

export type PlanMdTask = {
  title: string;
  /** Body paragraphs plus nested outline folded as a markdown list. */
  description: string;
  /** `- [ ]` / `- [x]` lines under the task. Stored as plan_task_steps. */
  steps?: PlanMdStep[];
  /** What "done" means, from an `**Acceptance:**` block. Stored as acceptance_criteria. */
  acceptance?: string;
  /** The source marked it finished (a leading ✅ or `[x]`). */
  done?: boolean;
  // Everything below is only filled by the board format (see plan-markdown-board).
  /** The task's id in the board it was exported from; `sync` matches on it. */
  id?: string;
  status?: PlanTaskStatus;
  priority?: PlanTaskPriority;
  size?: PlanTaskComplexity;
  /** Stored as `labels`. */
  tags?: string[];
  color?: string;
  /** A name for people reading the file. Never imported: people are not matched by name. */
  assignee?: string;
  features?: PlanMdFeature[];
  questions?: PlanMdQuestion[];
  /** Stored as `ai_context`. */
  context?: string;
};

export type PlanMdSection = {
  title: string;
  /** Prose, tables and bullets under the section heading (before its tasks). */
  description?: string;
  tasks: PlanMdTask[];
  // Board format only.
  id?: string;
  goals?: string;
  intentions?: string;
  tags?: string[];
  color?: string;
};

/** What the board-format header says about the plan itself. */
export type PlanMdSettings = {
  /** Plan description: the text under the title. */
  description?: string;
  /** Read for people; the import never changes a plan's status. */
  status?: PlanStatus;
  repo?: string;
  base?: string;
  workMode?: WorkMode;
  workBranch?: string;
  id?: string;
  exportedAt?: string;
};

export type PlanMdDocument = {
  sections: PlanMdSection[];
  /** A wrapping `#` document title, when one was promoted away. */
  title?: string;
  /** Text above the first section (a title's intro, a status table, …). */
  preamble?: string;
  /** `board` when the source was the board's own format (see plan-markdown-board). */
  format?: "board";
  /** Board format only: the plan header. */
  plan?: PlanMdSettings;
  /**
   * Board format only: source lines that were read as structure and rewritten
   * (meta rows, labels, question and step markers). Coverage counts them as placed.
   */
  structural?: string[];
};

/** Preview tree for the import dialog (sections → tasks → nested titles). */
export type PlanMdPreviewNode = {
  title: string;
  children: PlanMdPreviewNode[];
  /** Set on checklist lines so the dialog can draw a box. */
  step?: { done: boolean };
  /** Set on a feature line (board format). */
  feature?: { met: boolean };
  /** Set on a question line (board format). */
  question?: { status: PlanMdQuestion["status"]; blocking: boolean };
};

type CheckState = "open" | "done";

/** `list` items are bullets; `outline` items are headings or numbered keys. */
type ItemKind = "outline" | "list";

type OutlineNode = {
  title: string;
  body: string;
  /** Every line under the heading, lists included, in source order. */
  raw?: string;
  children: OutlineNode[];
  check?: CheckState;
  kind?: ItemKind;
};

type FlatItem = {
  depth: number;
  title: string;
  bodyLines: string[];
  rawLines?: string[];
  check?: CheckState;
  kind: ItemKind;
};

/** `[ ] text` / `[x] text` at the start of a list item's title. */
const CHECKBOX = /^\[(?<mark>[ xX])\]\s+(?<rest>\S.*)$/;
/** A whole checklist line, at any indentation. */
const CHECKLIST_LINE = /^(?<indent>[ \t]*)[-*+]\s+\[(?<mark>[ xX])\]\s+(?<text>\S.*)$/;
const PLAIN_LIST_LINE = /^(?<indent>[ \t]*)(?:[-*+]|\d+\.)\s+(?<text>\S.*)$/;

function readCheck(title: string): { title: string; check?: CheckState } {
  const match = title.match(CHECKBOX);
  if (!match?.groups) return { title };
  return {
    title: match.groups.rest.trim(),
    check: match.groups.mark === " " ? "open" : "done",
  };
}

const SECTION_TITLE_MAX = 100;
const TASK_TITLE_MAX = 200;

/**
 * Multi-segment outline key: `1.1 Title` / `3.1.1 Title`.
 * Optional trailing `.` before the title (`1.1. Title`) is allowed.
 */
const NUMBERED_MULTI_KEY = /^(?<key>\d+(?:\.\d+)+)\.?\s+(?<title>\S.*)$/;
/**
 * Bare section key: `1 Foundations`.
 * Deliberately does **not** match `1. Title` (markdown ordered list).
 */
const NUMBERED_BARE_KEY = /^(?<key>\d+)\s+(?<title>\S.*)$/;
const ATX_HEADING = /^(?<hashes>#{1,6})\s+(?<title>\S.*)$/;
const LIST_ITEM = /^(?<indent>[ \t]*)(?:[-*+]|\d+\.)\s+(?<title>\S.*)$/;
const NESTED_HEADING = /^(?<hashes>#{3,6})\s+(?<title>\S.*)$/;

/** Strip inline markdown from stored section/task titles (descriptions keep it). */
function stripInlineMarkdown(title: string): string {
  return title
    .trim()
    .replace(/^#+\s*/, "")
    .replace(/\s*#+$/, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function clampTitle(title: string, max: number): string {
  const trimmed = stripInlineMarkdown(title);
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + "…";
}

function matchNumberedOutline(line: string): { depth: number; title: string } | null {
  const multi = line.match(NUMBERED_MULTI_KEY);
  if (multi?.groups) {
    return {
      depth: multi.groups.key.split(".").length,
      title: multi.groups.title.trim(),
    };
  }
  const bare = line.match(NUMBERED_BARE_KEY);
  if (bare?.groups) {
    const title = bare.groups.title.trim();
    // Reject number-leading prose (`2400 is four…`, `25 ms is half…`).
    // Real outline titles start with a capital, digit, or inline marker.
    if (!/^[\p{Lu}`*_\d]/u.test(title)) return null;
    return { depth: 1, title };
  }
  return null;
}

function listDepth(indent: string): number {
  const spaces = indent.replace(/\t/g, "  ").length;
  return Math.floor(spaces / 2) + 1;
}

function classifyOutlineLine(
  line: string,
  opts?: {
    /** When true, only ATX headings count as outline (skip numbered keys). */ atxOnly?: boolean;
  },
): { depth: number; title: string } | null {
  if (!opts?.atxOnly) {
    const numbered = matchNumberedOutline(line);
    if (numbered) return numbered;
  }

  const heading = line.match(ATX_HEADING);
  if (heading?.groups) {
    return {
      depth: heading.groups.hashes.length,
      title: heading.groups.title.trim(),
    };
  }

  return null;
}

/** True when the source uses ATX headings (# / ## / …). */
function documentHasAtxHeadings(lines: string[], fenced: boolean[]): boolean {
  return lines.some((line, index) => !fenced[index] && ATX_HEADING.test(line));
}

/**
 * True when the document is a nested-list outline (no numbered keys / ATX
 * headings). Top-level list items become sections.
 */
function isListOutlineDocument(lines: string[], fenced: boolean[]): boolean {
  let sawList = false;
  for (const [index, line] of lines.entries()) {
    if (blankLine(line)) continue;
    if (fenced[index]) {
      if (!sawList) return false;
      continue;
    }
    if (classifyOutlineLine(line)) return false;
    if (LIST_ITEM.test(line)) {
      sawList = true;
      continue;
    }
    if (!sawList) return false;
  }
  return sawList;
}

type FlatDocument = {
  items: FlatItem[];
  /** Text that comes before the first heading, key or list item. */
  preamble: string;
};

function parseFlatItems(source: string): FlatDocument {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const fenced = fencedLines(lines);
  const items: FlatItem[] = [];
  const preambleLines: string[] = [];
  let current: FlatItem | null = null;
  /** Depth of the most recent numbered/heading outline item (not a list). */
  let lastStructuralDepth = 0;
  /**
   * Design docs with `#` / `##` often contain prose that starts with a number
   * (`2400 is four…`) and ordered lists (`1. …`). Skip numbered-outline keys
   * there so only ATX headings structure the tree; pure `1` / `1.1` outlines
   * still use the tightened numbered grammar.
   */
  const atxOnly = documentHasAtxHeadings(lines, fenced);

  const pushBody = (text: string) => {
    if (current) current.bodyLines.push(text);
    else preambleLines.push(text);
  };
  const pushLine = (line: string) => {
    if (!blankLine(line)) pushBody(line);
    else if (current ? current.bodyLines.length > 0 : preambleLines.length > 0) pushBody("");
  };
  const listItem = (depth: number, rawTitle: string): FlatItem => {
    const read = readCheck(rawTitle.trim());
    return {
      depth,
      title: read.title,
      bodyLines: [],
      kind: "list",
      ...(read.check && { check: read.check }),
    };
  };

  if (isListOutlineDocument(lines, fenced)) {
    for (const [index, line] of lines.entries()) {
      const list = fenced[index] ? null : line.match(LIST_ITEM);
      if (list?.groups) {
        current = listItem(listDepth(list.groups.indent), list.groups.title);
        items.push(current);
        continue;
      }
      pushLine(line);
    }
    return { items, preamble: joinBody(preambleLines) };
  }

  /** The heading whose raw text the next line belongs to. */
  let heading: FlatItem | null = null;
  /** True while an `**Acceptance:**` paragraph that follows a list is being read. */
  let acceptanceOpen = false;
  const pushRaw = (line: string) => {
    if (heading?.rawLines && (!blankLine(line) || heading.rawLines.length > 0))
      heading.rawLines.push(line);
  };

  for (const [index, line] of lines.entries()) {
    if (fenced[index]) {
      pushBody(line);
      pushRaw(line);
      continue;
    }
    const outline = classifyOutlineLine(line, { atxOnly });
    if (outline) {
      current = {
        depth: outline.depth,
        title: outline.title,
        bodyLines: [],
        rawLines: [],
        kind: "outline",
      };
      items.push(current);
      heading = current;
      lastStructuralDepth = outline.depth;
      continue;
    }
    pushRaw(line);

    // An `**Acceptance:**` paragraph right after a list is the heading's, not the last bullet's.
    if (
      heading &&
      (/^\*\*acceptance/i.test(line) ||
        (acceptanceOpen && !blankLine(line) && !LIST_ITEM.test(line)))
    ) {
      heading.bodyLines.push(line);
      acceptanceOpen = true;
      continue;
    }
    acceptanceOpen = false;

    // List items under a structural outline become deeper nodes.
    const list = line.match(LIST_ITEM);
    if (list?.groups && lastStructuralDepth > 0) {
      current = listItem(lastStructuralDepth + listDepth(list.groups.indent), list.groups.title);
      items.push(current);
      continue;
    }

    pushLine(line);
  }

  return { items, preamble: joinBody(preambleLines) };
}

function buildTree(items: FlatItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: { depth: number; node: OutlineNode }[] = [];

  for (const item of items) {
    const node: OutlineNode = {
      title: item.title,
      body: joinBody(item.bodyLines),
      ...(item.rawLines && { raw: joinBody(item.rawLines) }),
      children: [],
      kind: item.kind,
      ...(item.check && { check: item.check }),
    };

    while (stack.length > 0 && stack[stack.length - 1].depth >= item.depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      roots.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }
    stack.push({ depth: item.depth, node });
  }

  return roots;
}

function serializeNestedList(nodes: OutlineNode[], indent = 0): string {
  const pad = "  ".repeat(indent);
  return nodes
    .map((node) => {
      const box = node.check ? `[${node.check === "done" ? "x" : " "}] ` : "";
      const chunks: string[] = [`${pad}- ${box}${node.title}`];
      if (node.body) {
        for (const line of node.body.split("\n")) {
          chunks.push(`${pad}  ${line}`);
        }
      }
      if (node.children.length > 0) {
        chunks.push(serializeNestedList(node.children, indent + 1));
      }
      return chunks.join("\n");
    })
    .join("\n");
}

function foldTaskDescription(body: string, nested: OutlineNode[]): string {
  const parts: string[] = [];
  if (body.trim()) parts.push(body.trim());
  if (nested.length > 0) parts.push(serializeNestedList(nested));
  return parts.join("\n\n");
}

/**
 * Checked children of a task become its steps. Anything indented under a step
 * is a deeper step, whether or not it carries its own box.
 */
function collectSteps(children: OutlineNode[]): { steps: PlanMdStep[]; rest: OutlineNode[] } {
  const steps: PlanMdStep[] = [];
  const rest: OutlineNode[] = [];

  const take = (node: OutlineNode, depth: number) => {
    const text = collapseSpaces(node.title).slice(0, STEP_TEXT_MAX);
    if (text) {
      steps.push({
        text,
        done: node.check === "done",
        depth: Math.min(depth, MAX_STEP_DEPTH),
      });
    }
    for (const child of node.children) take(child, depth + 1);
  };

  for (const child of children) {
    if (child.check) take(child, 0);
    else rest.push(child);
  }
  return { steps, rest };
}

/**
 * A title is cut to fit its column. When that loses words, the full original
 * goes back in at the top of the description so nothing is dropped.
 */
function fitTitle(raw: string, fallback: string, max: number): { title: string; overflow: string } {
  const source = raw || fallback;
  const title = clampTitle(source, max);
  return { title, overflow: title === stripInlineMarkdown(source) ? "" : source.trim() };
}

function withOverflow(overflow: string, description: string): string {
  return [overflow, description].filter(Boolean).join("\n\n");
}

// ─── Prose sections: bold labels, action lists and acceptance blocks ────────────

/**
 * Bold labels that introduce a to-do list (`**Plan**`, `**Implementation**`,
 * `**Still open here:**`). Labels such as `**Rules**` or `**Target:**` describe
 * rather than ask for work, so a list under them stays text.
 */
const ACTION_LABEL =
  /^(?:plan|implementation|implement|steps?|next steps?|tasks?|to-?do|do|fix(?:es)?|work|action items?|deliverables?|still open(?: here)?|open items?|remaining(?: work)?|left to do)$/i;
const ACCEPTANCE_LABEL = /^acceptance(?: criteria)?$/i;
const RULE_LINE = /^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/;
const LIST_LINE = /^(?<indent>[ \t]*)(?<marker>[-*+]|\d+[.)])[ \t]+(?<text>\S.*)$/;
/** A leading finished-marker on a task title: a ticked box or a check emoji. */
const STATUS_MARK = /^(?:\[(?<box>[xX ])\][ \t]+|(?<emoji>[✅☑✔]️?)[ \t]*)(?<rest>\S.*)$/u;

/** Drops the `---` rules and blank lines a section ends with; they only separate sections. */
function trimTrailingRules(text: string): string {
  const lines = text.split("\n");
  while (
    lines.length > 0 &&
    (blankLine(lines[lines.length - 1]) || RULE_LINE.test(lines[lines.length - 1]))
  ) {
    lines.pop();
  }
  return lines.join("\n");
}

/** `**Label**` or `**Label:** text` at the start of a line. */
function boldLabel(line: string): { label: string; tail: string } | null {
  const match = line.match(/^\*\*(?<label>[^*]{2,80}?)\*\*(?<tail>.*)$/);
  if (!match?.groups) return null;
  return {
    label: match.groups.label
      .trim()
      .replace(/[:.]+$/, "")
      .trim(),
    tail: match.groups.tail.replace(/^\s*[:.]?\s*/, "").trim(),
  };
}

function readStatus(title: string): { title: string; done: boolean } {
  const match = title.trim().match(STATUS_MARK);
  if (!match?.groups) return { title: title.trim(), done: false };
  const done = match.groups.emoji !== undefined || (match.groups.box ?? " ") !== " ";
  return { title: match.groups.rest.trim(), done };
}

function indentWidth(indent: string): number {
  return indent.replace(/\t/g, "  ").length;
}

/** An `**Acceptance:**` block: the label's own text plus the lines that follow it. */
function acceptanceBlock(
  lines: readonly string[],
  fenced: readonly boolean[],
  start: number,
): { text: string; end: number } {
  const first = boldLabel(lines[start]);
  const parts = first?.tail ? [first.tail] : [];
  let j = start + 1;
  // A label alone on its line may be followed by one blank line, then a list.
  if (!first?.tail && j + 1 < lines.length && blankLine(lines[j]) && LIST_LINE.test(lines[j + 1]))
    j += 1;
  while (
    j < lines.length &&
    !blankLine(lines[j]) &&
    !fenced[j] &&
    !boldLabel(lines[j]) &&
    !RULE_LINE.test(lines[j]) &&
    !ATX_HEADING.test(lines[j])
  ) {
    parts.push(lines[j].trimEnd());
    j += 1;
  }
  return { text: parts.join("\n").trim(), end: j };
}

/** Moves `**Acceptance:**` blocks out of a task body. */
function pullAcceptance(body: string): { body: string; acceptance: string } {
  if (!body) return { body, acceptance: "" };
  const lines = body.split("\n");
  const fenced = fencedLines(lines);
  const kept: string[] = [];
  const found: string[] = [];
  for (let i = 0; i < lines.length; ) {
    const label = fenced[i] ? null : boldLabel(lines[i]);
    if (label && ACCEPTANCE_LABEL.test(label.label)) {
      const block = acceptanceBlock(lines, fenced, i);
      if (block.text) {
        found.push(block.text);
        i = block.end;
        continue;
      }
    }
    kept.push(lines[i]);
    i += 1;
  }
  return found.length === 0
    ? { body, acceptance: "" }
    : { body: joinBody(kept), acceptance: found.join("\n\n") };
}

type ListItem = { text: string; rest: string[] };

/** Reads one list starting at `start`; items are the entries at its first indent. */
function readList(
  lines: readonly string[],
  fenced: readonly boolean[],
  start: number,
): { items: ListItem[]; end: number } {
  const first = lines[start].match(LIST_LINE)!.groups!;
  const base = indentWidth(first.indent);
  const items: ListItem[] = [];
  let contentIndent = base + 2;
  let j = start;

  const nextContent = (from: number) => {
    let k = from;
    while (k < lines.length && blankLine(lines[k])) k += 1;
    return k;
  };

  while (j < lines.length) {
    const line = lines[j];
    if (blankLine(line)) {
      const k = nextContent(j);
      if (k >= lines.length) break;
      const next = lines[k].match(LIST_LINE)?.groups;
      const width = indentWidth(lines[k].match(/^[ \t]*/)![0]);
      const continues = next ? indentWidth(next.indent) >= base : width > base;
      if (!continues || (fenced[k] && width <= base)) break;
      items[items.length - 1]?.rest.push("");
      j += 1;
      continue;
    }
    const width = indentWidth(line.match(/^[ \t]*/)![0]);
    if (fenced[j]) {
      const opens = j === 0 || !fenced[j - 1];
      if (items.length === 0 || (opens && width <= base)) break;
      items[items.length - 1].rest.push(line.slice(Math.min(width, contentIndent)));
      j += 1;
      continue;
    }
    const entry = line.match(LIST_LINE)?.groups;
    if (entry && indentWidth(entry.indent) === base) {
      items.push({ text: entry.text.trim(), rest: [] });
      contentIndent = base + entry.marker.length + 1;
      j += 1;
      continue;
    }
    if (entry && indentWidth(entry.indent) < base) break;
    if (width > base && items.length > 0) {
      items[items.length - 1].rest.push(line.slice(Math.min(width, contentIndent)).trimEnd());
      j += 1;
      continue;
    }
    break;
  }
  // Blank lines at the end belong to whatever follows the list.
  while (items.length > 0 && items[items.length - 1].rest.at(-1) === "")
    items[items.length - 1].rest.pop();
  return { items, end: j };
}

/**
 * One list entry becomes one task. Its title is the bold lead when there is a
 * real one, else the whole first line if it fits, else its first clause. The
 * full first line goes back into the description whenever the title is shorter.
 */
function listItemToTask(item: ListItem): PlanMdTask {
  const status = readStatus(item.text);
  const text = status.title;
  const lead = text.match(/^(?:\*\*|__)(?<lead>.+?)(?:\*\*|__)/)?.groups?.lead;
  let source = text;
  if (lead && stripInlineMarkdown(lead).length >= 12) {
    source = lead.replace(/[\s:.,;—–-]+$/, "");
  } else if (text.length > TASK_TITLE_MAX) {
    const cut = [...text.matchAll(/: |\. | — |; /g)].find(
      (m) => m.index! >= 20 && m.index! <= TASK_TITLE_MAX,
    );
    if (cut) source = text.slice(0, cut.index);
  }
  const fitted = fitTitle(source, "Untitled task", TASK_TITLE_MAX);
  const firstLine = source === text ? fitted.overflow : text;
  const { description, steps } = splitDescriptionSteps(
    withOverflow(firstLine, joinBody(item.rest)),
  );
  return {
    title: fitted.title,
    description,
    steps,
    ...(status.done && { done: true }),
  };
}

/**
 * A section with prose and no sub-headings can still hold a to-do list: a bold
 * label such as `**Plan**` or `**Implementation**` with a list under it. Each
 * entry becomes a task, `**Acceptance:**` becomes their acceptance criteria,
 * and every other line stays in the note, in its original order. Returns null
 * when the section has no such list, so reference sections stay plain notes.
 */
function structureProse(raw: string): { note: string; tasks: PlanMdTask[] } | null {
  const lines = raw.split("\n");
  const fenced = fencedLines(lines);
  const consumed = lines.map(() => false);
  const tasks: PlanMdTask[] = [];
  const criteria: string[] = [];

  for (let i = 0; i < lines.length; ) {
    const label = fenced[i] ? null : boldLabel(lines[i]);
    if (!label) {
      i += 1;
      continue;
    }
    if (ACCEPTANCE_LABEL.test(label.label)) {
      const block = acceptanceBlock(lines, fenced, i);
      if (block.text) {
        criteria.push(block.text);
        for (let k = i; k < block.end; k += 1) consumed[k] = true;
        i = block.end;
        continue;
      }
    } else if (!label.tail && ACTION_LABEL.test(label.label)) {
      let k = i + 1;
      while (k < lines.length && blankLine(lines[k])) k += 1;
      if (k < lines.length && !fenced[k] && LIST_LINE.test(lines[k])) {
        const list = readList(lines, fenced, k);
        tasks.push(...list.items.map(listItemToTask));
        for (let m = i + 1; m < list.end; m += 1) consumed[m] = true;
        i = list.end;
        continue;
      }
    }
    i += 1;
  }
  if (tasks.length === 0) return null;

  const acceptance = criteria.join("\n\n");
  return {
    note: trimTrailingRules(joinBody(lines.filter((_, index) => !consumed[index]))),
    tasks: acceptance ? tasks.map((task) => ({ ...task, acceptance })) : tasks,
  };
}

function sectionToDocument(section: OutlineNode): PlanMdSection {
  const headings = section.children.filter((child) => child.kind !== "list");
  const bullets = section.children.filter((child) => child.kind === "list");
  // A section that is only a list is a list of tasks. One with prose or
  // sub-headings keeps its bullets as text, so the prose around them survives.
  const onlyList = headings.length === 0 && !section.body.trim();
  const taskNodes = onlyList ? bullets : headings;
  const textNodes = onlyList ? [] : bullets;

  const { title, overflow } = fitTitle(section.title, "Untitled section", SECTION_TITLE_MAX);

  // Prose with a bold-labelled to-do list ("**Plan**", "**Implementation**") has tasks of its own.
  const structured =
    onlyList || headings.length > 0 || !section.raw ? null : structureProse(section.raw);
  if (structured) {
    const note = withOverflow(overflow, structured.note);
    return { title, ...(note && { description: note }), tasks: structured.tasks };
  }

  // The note is the section's own text in source order: bullets, tables and labels stay where they were.
  const note =
    section.raw !== undefined && !onlyList
      ? trimTrailingRules(section.raw)
      : foldTaskDescription(section.body, textNodes);
  const description = withOverflow(overflow, note);

  return {
    title,
    ...(description && { description }),
    tasks: taskNodes.map((task) => {
      const { steps, rest } = collectSteps(task.children);
      const status = readStatus(task.title);
      const fitted = fitTitle(status.title, "Untitled task", TASK_TITLE_MAX);
      const pulled = pullAcceptance(task.body);
      return {
        title: fitted.title,
        description: withOverflow(fitted.overflow, foldTaskDescription(pulled.body, rest)),
        steps,
        ...(pulled.acceptance && { acceptance: pulled.acceptance }),
        ...((status.done || task.check === "done") && { done: true }),
      };
    }),
  };
}

function treeToDocument(
  roots: OutlineNode[],
  extra: Pick<PlanMdDocument, "title" | "preamble"> = {},
): PlanMdDocument {
  return {
    sections: roots.map(sectionToDocument),
    ...(extra.title && { title: extra.title }),
    ...(extra.preamble && { preamble: extra.preamble }),
  };
}

/**
 * True when the source is a typical design-doc shape: exactly one ATX `#`
 * title wrapping `##` chapters. Numbered outlines (`1` / `1.1`) and multi-H1
 * boards keep the older section/task mapping.
 */
function shouldPromoteDocumentTitle(source: string, roots: OutlineNode[]): boolean {
  if (roots.length !== 1) return false;
  if (roots[0].children.length === 0) return false;

  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const fenced = fencedLines(lines);
  let h1Count = 0;
  let h2Count = 0;
  for (const [index, line] of lines.entries()) {
    if (fenced[index]) continue;
    const heading = line.match(ATX_HEADING);
    if (!heading?.groups) continue;
    const depth = heading.groups.hashes.length;
    if (depth === 1) h1Count += 1;
    else if (depth === 2) h2Count += 1;
  }

  return h1Count === 1 && h2Count > 0;
}

/**
 * Drop a wrapping document-title root and promote its `##` children to
 * sections. What sat under the title (intro prose, a status table, bullets
 * before the first chapter) is returned as the document preamble.
 */
function promoteDocumentTitle(root: OutlineNode): {
  sections: OutlineNode[];
  preamble: string;
} {
  const sections = root.children.filter((child) => child.kind !== "list");
  const intro = root.children.filter((child) => child.kind === "list");
  return {
    sections,
    preamble: [root.body, intro.length > 0 ? serializeNestedList(intro) : ""]
      .filter(Boolean)
      .join("\n\n"),
  };
}

/** Parse markdown into sections / tasks (nested outline folded into descriptions). */
export function parsePlanMarkdown(source: string): PlanMdDocument {
  const trimmed = source.trim();
  if (!trimmed) return { sections: [] };
  // A document the board itself exported (or written the same way) is read back field by field.
  if (isBoardMarkdown(trimmed)) return parseBoardMarkdown(trimmed);

  const { items, preamble } = parseFlatItems(trimmed);
  if (items.length === 0) return { sections: [] };

  const minDepth = Math.min(...items.map((i) => i.depth));
  const normalized = items.map((item) => ({
    ...item,
    depth: item.depth - minDepth + 1,
  }));

  const roots = buildTree(normalized);
  if (shouldPromoteDocumentTitle(trimmed, roots)) {
    const promoted = promoteDocumentTitle(roots[0]);
    return treeToDocument(promoted.sections, {
      title: clampTitle(roots[0].title, TASK_TITLE_MAX),
      preamble: [preamble, promoted.preamble].filter(Boolean).join("\n\n"),
    });
  }

  return treeToDocument(roots, { preamble });
}

/** Parse a task description back into body + nested outline nodes. */
function unfoldDescription(description: string): { body: string; nested: OutlineNode[] } {
  if (!description.trim()) return { body: "", nested: [] };

  const lines = description.replace(/\r\n/g, "\n").split("\n");
  const fenced = fencedLines(lines);
  const bodyLines: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const heading = fenced[i] ? null : line.match(NESTED_HEADING);
    const list = fenced[i] ? null : line.match(LIST_ITEM);
    if (heading || (list?.groups && listDepth(list.groups.indent) === 1)) {
      break;
    }
    bodyLines.push(line);
    i += 1;
  }

  if (!lines.slice(i).join("\n").trim()) return { body: joinBody(bodyLines), nested: [] };

  const nestedItems: FlatItem[] = [];
  let current: FlatItem | null = null;
  for (let index = i; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = fenced[index] ? null : line.match(NESTED_HEADING);
    if (heading?.groups) {
      const depth = Math.max(1, heading.groups.hashes.length - 2);
      current = {
        depth,
        title: heading.groups.title.trim(),
        bodyLines: [],
        kind: "outline",
      };
      nestedItems.push(current);
      continue;
    }
    const list = fenced[index] ? null : line.match(LIST_ITEM);
    if (list?.groups) {
      const read = readCheck(list.groups.title.trim());
      current = {
        depth: listDepth(list.groups.indent),
        title: read.title,
        bodyLines: [],
        kind: "list",
        ...(read.check && { check: read.check }),
      };
      nestedItems.push(current);
      continue;
    }
    if (!blankLine(line)) {
      if (current) current.bodyLines.push(line);
      else bodyLines.push(line);
    } else if (current && current.bodyLines.length > 0) {
      current.bodyLines.push("");
    }
  }

  if (nestedItems.length === 0) {
    return { body: joinBody(bodyLines), nested: [] };
  }

  const minDepth = Math.min(...nestedItems.map((n) => n.depth));
  const normalized = nestedItems.map((n) => ({
    ...n,
    depth: n.depth - minDepth + 1,
  }));

  return {
    body: joinBody(bodyLines),
    nested: buildTree(normalized),
  };
}

export type TaskOutlineNode = {
  title: string;
  body: string;
  children: TaskOutlineNode[];
};

export function readTaskOutline(description: string | null | undefined): {
  body: string;
  nested: TaskOutlineNode[];
} {
  const { body, nested } = unfoldDescription(description ?? "");
  const plain = (nodes: OutlineNode[]): TaskOutlineNode[] =>
    nodes.map((node) => ({ title: node.title, body: node.body, children: plain(node.children) }));
  return { body, nested: plain(nested) };
}

function emitNumbered(nodes: OutlineNode[], prefix: string, lines: string[]) {
  nodes.forEach((node, index) => {
    const key = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
    lines.push(
      `${key} ${node.check ? `[${node.check === "done" ? "x" : " "}] ` : ""}${node.title}`,
    );
    if (node.body) {
      lines.push(node.body);
    }
    if (node.children.length > 0) {
      emitNumbered(node.children, key, lines);
    }
    if (!prefix) {
      lines.push("");
    }
  });
}

/** Serialize a plan document to the canonical numbered outline. */
export function serializePlanMarkdown(doc: PlanMdDocument): string {
  const roots: OutlineNode[] = doc.sections.map((section) => ({
    title: section.title,
    body: section.description ?? "",
    children: section.tasks.map((task) => {
      const { body, nested } = unfoldDescription(task.description ?? "");
      const checklist = stepsToMarkdown(task.steps ?? []);
      const acceptance = task.acceptance?.trim() ? `**Acceptance:** ${task.acceptance.trim()}` : "";
      return {
        title: task.title,
        body: [body, checklist, acceptance].filter(Boolean).join("\n"),
        children: nested,
        ...(task.done && { check: "done" as const }),
      };
    }),
  }));

  const lines: string[] = [];
  if (doc.preamble?.trim()) lines.push(doc.preamble.trim(), "");
  emitNumbered(roots, "", lines);
  return (
    lines
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim() + "\n"
  ).replace(/^\n+/, "");
}

/** Build a preview tree (including nested titles) for the import dialog. */
export function planMarkdownPreview(doc: PlanMdDocument): PlanMdPreviewNode[] {
  return doc.sections.map((section) => ({
    title: section.title,
    children: section.tasks.map((task) => {
      const { nested } = unfoldDescription(task.description ?? "");
      const nestedPreview = (nodes: OutlineNode[]): PlanMdPreviewNode[] =>
        nodes.map((n) => ({
          title: n.title,
          children: nestedPreview(n.children),
        }));
      const stepPreview: PlanMdPreviewNode[] = (task.steps ?? []).map((step) => ({
        title: step.text,
        children: [],
        step: { done: step.done },
      }));
      const featurePreview: PlanMdPreviewNode[] = (task.features ?? []).map((feature) => ({
        title: feature.text,
        children: [],
        feature: { met: feature.met },
      }));
      const questionPreview: PlanMdPreviewNode[] = (task.questions ?? []).map((question) => ({
        title: question.body,
        children: [],
        question: { status: question.status, blocking: question.blocking },
      }));
      return {
        title: task.title,
        children: [...featurePreview, ...questionPreview, ...stepPreview, ...nestedPreview(nested)],
      };
    }),
  }));
}

/** Filename-safe slug for export downloads. */
export function planMarkdownFilename(title: string): string {
  const base =
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "plan";
  return `${base}.md`;
}

/** Summarize counts for toasts / empty states. */
export function planMarkdownStats(doc: PlanMdDocument): {
  sections: number;
  tasks: number;
} {
  return {
    sections: doc.sections.length,
    tasks: doc.sections.reduce((n, s) => n + s.tasks.length, 0),
  };
}

/** Number of checklist steps across the document, for the import summary. */
export function planMarkdownStepCount(doc: PlanMdDocument): number {
  return doc.sections.reduce(
    (n, section) => n + section.tasks.reduce((m, task) => m + (task.steps?.length ?? 0), 0),
    0,
  );
}

/** What a board-format document carries beyond sections and tasks, for the import summary. */
export type PlanMdCounts = {
  features: number;
  questions: number;
  /** Questions still waiting for an answer, and how many of those block their task. */
  openQuestions: number;
  blockingQuestions: number;
  /** Distinct tags across sections and tasks. */
  tags: number;
};

export function planMarkdownCounts(doc: PlanMdDocument): PlanMdCounts {
  const counts: PlanMdCounts = {
    features: 0,
    questions: 0,
    openQuestions: 0,
    blockingQuestions: 0,
    tags: 0,
  };
  const tags = new Set<string>();
  for (const section of doc.sections) {
    for (const tag of section.tags ?? []) tags.add(tag);
    for (const task of section.tasks) {
      for (const tag of task.tags ?? []) tags.add(tag);
      counts.features += task.features?.length ?? 0;
      for (const question of task.questions ?? []) {
        counts.questions += 1;
        if (question.status === "open") {
          counts.openQuestions += 1;
          if (question.blocking) counts.blockingQuestions += 1;
        }
      }
    }
  }
  counts.tags = tags.size;
  return counts;
}

/** `- [ ] text` lines, two spaces of indent per level. */
export function stepsToMarkdown(steps: readonly PlanMdStep[]): string {
  return steps
    .filter((step) => step.text.trim().length > 0)
    .map((step) => {
      const depth = Math.max(0, Math.min(MAX_STEP_DEPTH, Math.round(step.depth)));
      return `${"  ".repeat(depth)}- [${step.done ? "x" : " "}] ${step.text.trim()}`;
    })
    .join("\n");
}

function indentDepth(indent: string): number {
  const spaces = indent.replace(/\t/g, "  ").length;
  return Math.min(MAX_STEP_DEPTH, Math.floor(spaces / 2));
}

/**
 * Pulls checklist lines out of free text. Returns the steps and what is left
 * of the text. With `plainLists`, ordinary `-` / `1.` list items count too,
 * which is how an old description full of nested bullets becomes a checklist.
 */
export function splitDescriptionSteps(
  description: string | null | undefined,
  options: { plainLists?: boolean } = {},
): { description: string; steps: PlanMdStep[] } {
  const steps: PlanMdStep[] = [];
  const kept: string[] = [];

  for (const line of (description ?? "").replace(/\r\n/g, "\n").split("\n")) {
    const check = line.match(CHECKLIST_LINE);
    if (check?.groups) {
      steps.push({
        text: collapseSpaces(check.groups.text).slice(0, STEP_TEXT_MAX),
        done: check.groups.mark !== " ",
        depth: indentDepth(check.groups.indent),
      });
      continue;
    }
    if (options.plainLists) {
      const plain = line.match(PLAIN_LIST_LINE);
      if (plain?.groups) {
        steps.push({
          text: collapseSpaces(plain.groups.text).slice(0, STEP_TEXT_MAX),
          done: false,
          depth: indentDepth(plain.groups.indent),
        });
        continue;
      }
    }
    kept.push(line);
  }

  return { description: joinBody(kept), steps };
}

/** Steps written as a checklist in `text`. */
export function parseChecklist(text: string): PlanMdStep[] {
  return splitDescriptionSteps(text).steps;
}

/**
 * A step may only sit one level under the step above it, so the list always
 * reads as a tree. Returns the depth to store.
 */
export function clampStepDepth(
  steps: ReadonlyArray<{ depth: number }>,
  index: number,
  wanted: number,
): number {
  const previous = index > 0 ? steps[index - 1].depth : -1;
  return Math.max(0, Math.min(MAX_STEP_DEPTH, wanted, previous + 1));
}

/** `done / total`, plus a whole-number percent for the bar. */
export function stepsProgress(steps: ReadonlyArray<{ done: boolean }>): {
  done: number;
  total: number;
  percent: number;
} {
  const done = steps.filter((step) => step.done).length;
  return {
    done,
    total: steps.length,
    percent: steps.length === 0 ? 0 : Math.round((done / steps.length) * 100),
  };
}

/** Lowercased text with markdown punctuation removed, for comparing lines. */
function plainText(text: string): string {
  return text
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/^#+\s+/, "")
    .replace(/[✅☑✔]\uFE0F?/gu, "")
    .replace(/[*_`~\\]/g, "")
    .replace(/[|>#]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Checks that the parsed document still holds the source. Every non-blank
 * source line must appear, ignoring markdown punctuation, in the title,
 * preamble, section text, task text or steps. Returns the lines that do not,
 * so an import can say so instead of silently losing them.
 */
export function planMarkdownCoverage(
  source: string,
  doc: PlanMdDocument,
): { lines: number; missing: string[] } {
  const kept = plainText(
    [
      doc.title,
      doc.preamble,
      doc.plan?.description,
      ...(doc.structural ?? []),
      ...doc.sections.flatMap((section) => [
        section.title,
        section.description,
        section.goals,
        section.intentions,
        ...section.tasks.flatMap((task) => [
          task.title,
          task.description,
          task.acceptance ? `Acceptance: ${task.acceptance}` : "",
          task.context,
          ...(task.steps ?? []).map((step) => step.text),
          ...(task.features ?? []).map((feature) => feature.text),
          ...(task.questions ?? []).flatMap((question) => [question.body, question.answer]),
        ]),
      ]),
    ]
      .filter(Boolean)
      .join("\n"),
  );

  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const fenced = fencedLines(lines);
  let counted = 0;
  const missing: string[] = [];
  for (const [index, line] of lines.entries()) {
    if (blankLine(line)) continue;
    if (FENCE.test(line) && fenced[index]) continue;
    // A table's divider row (| --- | :-: |) has no words to look for.
    if (/^[\s|:-]+$/.test(line)) continue;
    const text = plainText(line);
    if (!text) continue;
    counted += 1;
    if (!kept.includes(text)) missing.push(line.trim());
  }
  return { lines: counted, missing };
}
