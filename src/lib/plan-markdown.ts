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

/** One line of a task's checklist. `depth` is 0 for a top-level step. */
export type PlanMdStep = {
  text: string;
  done: boolean;
  depth: number;
};

export type PlanMdTask = {
  title: string;
  /** Body paragraphs plus nested outline folded as a markdown list. */
  description: string;
  /** `- [ ]` / `- [x]` lines under the task. Stored as plan_task_steps. */
  steps?: PlanMdStep[];
};

export type PlanMdSection = {
  title: string;
  /** Prose, tables and bullets under the section heading (before its tasks). */
  description?: string;
  tasks: PlanMdTask[];
};

export type PlanMdDocument = {
  sections: PlanMdSection[];
  /** A wrapping `#` document title, when one was promoted away. */
  title?: string;
  /** Text above the first section (a title's intro, a status table, …). */
  preamble?: string;
};

/** Preview tree for the import dialog (sections → tasks → nested titles). */
export type PlanMdPreviewNode = {
  title: string;
  children: PlanMdPreviewNode[];
  /** Set on checklist lines so the dialog can draw a box. */
  step?: { done: boolean };
};

type CheckState = "open" | "done";

/** `list` items are bullets; `outline` items are headings or numbered keys. */
type ItemKind = "outline" | "list";

type OutlineNode = {
  title: string;
  body: string;
  children: OutlineNode[];
  check?: CheckState;
  kind?: ItemKind;
};

type FlatItem = {
  depth: number;
  title: string;
  bodyLines: string[];
  check?: CheckState;
  kind: ItemKind;
};

/** Opening or closing line of a fenced code block, at any indentation. */
const FENCE = /^[ \t]*(?<mark>`{3,}|~{3,})/;

/**
 * Marks every line that sits inside a fenced code block, delimiters included.
 * Those lines are body text and never headings, numbered keys or list items.
 */
function fencedLines(lines: readonly string[]): boolean[] {
  const mask: boolean[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const mark = line.match(FENCE)?.groups?.mark;
    if (open === null) {
      mask.push(Boolean(mark));
      if (mark) open = mark;
    } else {
      mask.push(true);
      if (mark && mark[0] === open[0] && mark.length >= open.length) open = null;
    }
  }
  return mask;
}

export const MAX_STEP_DEPTH = 3;
export const STEP_TEXT_MAX = 500;

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

function blankLine(line: string): boolean {
  return line.trim().length === 0;
}

function joinBody(lines: string[]): string {
  return lines
    .join("\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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

  for (const [index, line] of lines.entries()) {
    if (fenced[index]) {
      pushBody(line);
      continue;
    }
    const outline = classifyOutlineLine(line, { atxOnly });
    if (outline) {
      current = { depth: outline.depth, title: outline.title, bodyLines: [], kind: "outline" };
      items.push(current);
      lastStructuralDepth = outline.depth;
      continue;
    }

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

/** Step text keeps its inline markdown (it is rendered as text, not a title). */
function collapseSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trim();
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

function sectionToDocument(section: OutlineNode): PlanMdSection {
  const headings = section.children.filter((child) => child.kind !== "list");
  const bullets = section.children.filter((child) => child.kind === "list");
  // A section that is only a list is a list of tasks. One with prose or
  // sub-headings keeps its bullets as text, so the prose around them survives.
  const onlyList = headings.length === 0 && !section.body.trim();
  const taskNodes = onlyList ? bullets : headings;
  const textNodes = onlyList ? [] : bullets;

  const { title, overflow } = fitTitle(section.title, "Untitled section", SECTION_TITLE_MAX);
  const description = withOverflow(overflow, foldTaskDescription(section.body, textNodes));

  return {
    title,
    ...(description && { description }),
    tasks: taskNodes.map((task) => {
      const { steps, rest } = collectSteps(task.children);
      const fitted = fitTitle(task.title, "Untitled task", TASK_TITLE_MAX);
      return {
        title: fitted.title,
        description: withOverflow(fitted.overflow, foldTaskDescription(task.body, rest)),
        steps,
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
      return {
        title: task.title,
        body: [body, checklist].filter(Boolean).join("\n"),
        children: nested,
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
      return {
        title: task.title,
        children: [...stepPreview, ...nestedPreview(nested)],
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
    .replace(/^[ \t]*(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?/, "")
    .replace(/^#+\s+/, "")
    .replace(/[*_`|>~\\#]/g, " ")
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
      ...doc.sections.flatMap((section) => [
        section.title,
        section.description,
        ...section.tasks.flatMap((task) => [
          task.title,
          task.description,
          ...(task.steps ?? []).map((step) => step.text),
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
