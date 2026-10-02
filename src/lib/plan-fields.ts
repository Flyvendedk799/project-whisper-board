/**
 * Small pure helpers for the plan fields added with questions, feature lists,
 * tags, colours and working branches. Shared by the screen, the server
 * functions and the agent API, so a colour, a tag or a branch name means the
 * same thing wherever it is written.
 */

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

export const COLOR_PALETTE = [
  { id: "slate", label: "Slate", value: "#64748b" },
  { id: "red", label: "Red", value: "#ef4444" },
  { id: "orange", label: "Orange", value: "#f97316" },
  { id: "amber", label: "Amber", value: "#f59e0b" },
  { id: "green", label: "Green", value: "#22c55e" },
  { id: "teal", label: "Teal", value: "#14b8a6" },
  { id: "blue", label: "Blue", value: "#3b82f6" },
  { id: "violet", label: "Violet", value: "#8b5cf6" },
  { id: "pink", label: "Pink", value: "#ec4899" },
] as const;

/** Same shape the database accepts: a design token (`var(--chart-1)`) or a hex value. */
const COLOR_SHAPE = /^(var\(--[a-z0-9-]+\)|#[0-9a-fA-F]{3,8})$/;

export function isValidColor(value: string | null | undefined): value is string {
  return typeof value === "string" && COLOR_SHAPE.test(value.trim());
}

/** A colour safe to write: `null` clears it, anything malformed is refused. */
export function parseColor(value: unknown): string | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  return isValidColor(value) ? value.trim() : undefined;
}

export function colorLabel(value: string | null | undefined): string {
  if (!value) return "Default";
  return (
    COLOR_PALETTE.find((entry) => entry.value.toLowerCase() === value.toLowerCase())?.label ??
    "Custom"
  );
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

export const MAX_TAGS = 20;
export const TAG_MAX = 32;

/** `"#Front End"` -> `"front-end"`. Empty when nothing usable is left. */
export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[\s,]+/g, "-")
    .replace(/[^\p{L}\p{N}_:/.-]/gu, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TAG_MAX);
}

export function normalizeTags(raw: readonly string[] | null | undefined): string[] {
  const seen = new Set<string>();
  for (const entry of raw ?? []) {
    const tag = normalizeTag(entry);
    if (tag) seen.add(tag);
    if (seen.size >= MAX_TAGS) break;
  }
  return [...seen];
}

/** Every distinct tag on a plan's sections and tasks, most used first. */
export function collectTags(plan: {
  sections?: ReadonlyArray<{
    tags?: readonly string[] | null;
    tasks?: ReadonlyArray<{ labels?: readonly string[] | null }> | null;
  }> | null;
}): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  const bump = (tag: string) => counts.set(tag, (counts.get(tag) ?? 0) + 1);
  for (const section of plan.sections ?? []) {
    for (const tag of section.tags ?? []) bump(tag);
    for (const task of section.tasks ?? []) for (const tag of task.labels ?? []) bump(tag);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/** The first block of a uuid, which is what shows next to a copy button. */
export function shortId(id: string): string {
  return id.slice(0, 8);
}

/** A search term that is (the start of) an id: 4+ hex characters, dashes allowed. */
export function matchesIdQuery(id: string, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^t-/, "");
  if (q.length < 4 || !/^[0-9a-f-]+$/.test(q)) return false;
  return id.toLowerCase().startsWith(q);
}

// ---------------------------------------------------------------------------
// Feature lists
// ---------------------------------------------------------------------------

export const FEATURE_TEXT_MAX = 500;
export const MAX_FEATURES = 50;

export type ParsedFeature = { text: string; met: boolean };

/**
 * Bullets pasted after a brief become features. Understands `-`, `*`, `•`,
 * `1.`, `2.1.1`, `1)` and `[ ]` / `[x]` prefixes, and one feature per line.
 */
export function parseFeatureList(text: string): ParsedFeature[] {
  const features: ParsedFeature[] = [];
  for (const line of text.split(/\r?\n/)) {
    let rest = line.trim();
    if (!rest) continue;
    rest = rest.replace(/^(?:[-*•–—]+|\d+(?:\.\d+)*[.)]?)\s+/, "");
    let met = false;
    const check = /^\[(?<mark>[ xX])\]\s*(?<tail>.*)$/.exec(rest);
    if (check?.groups) {
      met = check.groups.mark.toLowerCase() === "x";
      rest = check.groups.tail;
    }
    rest = rest.replace(/\s+/g, " ").trim();
    if (!rest) continue;
    features.push({ text: rest.slice(0, FEATURE_TEXT_MAX), met });
    if (features.length >= MAX_FEATURES) break;
  }
  return features;
}

export function featuresProgress(features: ReadonlyArray<{ met: boolean }>): {
  met: number;
  total: number;
  percent: number;
} {
  const met = features.filter((feature) => feature.met).length;
  return {
    met,
    total: features.length,
    percent: features.length === 0 ? 0 : Math.round((met / features.length) * 100),
  };
}

