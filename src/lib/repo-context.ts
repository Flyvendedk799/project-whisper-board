import { extractJson } from "@/lib/assistant-actions";
import { oneLine } from "@/lib/assistant-context";

/**
 * Turning a repository into context for one task, within limits: which paths
 * are worth listing, which the model may pick, how much of each file is read,
 * and the prompts for the two model calls (pick files, write the context).
 *
 * Pure. The server function does the GitHub calls and hands what it got here.
 */

export const MAX_PICKED_FILES = 8;
/** Characters of one file the model reads. */
export const FILE_CHARS = 20_000;
/** Characters of all files together. */
export const TOTAL_FILE_CHARS = 70_000;
/** Characters of the file listing in the picking prompt. */
export const TREE_LISTING_CHARS = 14_000;
/** Largest file worth fetching at all, in bytes. */
export const MAX_FILE_BYTES = 200_000;
export const CONTEXT_CHARS = 8_000;

const CODE_EXT = new Set(
  (
    "ts tsx js jsx mjs cjs py rb go rs java kt kts swift php cs c cc cpp h hpp vue svelte astro scala " +
    "sql sh graphql gql prisma css scss html"
  ).split(" "),
);
const DOC_EXT = new Set("md mdx txt rst".split(" "));
const CONFIG_EXT = new Set("json yaml yml toml".split(" "));
const NAMED = new Set(["dockerfile", "makefile", "readme", "license"]);

const SKIPPED_DIRS = new Set(
  (
    "node_modules dist build out .next .nuxt .svelte-kit .git .github .turbo .cache coverage vendor " +
    "__pycache__ .venv venv target .idea .vscode storybook-static"
  ).split(" "),
);

const LOCKFILES = new Set(
  (
    "package-lock.json yarn.lock pnpm-lock.yaml bun.lockb bun.lock cargo.lock composer.lock " +
    "poetry.lock gemfile.lock go.sum"
  ).split(" "),
);

export type TreeEntry = { path: string; type?: string; size?: number | null };

function extensionOf(file: string): string {
  const dot = file.lastIndexOf(".");
  return dot <= 0 ? "" : file.slice(dot + 1).toLowerCase();
}

/** The paths of a repository tree that are code, docs or config, and small enough to read. */
export function filterRepoPaths(entries: readonly TreeEntry[]): string[] {
  const kept: string[] = [];
  for (const entry of entries) {
    if (entry.type && entry.type !== "blob") continue;
    if (entry.size != null && entry.size > MAX_FILE_BYTES) continue;
    const parts = entry.path.split("/");
    const file = parts[parts.length - 1] ?? "";
    if (parts.slice(0, -1).some((dir) => SKIPPED_DIRS.has(dir.toLowerCase()))) continue;
    const lower = file.toLowerCase();
    if (LOCKFILES.has(lower)) continue;
    if (/\.(min\.(js|css)|map|snap)$/.test(lower) || /\.gen\./.test(lower)) continue;
    const ext = extensionOf(file);
    const named = NAMED.has(lower.replace(/\.[^.]+$/, ""));
    if (CODE_EXT.has(ext) || DOC_EXT.has(ext) || CONFIG_EXT.has(ext) || named)
      kept.push(entry.path);
  }
  return kept;
}

const STOP_WORDS = new Set(
  "the and for with that this from into when then than have has are was were will would should could can not but you your our their its add make use using new all any".split(
    " ",
  ),
);

/** Words in the task worth looking for in a path. */
export function keywordsOf(text: string): string[] {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));
  return [...new Set(words)].slice(0, 30);
}

/**
 * The most promising paths first: those whose names share words with the task,
 * then the shallow ones (entry points and docs live near the top).
 */
export function rankPaths(paths: readonly string[], text: string, limit = Infinity): string[] {
  const words = keywordsOf(text);
  const scored = paths.map((path) => {
    const lower = path.toLowerCase();
    const hits = words.filter((word) => lower.includes(word)).length;
    const depth = path.split("/").length - 1;
    const doc = /readme|architecture|contributing/.test(lower) ? 1 : 0;
    return { path, score: hits * 10 + doc * 3 - depth };
  });
  scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return scored.slice(0, limit).map((entry) => entry.path);
}

/** The listing the model picks from, cut at a size; `shown` of `total` paths fit. */
export function treeListing(
  paths: readonly string[],
  maxChars = TREE_LISTING_CHARS,
): { text: string; shown: string[]; total: number } {
  const shown: string[] = [];
  let used = 0;
  for (const path of paths) {
    if (used + path.length + 1 > maxChars) break;
    shown.push(path);
    used += path.length + 1;
  }
  return { text: shown.join("\n"), shown, total: paths.length };
}

