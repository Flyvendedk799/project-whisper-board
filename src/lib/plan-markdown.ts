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
 * promoted away so chapters become sections (typical design-doc shape).
 * Outline keys are stripped from stored titles and regenerated on export.
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
  tasks: PlanMdTask[];
};

export type PlanMdDocument = {
  sections: PlanMdSection[];
};

/** Preview tree for the import dialog (sections → tasks → nested titles). */
export type PlanMdPreviewNode = {
  title: string;
  children: PlanMdPreviewNode[];
  /** Set on checklist lines so the dialog can draw a box. */
  step?: { done: boolean };
};

type CheckState = "open" | "done";

type OutlineNode = {
  title: string;
  body: string;
  children: OutlineNode[];
  check?: CheckState;
};

type FlatItem = {
  depth: number;
  title: string;
  bodyLines: string[];
  check?: CheckState;
};

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
function documentHasAtxHeadings(lines: string[]): boolean {
  return lines.some((line) => ATX_HEADING.test(line));
}

/**
 * True when the document is a nested-list outline (no numbered keys / ATX
 * headings). Top-level list items become sections.
 */
function isListOutlineDocument(lines: string[]): boolean {
  let sawList = false;
  for (const line of lines) {
    if (blankLine(line)) continue;
    if (classifyOutlineLine(line)) return false;
    if (LIST_ITEM.test(line)) {
      sawList = true;
      continue;
    }
    if (!sawList) return false;
  }
  return sawList;
}

function parseFlatItems(source: string): FlatItem[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const items: FlatItem[] = [];
  let current: FlatItem | null = null;
  /** Depth of the most recent numbered/heading outline item (not a list). */
  let lastStructuralDepth = 0;
  /**
   * Design docs with `#` / `##` often contain prose that starts with a number
   * (`2400 is four…`) and ordered lists (`1. …`). Skip numbered-outline keys
   * there so only ATX headings structure the tree; pure `1` / `1.1` outlines
   * still use the tightened numbered grammar.
   */
  const atxOnly = documentHasAtxHeadings(lines);

  const pushBody = (text: string) => {
    if (!current) return;
    current.bodyLines.push(text);
  };

  if (isListOutlineDocument(lines)) {
    for (const line of lines) {
      const list = line.match(LIST_ITEM);
      if (list?.groups) {
        const read = readCheck(list.groups.title.trim());
        current = {
          depth: listDepth(list.groups.indent),
          title: read.title,
          bodyLines: [],
          ...(read.check && { check: read.check }),
        };
        items.push(current);
        continue;
      }
      if (!blankLine(line)) pushBody(line);
      else if (current && current.bodyLines.length > 0) pushBody("");
    }
    return items;
  }

  for (const line of lines) {
    const outline = classifyOutlineLine(line, { atxOnly });
    if (outline) {
      current = { depth: outline.depth, title: outline.title, bodyLines: [] };
      items.push(current);
      lastStructuralDepth = outline.depth;
      continue;
    }

    // List items under a structural outline become deeper nodes.
    const list = line.match(LIST_ITEM);
    if (list?.groups && lastStructuralDepth > 0) {
      const depth = lastStructuralDepth + listDepth(list.groups.indent);
      const read = readCheck(list.groups.title.trim());
      current = {
        depth,
        title: read.title,
        bodyLines: [],
        ...(read.check && { check: read.check }),
      };
      items.push(current);
      continue;
    }

    if (!blankLine(line)) pushBody(line);
    else if (current && current.bodyLines.length > 0) pushBody("");
  }

  return items;
}

function buildTree(items: FlatItem[]): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: { depth: number; node: OutlineNode }[] = [];

  for (const item of items) {
    const node: OutlineNode = {
      title: item.title,
      body: joinBody(item.bodyLines),
      children: [],
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

function treeToDocument(roots: OutlineNode[]): PlanMdDocument {
  if (roots.length === 0) return { sections: [] };

  return {
    sections: roots.map((section) => ({
      title: clampTitle(section.title || "Untitled section", SECTION_TITLE_MAX),
      tasks: section.children.map((task) => {
        const { steps, rest } = collectSteps(task.children);
        return {
          title: clampTitle(task.title || "Untitled task", TASK_TITLE_MAX),
          description: foldTaskDescription(task.body, rest),
          steps,
        };
      }),
    })),
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

  let h1Count = 0;
  let h2Count = 0;
  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    const heading = line.match(ATX_HEADING);
    if (!heading?.groups) continue;
    const depth = heading.groups.hashes.length;
    if (depth === 1) h1Count += 1;
    else if (depth === 2) h2Count += 1;
  }

  return h1Count === 1 && h2Count > 0;
}

/**
 * Drop a wrapping document-title root and promote its children to sections.
 * Title-level body is discarded (not turned into a fake section/task).
 */
function promoteDocumentTitle(roots: OutlineNode[]): OutlineNode[] {
  if (roots.length !== 1) return roots;
  return roots[0].children;
}

/** Parse markdown into sections / tasks (nested outline folded into descriptions). */
export function parsePlanMarkdown(source: string): PlanMdDocument {
  const trimmed = source.trim();
  if (!trimmed) return { sections: [] };

  const items = parseFlatItems(trimmed);
  if (items.length === 0) return { sections: [] };

  const minDepth = Math.min(...items.map((i) => i.depth));
  const normalized = items.map((item) => ({
    ...item,
    depth: item.depth - minDepth + 1,
  }));

  let roots = buildTree(normalized);
  if (shouldPromoteDocumentTitle(trimmed, roots)) {
    roots = promoteDocumentTitle(roots);
  }

  return treeToDocument(roots);
}

/** Parse a task description back into body + nested outline nodes. */
function unfoldDescription(description: string): { body: string; nested: OutlineNode[] } {
  if (!description.trim()) return { body: "", nested: [] };

  const lines = description.replace(/\r\n/g, "\n").split("\n");
  const bodyLines: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const heading = line.match(NESTED_HEADING);
    const list = line.match(LIST_ITEM);
    if (heading || (list?.groups && listDepth(list.groups.indent) === 1)) {
      break;
    }
    bodyLines.push(line);
    i += 1;
  }

  const rest = lines.slice(i).join("\n").trim();
  if (!rest) return { body: joinBody(bodyLines), nested: [] };

  const nestedItems: FlatItem[] = [];
  let current: FlatItem | null = null;
  for (const line of rest.split("\n")) {
    const heading = line.match(NESTED_HEADING);
    if (heading?.groups) {
      const depth = Math.max(1, heading.groups.hashes.length - 2);
      current = {
        depth,
        title: heading.groups.title.trim(),
        bodyLines: [],
      };
      nestedItems.push(current);
      continue;
    }
    const list = line.match(LIST_ITEM);
    if (list?.groups) {
      const read = readCheck(list.groups.title.trim());
      current = {
        depth: listDepth(list.groups.indent),
        title: read.title,
        bodyLines: [],
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
  return unfoldDescription(description ?? "");
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
    body: "",
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
