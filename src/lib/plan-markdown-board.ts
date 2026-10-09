/**
 * The board's own Markdown: what "Export" writes and what "Import" reads back
 * field by field. It is plain GitHub-flavoured Markdown that reads well
 * rendered and as text:
 *
 *   # Plan title
 *
 *   > **Status:** Active · **Repo:** `acme/app` · **Base:** `main` · **Branch:** `plan/q4` (new branch)
 *   >
 *   > **Plan ID:** `…` · **Exported:** 2026-10-02
 *
 *   Plan description.
 *
 *   ## Section
 *
 *   > **Tags:** `api` · **Colour:** Blue `#3b82f6` · **ID:** `…`
 *
 *   Section description.
 *
 *   **Goals** / **Intentions** / **Client summary**
 *
 *   ### Task
 *
 *   > **Status:** In progress · **Priority:** High · **Size:** Medium · **Tags:** `auth` · **ID:** `…`
 *
 *   The brief.
 *
 *   **Client title** / **Client summary**   plain Danish, what clients read
 *   **Features**         1. [x] numbered, ticked when met
 *   **Sub-steps**        - [ ] checklist, two spaces per level, `→ feature 2` links a step
 *   **Acceptance**       free text
 *   <details> Technical context </details>
 *   **Questions**        - **Open · blocking** — text, with an indented `> **Answer:** …`
 *
 * Empty parts are left out. A document is read as this format when it carries
 * the `<!-- boared:plan-export -->` marker, or when a heading is followed by a
 * meta row of two or more known keys; every other document goes through the
 * legacy outline parser in `plan-markdown`, exactly as before.
 *
 * Nothing is dropped: a meta value that cannot be understood stays in the text
 * above it, lines that were read as structure are listed in `doc.structural`,
 * and `planMarkdownCoverage` checks the rest.
 */
import type {
  PlanStatus,
  PlanTaskComplexity,
  PlanTaskPriority,
  PlanTaskStatus,
} from "@/data/enums";
import {
  COLOR_PALETTE,
  FEATURE_TEXT_MAX,
  isValidBranchName,
  isValidColor,
  MAX_FEATURES,
  normalizeTags,
  QUESTION_ANSWER_MAX,
  QUESTION_BODY_MAX,
  type WorkMode,
} from "@/lib/plan-fields";
import {
  blankLine,
  collapseSpaces,
  fencedLines,
  joinBody,
  MAX_STEP_DEPTH,
  STEP_TEXT_MAX,
} from "@/lib/plan-markdown-text";
import type {
  PlanMdDocument,
  PlanMdFeature,
  PlanMdQuestion,
  PlanMdSection,
  PlanMdSettings,
  PlanMdStep,
  PlanMdTask,
} from "@/lib/plan-markdown";

export const BOARD_MARKER = "<!-- boared:plan-export v1 -->";
const MARKER_LINE = /^[ \t]*<!--\s*boared:plan-export\b.*-->[ \t]*$/i;

const SECTION_TITLE_MAX = 100;
const TASK_TITLE_MAX = 200;
const CONTEXT_MAX = 20000;
const CLIENT_SUMMARY_MAX = 1000;

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const TASK_STATUS_LABEL: Record<PlanTaskStatus, string> = {
  backlog: "Backlog",
  available: "Available",
  claimed: "Claimed",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  blocked: "Blocked",
};
const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  archived: "Archived",
};
const PRIORITY_LABEL: Record<PlanTaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};
const SIZE_LABEL: Record<PlanTaskComplexity, string> = {
  trivial: "Trivial",
  small: "Small",
  medium: "Medium",
  large: "Large",
  epic: "Epic",
};

/** `"In progress"` / `"in_progress"` / `"in-progress"` all read the same. */
const wordKey = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[_\s-]+/g, " ");