/** The files the model chose, held to the paths it was actually offered. */
export function parsePickedFiles(
  raw: string,
  allowed: ReadonlySet<string>,
  max = MAX_PICKED_FILES,
): string[] {
  const parsed = extractJson(raw);
  const list =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).files
      : parsed;
  if (!Array.isArray(list)) return [];
  const picked: string[] = [];
  for (const entry of list) {
    const value =
      typeof entry === "string"
        ? entry
        : entry &&
            typeof entry === "object" &&
            typeof (entry as { path?: unknown }).path === "string"
          ? (entry as { path: string }).path
          : "";
    const path = value.trim().replace(/^\.?\//, "");
    if (allowed.has(path) && !picked.includes(path)) picked.push(path);
    if (picked.length >= max) break;
  }
  return picked;
}

export function truncateFile(
  content: string,
  max = FILE_CHARS,
): { text: string; truncated: boolean } {
  if (content.length <= max) return { text: content, truncated: false };
  const cut = content.slice(0, max);
  const lastBreak = cut.lastIndexOf("\n");
  const text = lastBreak > max * 0.6 ? cut.slice(0, lastBreak) : cut;
  return {
    text: `${text}\n… [truncated: ${content.length - text.length} more characters]`,
    truncated: true,
  };
}

export function looksBinary(content: string): boolean {
  return content.includes("\u0000");
}

export type FetchedFile = { path: string; content: string };
export type FittedFile = { path: string; text: string; truncated: boolean };

/** Each file cut to its own cap, then the lot held to a total; later files give way first. */
export function fitFiles(
  files: readonly FetchedFile[],
  limits: { perFile?: number; total?: number } = {},
): FittedFile[] {
  const perFile = limits.perFile ?? FILE_CHARS;
  let remaining = limits.total ?? TOTAL_FILE_CHARS;
  const fitted: FittedFile[] = [];
  for (const file of files) {
    if (remaining < 1500) break;
    if (looksBinary(file.content)) continue;
    const { text, truncated } = truncateFile(file.content, Math.min(perFile, remaining));
    fitted.push({ path: file.path, text, truncated });
    remaining -= text.length;
  }
  return fitted;
}

type TaskBrief = { title: string; description?: string | null; acceptance?: string | null };

const briefLines = (task: TaskBrief) =>
  [
    `Task: ${task.title}`,
    `Description: ${oneLine(task.description, 2500) || "(none)"}`,
    task.acceptance?.trim() ? `Acceptance: ${oneLine(task.acceptance, 800)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

export function buildPickFilesMessages(
  task: TaskBrief,
  listing: { text: string; total: number; shown: number },
  max = MAX_PICKED_FILES,
): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content:
        `You help a developer start a task. From the repository's file list, choose up to ${max} files ` +
        "that someone would need to read to do the task: where the change goes, the code it touches, and " +
        "any docs that describe it. Choose only paths that appear in the list. " +
        'Reply with strict JSON and nothing else: {"files":["path", …]}.',
    },
    {
      role: "user",
      content: `${briefLines(task)}\n\nFiles${
        listing.shown < listing.total
          ? ` (${listing.shown} of ${listing.total} shown, most relevant first)`
          : ""
      }:\n${listing.text}`,
    },
  ];
}

export function buildContextMessages(
  task: TaskBrief,
  repo: string,
  files: readonly FittedFile[],
): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content:
        "You write technical context for a developer (or an AI agent) who is about to build a task. Use only " +
        "the task and the files you are shown; if the files do not answer something, say so rather than guess. " +
        "Write markdown with exactly these sections: `## What exists` (the relevant code and how it works " +
        "now, naming files and functions), `## Where to change` (the files and places the work goes), " +
        "`## Risks` (what could break, edge cases, things to check) and `## Suggested approach` (a short " +
        "ordered plan). Be specific and concise: under 500 words, no preamble.",
    },
    {
      role: "user",
      content: [
        briefLines(task),
        `Repository: ${repo}`,
        ...files.map((file) => `--- ${file.path} ---\n${file.text}`),
      ].join("\n\n"),
    },
  ];
}

/** The model's markdown, trimmed and held to the stored size. */
export function capContext(markdown: string, max = CONTEXT_CHARS): string {
  const text = markdown.trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}\n\n… (cut to fit)` : text;
}