/**
 * How well the sub-steps cover the feature list: features nobody has a step
 * for yet, and steps that point at nothing.
 */
export function stepCoverage(
  features: ReadonlyArray<{ id: string; met: boolean }>,
  steps: ReadonlyArray<{ feature_id?: string | null }>,
): { covered: number; uncovered: string[]; loose: number } {
  const linked = new Set(steps.map((step) => step.feature_id).filter(Boolean) as string[]);
  const uncovered = features
    .filter((feature) => !feature.met && !linked.has(feature.id))
    .map((feature) => feature.id);
  return {
    covered: features.filter((feature) => linked.has(feature.id)).length,
    uncovered,
    loose: steps.filter((step) => !step.feature_id).length,
  };
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export type QuestionLike = {
  status: string;
  blocking: boolean;
};

export const isOpenQuestion = (question: Pick<QuestionLike, "status">) =>
  question.status === "open";

export function questionCounts(questions: readonly QuestionLike[] | null | undefined): {
  open: number;
  blocking: number;
} {
  const open = (questions ?? []).filter(isOpenQuestion);
  return { open: open.length, blocking: open.filter((q) => q.blocking).length };
}

export const QUESTION_BODY_MAX = 2000;
export const QUESTION_ANSWER_MAX = 5000;

// ---------------------------------------------------------------------------
// Working branch
// ---------------------------------------------------------------------------

/**
 * Where the work happens, next to the base branch it grew from:
 *  - `new`      a branch of its own, cut from the base (the usual choice)
 *  - `existing` a branch that is already there
 *  - `base`     straight on the base branch, no pull request needed
 */
export type WorkMode = "new" | "existing" | "base";

export const WORK_MODES: readonly WorkMode[] = ["new", "existing", "base"];

export const WORK_MODE_LABEL: Record<WorkMode, string> = {
  new: "New branch",
  existing: "Existing branch",
  base: "Directly on the base branch",
};

export function isWorkMode(value: unknown): value is WorkMode {
  return typeof value === "string" && (WORK_MODES as readonly string[]).includes(value);
}

/** Git's own rules for a ref name, close enough to catch typos before GitHub does. */
export function isValidBranchName(name: string): boolean {
  if (!name || name.length > 200) return false;
  if (/[\s~^:?*[\\]/.test(name) || name.includes("..") || name.includes("@{")) return false;
  if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/") || name.endsWith(".")) {
    return false;
  }
  if (name.endsWith(".lock") || name.includes("//")) return false;
  return ![...name].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}

/** `"Q4 Launch: payments"` -> `"plan/q4-launch-payments"`. */
export function suggestBranchName(title: string, prefix = "plan"): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return `${prefix}/${slug || "work"}`;
}

export type WorkTarget = {
  repo: string | null;
  base: string | null;
  mode: WorkMode | null;
  branch: string | null;
  /** The branch commits should land on, or null when no repository is set. */
  workOn: string | null;
  /** One line a person or an agent can read. */
  summary: string;
};

/** What a plan says about where its work lands. */
export function workTargetOf(plan: {
  github_repo?: string | null;
  github_base?: string | null;
  github_work_mode?: string | null;
  github_work_branch?: string | null;
}): WorkTarget {
  const repo = plan.github_repo?.trim() || null;
  const base = plan.github_base?.trim() || null;
  const mode = isWorkMode(plan.github_work_mode) ? plan.github_work_mode : null;
  const branch = plan.github_work_branch?.trim() || null;
  const baseName = base ?? "the default branch";

  if (!repo) {
    return { repo, base, mode, branch, workOn: null, summary: "No repository connected." };
  }
  if (mode === "base") {
    return {
      repo,
      base,
      mode,
      branch: null,
      workOn: base,
      summary: `Work directly on ${baseName} in ${repo}.`,
    };
  }
  if (mode && branch) {
    return {
      repo,
      base,
      mode,
      branch,
      workOn: branch,
      summary:
        mode === "new"
          ? `Work on a new branch ${branch}, cut from ${baseName}, in ${repo}.`
          : `Work on the existing branch ${branch} in ${repo}.`,
    };
  }
  return {
    repo,
    base,
    mode,
    branch,
    workOn: null,
    summary: `${repo}, based on ${baseName}. No working branch chosen: use one branch per task.`,
  };
}

/** Why a work-branch choice cannot be saved, or null when it can. */
export function workBranchProblem(
  mode: WorkMode | null,
  branch: string | null | undefined,
  base: string | null | undefined,
): string | null {
  if (mode === null || mode === "base") return null;
  const name = branch?.trim() ?? "";
  if (!name) return "Name the branch.";
  if (!isValidBranchName(name)) return `"${name}" is not a valid branch name.`;
  if (mode === "new" && base?.trim() && name === base.trim()) {
    return "A new branch needs a different name from the base branch.";
  }
  return null;
}