function lookup<T extends string>(labels: Record<T, string>, text: string): T | undefined {
  const key = wordKey(text.replace(/[`*]/g, ""));
  return (Object.keys(labels) as T[]).find(
    (value) => wordKey(value) === key || wordKey(labels[value]) === key,
  );
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const code = (text: string) => (text.includes("`") ? `\`\` ${text} \`\`` : `\`${text}\``);

/** `Blue `#3b82f6`` for a palette colour, the bare value otherwise. */
function colourText(value: string): string {
  const named = COLOR_PALETTE.find((entry) => entry.value.toLowerCase() === value.toLowerCase());
  return named ? `${named.label} ${code(value)}` : code(value);
}

function branchText(mode: WorkMode, branch: string | undefined): string | undefined {
  if (mode === "base") return "directly on the base branch";
  if (!branch) return undefined;
  return `${code(branch)} (${mode === "new" ? "new" : "existing"} branch)`;
}

/** `> **Key:** value · **Key:** value`, or nothing when no value is set. */
function metaRow(pairs: ReadonlyArray<readonly [string, string | undefined]>): string[] {
  const parts = pairs.filter((pair): pair is [string, string] => Boolean(pair[1]?.trim()));
  if (parts.length === 0) return [];
  return [`> ${parts.map(([key, value]) => `**${key}:** ${oneLine(value)}`).join(" · ")}`];
}

/**
 * Free text goes under `##` and `###` headings, so a heading inside it would
 * start a section or a task when the file is read back. Pull those down to `####`.
 */
function demoteHeadings(text: string): string {
  const lines = text.split("\n");
  const fenced = fencedLines(lines);
  return lines
    .map((line, index) => {
      const heading = fenced[index] ? null : line.match(/^(?<hashes>#{1,3})(?=[ \t])/);
      return heading?.groups ? `####${line.slice(heading.groups.hashes.length)}` : line;
    })
    .join("\n");
}

const prose = (text: string | undefined) => (text?.trim() ? demoteHeadings(text.trim()) : "");

function stepLines(steps: readonly PlanMdStep[], featureCount: number): string {
  return steps
    .filter((step) => step.text.trim())
    .map((step) => {
      const depth = Math.max(0, Math.min(MAX_STEP_DEPTH, Math.round(step.depth)));
      const link =
        step.feature && step.feature >= 1 && step.feature <= featureCount
          ? ` → feature ${step.feature}`
          : "";
      return `${"  ".repeat(depth)}- [${step.done ? "x" : " "}] ${oneLine(step.text)}${link}`;
    })
    .join("\n");
}

function featureLines(features: readonly PlanMdFeature[]): string {
  return features
    .filter((feature) => feature.text.trim())
    .map((feature, index) => `${index + 1}. [${feature.met ? "x" : " "}] ${oneLine(feature.text)}`)
    .join("\n");
}

function questionLines(questions: readonly PlanMdQuestion[]): string {
  const indent = (text: string, prefix: string) =>
    text
      .split("\n")
      .map((line) => `  ${prefix}${line}`.trimEnd())
      .join("\n");
  return questions
    .filter((question) => question.body.trim())
    .map((question) => {
      const tag = `${question.status[0].toUpperCase()}${question.status.slice(1)}${
        question.blocking ? " · blocking" : ""
      }`;
      const [first, ...rest] = question.body.trim().split("\n");
      const lines = [`- **${tag}** — ${first.trim()}`];
      if (rest.length > 0) lines.push(indent(rest.join("\n"), ""));
      if (question.answer?.trim()) {
        const answer = question.answer.trim().split("\n");
        lines.push(indent(`**Answer:** ${answer[0]}`, "> "));
        if (answer.length > 1) lines.push(indent(answer.slice(1).join("\n"), "> "));
      }
      return lines.join("\n");
    })
    .join("\n");
}

function writeTask(task: PlanMdTask): string[] {
  const features = task.features ?? [];
  const blocks: string[] = [`### ${oneLine(task.title) || "Untitled task"}`];
  const status = task.status ?? (task.done ? "done" : "available");
  blocks.push(
    ...metaRow([
      ["Status", TASK_STATUS_LABEL[status]],
      ["Priority", task.priority ? PRIORITY_LABEL[task.priority] : undefined],
      ["Size", task.size ? SIZE_LABEL[task.size] : undefined],
      ["Tags", task.tags?.length ? task.tags.map(code).join(" ") : undefined],
      ["Assignee", task.assignee],
      ["Colour", task.color ? colourText(task.color) : undefined],
      ["ID", task.id ? code(task.id) : undefined],
    ]),
  );
  const content: string[] = [];
  if (task.description.trim()) content.push(prose(task.description));
  if (task.clientTitle?.trim())
    content.push(`**Client title**

${oneLine(task.clientTitle)}`);
  if (task.clientSummary?.trim()) {
    content.push(`**Client summary**

${prose(task.clientSummary)}`);
  }
  if (features.length > 0) content.push(`**Features**\n\n${featureLines(features)}`);
  if (task.steps?.some((step) => step.text.trim())) {
    content.push(`**Sub-steps**\n\n${stepLines(task.steps, features.length)}`);
  }
  if (task.acceptance?.trim()) content.push(`**Acceptance**\n\n${task.acceptance.trim()}`);
  if (task.context?.trim()) {
    content.push(
      `<details>\n<summary>Technical context</summary>\n\n${task.context.trim()}\n\n</details>`,
    );
  }
  if (task.questions?.some((question) => question.body.trim())) {
    content.push(`**Questions**\n\n${questionLines(task.questions)}`);
  }
  // The meta row sits directly under the heading; everything else is a block of its own.
  return [blocks.join("\n\n"), ...content];
}

function writeSection(section: PlanMdSection): string[] {
  const head = [`## ${oneLine(section.title) || "Untitled section"}`];
  head.push(
    ...metaRow([
      ["Tags", section.tags?.length ? section.tags.map(code).join(" ") : undefined],
      ["Colour", section.color ? colourText(section.color) : undefined],
      ["ID", section.id ? code(section.id) : undefined],
    ]),
  );
  const blocks = [head.join("\n\n")];
  if (section.description?.trim()) blocks.push(prose(section.description));
  if (section.goals?.trim()) blocks.push(`**Goals**\n\n${prose(section.goals)}`);
  if (section.intentions?.trim()) blocks.push(`**Intentions**\n\n${prose(section.intentions)}`);
  if (section.clientSummary?.trim()) {
    blocks.push(`**Client summary**\n\n${prose(section.clientSummary)}`);
  }
  for (const task of section.tasks) blocks.push(...writeTask(task));
  return blocks;
}

/**
 * Writes a plan as the board's Markdown: a title, a header row, then a `##`
 * per section and a `###` per task, with the brief, features, sub-steps,
 * acceptance, technical context and questions under each task.
 */
export function serializeBoardMarkdown(doc: PlanMdDocument): string {
  const plan = doc.plan ?? {};
  const blocks: string[] = [BOARD_MARKER, `# ${oneLine(doc.title ?? "") || "Untitled plan"}`];

  const where = metaRow([
    ["Status", plan.status ? PLAN_STATUS_LABEL[plan.status] : undefined],
    ["Repo", plan.repo ? code(plan.repo) : undefined],
    ["Base", plan.base ? code(plan.base) : undefined],
    ["Branch", plan.workMode ? branchText(plan.workMode, plan.workBranch) : undefined],
  ]);
  const identity = metaRow([
    ["Plan ID", plan.id ? code(plan.id) : undefined],
    ["Exported", plan.exportedAt],
  ]);
  if (where.length > 0 || identity.length > 0) {
    blocks.push(
      [...where, ...(where.length > 0 && identity.length > 0 ? [">"] : []), ...identity].join("\n"),
    );
  }
  if (plan.description?.trim()) blocks.push(prose(plan.description));
  if (doc.preamble?.trim()) blocks.push(prose(doc.preamble));
  for (const section of doc.sections) blocks.push(...writeSection(section));

  return `${blocks.join("\n\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

type Kind = "plan" | "section" | "task";

const META_KEYS: Record<Kind, readonly string[]> = {
  plan: ["status", "repo", "base", "branch", "plan id", "id", "exported"],
  section: ["tags", "colour", "id"],
  task: ["status", "priority", "size", "tags", "assignee", "colour", "id"],
};

/** Words people also write for a key. */
const KEY_ALIAS: Record<string, string> = {
  color: "colour",
  "working branch": "branch",
  "work branch": "branch",
  complexity: "size",
  labels: "tags",
  "task id": "id",
  "section id": "id",
};

/** `**Key:** value` or `**Key**: value`. */
const META_SEGMENT = /^\*\*(?<key>[^*:]{2,24}?)(?::\*\*|\*\*:)[ \t]*(?<value>.*)$/;

type MetaSegment = { key: string; value: string };

/** The segments of one meta paragraph, or null when any of them is not a known `**Key:** value`. */
function readMetaParagraph(text: string, kind: Kind): MetaSegment[] | null {
  const segments: MetaSegment[] = [];
  for (const part of text.split(/\s+·\s+/)) {
    const match = part.trim().match(META_SEGMENT);
    if (!match?.groups) return null;
    const raw = wordKey(match.groups.key);
    const key = KEY_ALIAS[raw] ?? raw;
    if (!META_KEYS[kind].includes(key)) return null;
    segments.push({ key, value: match.groups.value.trim() });
  }
  return segments.length > 0 ? segments : null;
}

/** Consecutive `>` lines starting at `from`: their paragraphs (unquoted, joined) and where they end. */
function readQuote(
  lines: readonly string[],
  fenced: readonly boolean[],
  from: number,
): { paragraphs: string[]; end: number } {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let end = from;
  while (end < lines.length && !fenced[end] && /^[ \t]*>/.test(lines[end])) {
    const text = lines[end].replace(/^[ \t]*>[ \t]?/, "").trim();
    if (text) current.push(text);
    else if (current.length > 0) {
      paragraphs.push(current.join(" "));
      current = [];
    }
    end += 1;
  }
  if (current.length > 0) paragraphs.push(current.join(" "));
  return { paragraphs, end };
}

function nextContent(lines: readonly string[], from: number, to = lines.length): number {
  let at = from;
  while (at < to && blankLine(lines[at])) at += 1;
  return at;
}

const HEADING = /^(?<hashes>#{1,6})[ \t]+(?<title>\S.*?)(?:[ \t]+#+)?[ \t]*$/;

/** True for text the board wrote, or wrote the same way by hand. */
export function isBoardMarkdown(source: string): boolean {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const fenced = fencedLines(lines);
  if (lines.some((line, index) => !fenced[index] && MARKER_LINE.test(line))) return true;

  for (const [index, line] of lines.entries()) {
    const heading = fenced[index] ? null : line.match(HEADING);
    if (!heading?.groups || heading.groups.hashes.length > 3) continue;
    const at = nextContent(lines, index + 1);
    if (at >= lines.length || fenced[at] || !/^[ \t]*>/.test(lines[at])) continue;
    const kind: Kind = (["plan", "section", "task"] as const)[heading.groups.hashes.length - 1];
    const quote = readQuote(lines, fenced, at);
    const paragraphs = quote.paragraphs.map((paragraph) => readMetaParagraph(paragraph, kind));
    if (paragraphs.length > 0 && paragraphs.every(Boolean)) {
      if (paragraphs.reduce((n, segments) => n + (segments?.length ?? 0), 0) >= 2) return true;
    }
  }
  return false;
}

/** Bold label on a line of its own, or followed by text: `**Features**`, `**Acceptance:** text`. */
const LABEL_LINE = /^\*\*(?<label>[^*]{2,40}?)\*\*[ \t]*(?<colon>:?)[ \t]*(?<tail>.*)$/;

type BlockName =
  | "text"
  | "goals"
  | "intentions"
  | "clientSummary"
  | "clientTitle"
  | "features"
  | "steps"
  | "acceptance"
  | "context"
  | "questions";

const BLOCK_LABELS: Record<Kind, Record<string, BlockName>> = {
  plan: {},
  section: { goals: "goals", intentions: "intentions", "client summary": "clientSummary" },
  task: {
    "client title": "clientTitle",
    "client summary": "clientSummary",
    features: "features",
    requirements: "features",
    "sub steps": "steps",
    substeps: "steps",
    steps: "steps",
    checklist: "steps",
    acceptance: "acceptance",
    "acceptance criteria": "acceptance",
    questions: "questions",
    "open questions": "questions",
  },
};
BLOCK_LABELS.section["goal"] = "goals";
BLOCK_LABELS.section["intention"] = "intentions";

function blockLabel(line: string, kind: Kind): { name: BlockName; tail: string } | null {
  const match = line.trim().match(LABEL_LINE);
  if (!match?.groups) return null;
  const tail = match.groups.tail.trim();
  const colon = match.groups.colon === ":" || match.groups.label.endsWith(":");
  // `**Features** are listed below` is prose; a label with text after it needs its colon.
  if (tail && !colon) return null;
  const name = BLOCK_LABELS[kind][wordKey(match.groups.label.replace(/:$/, ""))];
  return name ? { name, tail } : null;
}

type Container = {
  meta: MetaSegment[];
  blocks: Record<BlockName, string[]>;
  /** Meta values that could not be understood, kept as text. */
  leftovers: string[];
  structural: string[];
};

/** Splits the lines under one heading into its meta row, its prose and its labelled blocks. */
function readContainer(
  lines: readonly string[],
  fenced: readonly boolean[],
  from: number,
  to: number,
  kind: Kind,
): Container {
  const out: Container = {
    meta: [],
    blocks: {
      text: [],
      goals: [],
      intentions: [],
      clientSummary: [],
      clientTitle: [],
      features: [],
      steps: [],
      acceptance: [],
      context: [],
      questions: [],
    },
    leftovers: [],
    structural: [],
  };

  let at = nextContent(lines, from, to);
  if (at < to && !fenced[at] && /^[ \t]*>/.test(lines[at])) {
    const quote = readQuote(lines, fenced, at);
    const paragraphs = quote.paragraphs.map((paragraph) => readMetaParagraph(paragraph, kind));
    if (paragraphs.length > 0 && paragraphs.every(Boolean)) {
      out.meta = paragraphs.flatMap((segments) => segments ?? []);
      out.structural.push(...lines.slice(at, quote.end).map((line) => line.trim()));
      at = quote.end;
    }
  }

  let block: BlockName = "text";
  for (let index = at; index < to; index += 1) {
    const line = lines[index];
    if (fenced[index]) {
      out.blocks[block].push(line);
      continue;
    }
    if (kind === "task" && /^[ \t]*<details>[ \t]*$/i.test(line)) {
      const summary = nextContent(lines, index + 1, to);
      if (/^[ \t]*<summary>\s*technical context\s*<\/summary>[ \t]*$/i.test(lines[summary] ?? "")) {
        let close = summary + 1;
        while (close < to && !/^[ \t]*<\/details>[ \t]*$/i.test(lines[close])) close += 1;
        out.structural.push(line.trim(), lines[summary].trim());
        if (close < to) out.structural.push(lines[close].trim());
        out.blocks.context.push(...lines.slice(summary + 1, close));
        index = close;
        block = "text";
        continue;
      }
    }
    const label = blockLabel(line, kind);
    if (label) {
      block = label.name;
      out.structural.push(line.trim());
      if (label.tail) out.blocks[block].push(label.tail);
      continue;
    }
    out.blocks[block].push(line);
  }
  return out;
}

function metaValue(meta: readonly MetaSegment[], key: string): string | undefined {
  return meta.find((segment) => segment.key === key)?.value;
}

const codeSpans = (text: string) => [...text.matchAll(/`+\s*([^`]+?)\s*`+/g)].map((m) => m[1]);

/** A colour from `Blue `#3b82f6``, `` `var(--chart-3)` ``, `#3b82f6` or a palette name. */
function readColour(value: string): string | undefined {
  const candidates = [...codeSpans(value), value.trim()];
  for (const candidate of candidates) if (isValidColor(candidate)) return candidate.trim();
  const named = COLOR_PALETTE.find((entry) => wordKey(entry.label) === wordKey(value));
  return named?.value;
}

function readTags(value: string): string[] {
  const spans = codeSpans(value);
  return normalizeTags(spans.length > 0 ? spans : value.split(/[\s,]+/));
}

function readId(value: string): string | undefined {
  const id = (codeSpans(value)[0] ?? value).trim();
  return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ? id.toLowerCase() : undefined;
}

const LIST_ITEM =
  /^(?<indent>[ \t]*)(?:[-*+]|\d+[.)])[ \t]+(?:\[(?<mark>[ xX])\][ \t]+)?(?<text>\S.*)$/;
const indentWidth = (indent: string) => indent.replace(/\t/g, "  ").length;
const FEATURE_LINK = /[ \t]+(?:→|->)[ \t]*feature[ \t]+(?<n>\d+)[ \t]*$/i;

/** Lines that are not list items, returned so they can stay in the text. */
function readFeatures(lines: readonly string[]): { features: PlanMdFeature[]; stray: string[] } {
  const features: PlanMdFeature[] = [];
  const stray: string[] = [];
  for (const line of lines) {
    if (blankLine(line)) continue;
    const item = line.match(LIST_ITEM)?.groups;
    if (item && indentWidth(item.indent) < 2) {
      const text = collapseSpaces(item.text).slice(0, FEATURE_TEXT_MAX);
      if (text && features.length < MAX_FEATURES) {
        features.push({ text, met: (item.mark ?? " ") !== " " });
      }
    } else if (/^[ \t]/.test(line) && features.length > 0) {
      // An indented continuation belongs to the feature above it.
      const last = features[features.length - 1];
      last.text = collapseSpaces(`${last.text} ${line.replace(LIST_ITEM, "$<text>")}`).slice(
        0,
        FEATURE_TEXT_MAX,
      );
    } else stray.push(line);
  }
  return { features, stray };
}

function readSteps(
  lines: readonly string[],
  featureCount: number,
): { steps: PlanMdStep[]; stray: string[]; linked: string[] } {
  const steps: PlanMdStep[] = [];
  const stray: string[] = [];
  const linked: string[] = [];
  for (const line of lines) {
    if (blankLine(line)) continue;
    const item = line.match(LIST_ITEM)?.groups;
    if (!item) {
      stray.push(line);
      continue;
    }
    let text = collapseSpaces(item.text);
    let feature: number | undefined;
    const link = text.match(FEATURE_LINK);
    const n = Number(link?.groups?.n);
    if (link && n >= 1 && n <= featureCount) {
      feature = n;
      text = text.slice(0, link.index).trim();
      linked.push(line.trim());
    }
    text = text.slice(0, STEP_TEXT_MAX);
    if (!text) continue;
    const previous = steps.length > 0 ? steps[steps.length - 1].depth : -1;
    const depth = Math.max(
      0,
      Math.min(MAX_STEP_DEPTH, Math.floor(indentWidth(item.indent) / 2), previous + 1),
    );
    steps.push({ text, done: (item.mark ?? " ") !== " ", depth, ...(feature && { feature }) });
  }
  return { steps, stray, linked };
}

const QUESTION_HEAD =
  /^\*\*(?<status>open|answered|dismissed)(?:[ \t]*[·,/|][ \t]*(?<flag>blocking))?\*\*[ \t]*(?:[—–:-]+[ \t]*)?(?<body>.*)$/i;

function readQuestions(lines: readonly string[]): {
  questions: PlanMdQuestion[];
  stray: string[];
  rewritten: string[];
} {
  type Draft = { head: string; body: string[]; answer: string[] | null; question: PlanMdQuestion };
  const drafts: Draft[] = [];
  const stray: string[] = [];
  const rewritten: string[] = [];

  for (const line of lines) {
    const item = line.match(/^(?<indent>[ \t]*)[-*+][ \t]+(?<text>\S.*)$/)?.groups;
    if (item && indentWidth(item.indent) < 2) {
      let status: PlanMdQuestion["status"] = "open";
      let blocking = false;
      let body = item.text.trim();
      const head = body.match(QUESTION_HEAD)?.groups;
      const box = body.match(/^\[(?<mark>[ xX])\][ \t]+(?<rest>\S.*)$/)?.groups;
      if (head) {
        status = head.status.toLowerCase() as PlanMdQuestion["status"];
        blocking = Boolean(head.flag);
        body = head.body.trim();
      } else if (box) {
        status = box.mark === " " ? "open" : "answered";
        body = box.rest.trim();
      }
      if (head || box) rewritten.push(line.trim());
      drafts.push({ head: line, body: [body], answer: null, question: { body, blocking, status } });
      continue;
    }
    const draft = drafts[drafts.length - 1];
    if (!draft || (!blankLine(line) && !/^[ \t]/.test(line))) {
      if (!blankLine(line)) stray.push(line);
      continue;
    }
    if (blankLine(line)) {
      (draft.answer ?? draft.body).push("");
      continue;
    }
    const text = line.replace(/^[ \t]{1,2}/, "");
    const quoted = text.match(/^>[ \t]?(?<rest>.*)$/)?.groups;
    if (quoted) {
      draft.answer ??= [];
      draft.answer.push(quoted.rest);
      rewritten.push(line.trim());
    } else if (draft.answer) draft.answer.push(text.trim());
    else draft.body.push(text.trim());
  }

  const questions = drafts.flatMap((draft) => {
    const body = draft.body.join("\n").trim().slice(0, QUESTION_BODY_MAX);
    if (!body) return [];
    const answer = draft.answer
      ?.join("\n")
      .replace(/^\*\*answer:?\*\*:?[ \t]*/i, "")
      .trim()
      .slice(0, QUESTION_ANSWER_MAX);
    const status = answer && draft.question.status === "open" ? "answered" : draft.question.status;
    return [{ ...draft.question, body, status, ...(answer && { answer }) }];
  });
  return { questions, stray, rewritten };
}

/** A heading's text cut to its column; the full text is returned to put back in the description. */
function fit(raw: string, fallback: string, max: number): { title: string; overflow: string } {
  const text = collapseSpaces(raw) || fallback;
  if (text.length <= max) return { title: text, overflow: "" };
  return { title: `${text.slice(0, max - 1).trimEnd()}…`, overflow: text };
}

const joinText = (...parts: Array<string | undefined>) => parts.filter(Boolean).join("\n\n");

function readSettings(container: Container, description: string): PlanMdSettings | undefined {
  const { meta, leftovers } = container;
  const settings: PlanMdSettings = {};
  const text = joinText(description, ...leftovers);
  if (text) settings.description = text;

  const status = metaValue(meta, "status");
  if (status) {
    const plan = lookup(PLAN_STATUS_LABEL, status);
    if (plan) settings.status = plan;
  }
  const repo = codeSpans(metaValue(meta, "repo") ?? "")[0] ?? metaValue(meta, "repo");
  if (repo && /^[\w.-]+\/[\w.-]+$/.test(repo.trim())) settings.repo = repo.trim();
  const base = codeSpans(metaValue(meta, "base") ?? "")[0] ?? metaValue(meta, "base");
  if (base && isValidBranchName(base.trim())) settings.base = base.trim();

  const branch = metaValue(meta, "branch");
  if (branch) {
    const name = codeSpans(branch)[0];
    if (/directly on|on the base/i.test(branch)) settings.workMode = "base";
    else if (name && isValidBranchName(name)) {
      const mode = /\bnew\b/i.test(branch)
        ? "new"
        : /\bexisting\b/i.test(branch)
          ? "existing"
          : null;
      if (mode) {
        settings.workMode = mode;
        settings.workBranch = name;
      }
    }
  }
  const id = metaValue(meta, "plan id") ?? metaValue(meta, "id");
  const planId = id ? readId(id) : undefined;
  if (planId) settings.id = planId;
  const exported = metaValue(meta, "exported");
  if (exported) settings.exportedAt = exported;
  return Object.keys(settings).length > 0 ? settings : undefined;
}

/** Reads a board-format document. See the header of this file for the shape. */
export function parseBoardMarkdown(source: string): PlanMdDocument {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const fenced = fencedLines(lines);
  const structural: string[] = [];

  type Heading = { index: number; depth: number; title: string };
  const headings: Heading[] = [];
  const skip = new Set<number>();
  let sawTitle = false;
  let inSection = false;
  for (const [index, line] of lines.entries()) {
    if (fenced[index]) continue;
    if (MARKER_LINE.test(line)) {
      skip.add(index);
      structural.push(line.trim());
      continue;
    }
    const match = line.match(HEADING);
    if (!match?.groups) continue;
    const depth = match.groups.hashes.length;
    // One `#` title, `##` sections, `###` tasks; anything else is text.
    if (depth === 1 && !sawTitle) {
      sawTitle = true;
      headings.push({ index, depth, title: match.groups.title });
    } else if (depth === 2) {
      inSection = true;
      headings.push({ index, depth, title: match.groups.title });
    } else if (depth === 3 && inSection) {
      headings.push({ index, depth, title: match.groups.title });
    }
  }

  const masked = lines.map((line, index) => (skip.has(index) ? "" : line));
  const bodyOf = (position: number, kind: Kind, start: number) =>
    readContainer(masked, fenced, start, headings[position + 1]?.index ?? lines.length, kind);

  const first = headings[0];
  let preamble = "";
  let planContainer: Container | null = null;
  const planStart = first?.depth === 1 ? first.index + 1 : 0;
  const planBodyEnd = headings.find((heading) => heading.depth >= 2)?.index ?? lines.length;
  if (first && first.depth !== 1) {
    // No `#` title: whatever sits above the first section is the preamble.
    preamble = joinBody(lines.slice(0, first.index).filter((_, index) => !skip.has(index)));
  } else if (first) {
    planContainer = readContainer(masked, fenced, planStart, planBodyEnd, "plan");
    preamble = joinBody(lines.slice(0, first.index).filter((_, index) => !skip.has(index)));
  } else {
    preamble = joinBody(lines.filter((_, index) => !skip.has(index)));
  }
  if (planContainer) structural.push(...planContainer.structural);

  const sections: PlanMdSection[] = [];
  let section: PlanMdSection | null = null;

  for (const [position, heading] of headings.entries()) {
    if (heading.depth === 1) continue;
    const kind: Kind = heading.depth === 2 ? "section" : "task";
    const container = bodyOf(position, kind, heading.index + 1);
    structural.push(...container.structural);
    const { blocks, meta } = container;
    const stray: string[] = [];

    if (kind === "section") {
      const fitted = fit(heading.title, "Untitled section", SECTION_TITLE_MAX);
      const tags = metaValue(meta, "tags");
      const colourValue = metaValue(meta, "colour");
      const colour = colourValue ? readColour(colourValue) : undefined;
      const id = metaValue(meta, "id");
      const sectionId = id ? readId(id) : undefined;
      const unread = [
        colourValue && !colour ? `**Colour:** ${colourValue}` : "",
        id && !sectionId ? `**ID:** ${id}` : "",
      ].filter(Boolean);
      const description = joinText(fitted.overflow, joinBody(blocks.text), ...unread);
      const goals = joinBody(blocks.goals);
      const intentions = joinBody(blocks.intentions);
      const clientSummary = joinBody(blocks.clientSummary);
      const sectionTags = tags ? readTags(tags) : [];
      section = {
        title: fitted.title,
        ...(description && { description }),
        ...(goals && { goals }),
        ...(intentions && { intentions }),
        ...(clientSummary && { clientSummary }),
        ...(sectionTags.length > 0 && { tags: sectionTags }),
        ...(colour && { color: colour }),
        ...(sectionId && { id: sectionId }),
        tasks: [],
      };
      sections.push(section);
      continue;
    }

    if (!section) continue;
    const fitted = fit(heading.title, "Untitled task", TASK_TITLE_MAX);
    const parsedFeatures = readFeatures(blocks.features);
    const parsedSteps = readSteps(blocks.steps, parsedFeatures.features.length);
    const parsedQuestions = readQuestions(blocks.questions);
    stray.push(...parsedFeatures.stray, ...parsedSteps.stray, ...parsedQuestions.stray);
    structural.push(...parsedSteps.linked, ...parsedQuestions.rewritten);

    const statusText = metaValue(meta, "status");
    const status = statusText ? lookup(TASK_STATUS_LABEL, statusText) : undefined;
    const priorityText = metaValue(meta, "priority");
    const priority = priorityText ? lookup(PRIORITY_LABEL, priorityText) : undefined;
    const sizeText = metaValue(meta, "size");
    const size = sizeText ? lookup(SIZE_LABEL, sizeText) : undefined;
    const colourText = metaValue(meta, "colour");
    const colour = colourText ? readColour(colourText) : undefined;
    const idText = metaValue(meta, "id");
    const id = idText ? readId(idText) : undefined;
    const tagsText = metaValue(meta, "tags");
    const tags = tagsText ? readTags(tagsText) : [];
    const assignee = metaValue(meta, "assignee")?.replace(/[`*]/g, "").trim();
    const unread = [
      statusText && !status ? `**Status:** ${statusText}` : "",
      priorityText && !priority ? `**Priority:** ${priorityText}` : "",
      sizeText && !size ? `**Size:** ${sizeText}` : "",
      colourText && !colour ? `**Colour:** ${colourText}` : "",
      idText && !id ? `**ID:** ${idText}` : "",
    ].filter(Boolean);

    const description = joinText(
      fitted.overflow,
      joinBody(blocks.text),
      ...unread,
      joinBody(stray),
    );
    const acceptance = joinBody(blocks.acceptance);
    const context = joinBody(blocks.context).slice(0, CONTEXT_MAX);
    const clientTitle = collapseSpaces(joinBody(blocks.clientTitle)).slice(0, TASK_TITLE_MAX);
    const clientSummary = joinBody(blocks.clientSummary).slice(0, CLIENT_SUMMARY_MAX);
    const task: PlanMdTask = {
      title: fitted.title,
      description,
      steps: parsedSteps.steps,
      ...(acceptance && { acceptance }),
      ...(status === "done" && { done: true }),
      ...(id && { id }),
      ...(status && { status }),
      ...(priority && { priority }),
      ...(size && { size }),
      ...(tags.length > 0 && { tags }),
      ...(colour && { color: colour }),
      ...(assignee && { assignee }),
      ...(parsedFeatures.features.length > 0 && { features: parsedFeatures.features }),
      ...(parsedQuestions.questions.length > 0 && { questions: parsedQuestions.questions }),
      ...(context && { context }),
      ...(clientTitle && { clientTitle }),
      ...(clientSummary && { clientSummary }),
    };
    section.tasks.push(task);
  }

  const settings = planContainer
    ? readSettings(planContainer, joinBody(planContainer.blocks.text))
    : undefined;
  const title = first?.depth === 1 ? fit(first.title, "", TASK_TITLE_MAX).title : "";
  return {
    sections,
    format: "board",
    ...(title && { title }),
    ...(preamble && { preamble }),
    ...(settings && { plan: settings }),
    ...(structural.length > 0 && { structural }),
  };
}
