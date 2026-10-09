/**
 * What the agent API accepts in a request body, as pure functions.
 *
 * The REST handlers in `routes/api.planner.$.ts` only wire these to the
 * database, so every rule an agent can trip over (a colour, a tag, a feature
 * list, a step line) is testable without a server. They use the same helpers as
 * the screen (`plan-fields`), so a value means the same thing whoever writes it.
 */
import { AppError } from "@/lib/errors";
import {
  FEATURE_TEXT_MAX,
  isValidBranchName,
  isWorkMode,
  MAX_FEATURES,
  normalizeTags,
  parseColor,
  parseFeatureList,
  QUESTION_ANSWER_MAX,
  QUESTION_BODY_MAX,
  workBranchProblem,
  type ParsedFeature,
  type WorkMode,
} from "@/lib/plan-fields";
import { parseRepoSlug } from "@/lib/github-url";
import { MAX_STEP_DEPTH, STEP_TEXT_MAX } from "@/lib/plan-markdown";
import { Constants, type Database } from "@/integrations/supabase/types";

type Body = Record<string, unknown>;
type TaskPriority = Database["public"]["Enums"]["plan_task_priority"];
type TaskComplexity = Database["public"]["Enums"]["plan_task_complexity"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const TASK_PRIORITIES: readonly string[] = Constants.public.Enums.plan_task_priority;
export const TASK_COMPLEXITIES: readonly string[] = Constants.public.Enums.plan_task_complexity;
/** Where an agent may put a task it creates. Claiming and finishing have their own calls. */
export const CREATE_STATUSES = ["backlog", "available"] as const;
/** Statuses `report_progress` can move a task to. Blocked goes through a question. */
export const PROGRESS_STATUSES = ["claimed", "in_progress", "in_review", "done"] as const;
export type ProgressStatus = (typeof PROGRESS_STATUSES)[number];

export const MAX_PROGRESS_NOTE = 5000;
const MAX_STEPS_PER_CALL = 100;
/** Longest plain-language text of a step a client reads. */
const STEP_CLIENT_TEXT_MAX = 300;
/** Longest plain-language wording of a feature (a deliverable) a client reads. */
export const FEATURE_CLIENT_TEXT_MAX = 300;

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** A required piece of text, trimmed, within a length. */
export function requireText(value: unknown, label: string, max: number): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new AppError("validation", `${label} is required.`);
  if (text.length > max) {
    throw new AppError("validation", `${label} is over ${max} characters.`);
  }
  return text;
}

/** An optional text field: `undefined` leaves it alone, `null` or blank clears it. */
function textField(value: unknown, label: string, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw new AppError("validation", `${label} must be text.`);
  const text = value.trim();
  if (text.length > max) throw new AppError("validation", `${label} is over ${max} characters.`);
  return text || null;
}

/** An optional id: absent or null is null, anything that is not a uuid is refused. */
export function optionalUuid(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (!isUuid(value)) throw new AppError("validation", `${label} must be an id (a uuid).`);
  return value;
}

function uuidList(value: unknown, label: string, max: number): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > max || !value.every(isUuid)) {
    throw new AppError("validation", `${label} must be a list of up to ${max} ids.`);
  }
  return [...new Set(value as string[])];
}

function enumField(value: unknown, allowed: readonly string[], label: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new AppError("validation", `${label} is one of ${allowed.join(", ")}.`);
  }
  return value;
}

/** `undefined` when absent, a safe colour or `null` when present, an error when malformed. */
function colorField(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  const color = parseColor(value);
  if (color === undefined) {
    throw new AppError(
      "validation",
      "`color` is a hex value like #3b82f6 or a design token like var(--chart-1); send null to clear it.",
    );
  }
  return color;
}

function tagsField(body: Body): string[] | undefined {
  const raw = body.tags ?? body.labels;
  if (raw === undefined) return undefined;
  const list = typeof raw === "string" ? raw.split(",") : raw;
  if (!Array.isArray(list) || !list.every((tag) => typeof tag === "string") || list.length > 40) {
    throw new AppError("validation", "`tags` is a list of up to 40 words.");
  }
  return normalizeTags(list as string[]);
}

/** A list of lines from either an array of strings or one multi-line string. */
function lineList(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined;
  const lines =
    typeof value === "string" ? value.split(/\r?\n/) : Array.isArray(value) ? value : null;
  if (!lines || !lines.every((line) => typeof line === "string")) {
    throw new AppError("validation", `${label} is a list of text lines.`);
  }
  return (lines as string[]).map((line) => line.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

/**
 * `github_work_mode` and `github_work_branch` on a new plan. The branch only
 * means something for `new` and `existing`; `base` works straight on the base.
 */
export function parseWorkTarget(
  body: Body,
  base: string | null,
): { github_work_mode: WorkMode | null; github_work_branch: string | null } {
  const mode = body.github_work_mode ?? null;
  const branch = optionalString(body.github_work_branch);
  if (mode !== null && !isWorkMode(mode)) {
    throw new AppError(
      "validation",
      '`github_work_mode` is "new" (a branch of its own), "existing" or "base" (straight on the base branch).',
    );
  }
  if (mode === null) {
    if (branch) {
      throw new AppError("validation", "`github_work_branch` needs a `github_work_mode`.");
    }
    return { github_work_mode: null, github_work_branch: null };
  }
  const problem = workBranchProblem(mode, branch, base);
  if (problem) throw new AppError("validation", problem);
  return { github_work_mode: mode, github_work_branch: mode === "base" ? null : branch };
}

/**
 * Fields an agent may change on an existing plan via `update_plan`.
 * Description is always editable; github / work_target fields are only filled
 * when the plan does not already have them (see `mergePlanUpdate`).
 */
export interface PlanUpdateFields {
  description?: string | null;
  github_repo?: string;
  github_base?: string;
  github_work_mode?: WorkMode;
  github_work_branch?: string;
}

/** What `update_plan` accepts in the request body (before the "when missing" rule). */
export function parsePlanUpdate(body: Body): PlanUpdateFields {
  const fields: PlanUpdateFields = {};
  const description = textField(body.description, "`description`", 10000);
  if (description !== undefined) fields.description = description;

  if (body.github_repo !== undefined) {
    const repo = requireText(body.github_repo, "`github_repo`", 200);
    if (!parseRepoSlug(repo)) {
      throw new AppError("validation", "`github_repo` must look like owner/name.");
    }
    fields.github_repo = repo;
  }
  if (body.github_base !== undefined) {
    fields.github_base = requireText(body.github_base, "`github_base`", 200);
  }

  if (body.github_work_mode !== undefined) {
    const mode = body.github_work_mode;
    if (!isWorkMode(mode)) {
      throw new AppError(
        "validation",
        '`github_work_mode` is "new" (a branch of its own), "existing" or "base" (straight on the base branch).',
      );
    }
    fields.github_work_mode = mode;
  }
  if (body.github_work_branch !== undefined) {
    // Branch alone is allowed when the plan already has a mode (checked in mergePlanUpdate).
    fields.github_work_branch = requireText(body.github_work_branch, "`github_work_branch`", 200);
  }

  if (Object.keys(fields).length === 0) {
    throw new AppError(
      "validation",
      "Send at least one of description, github_repo, github_base, github_work_mode, github_work_branch.",
    );
  }
  return fields;
}

export type PlanGithubState = {
  github_repo: string | null;
  github_base: string | null;
  github_work_mode: string | null;
  github_work_branch: string | null;
};

/** Columns `update_plan` may write on `plans`. */
export type PlanUpdatePatch = {
  description?: string | null;
  github_repo?: string | null;
  github_base?: string | null;
  github_work_mode?: string | null;
  github_work_branch?: string | null;
};

function missingOnly(
  label: string,
  current: string | null | undefined,
  next: string | undefined,
): string | undefined {
  if (next === undefined) return undefined;
  const existing = current?.trim() || null;
  if (existing) {
    if (existing === next) return undefined;
    throw new AppError(
      "validation",
      `${label} is already set; update_plan can only fill it when missing.`,
    );
  }
  return next;
}

/**
 * Turn a parsed update into the columns to write. Description always applies;
 * github / work_target fields only when the plan does not already have them.
 */
export function mergePlanUpdate(
  current: PlanGithubState,
  fields: PlanUpdateFields,
): PlanUpdatePatch {
  const patch: PlanUpdatePatch = {};

  if (fields.description !== undefined) patch.description = fields.description;

  const repo = missingOnly("`github_repo`", current.github_repo, fields.github_repo);
  if (repo !== undefined) patch.github_repo = repo;

  const base = missingOnly("`github_base`", current.github_base, fields.github_base);
  if (base !== undefined) patch.github_base = base;

  if (fields.github_work_mode !== undefined) {
    const existingMode = isWorkMode(current.github_work_mode) ? current.github_work_mode : null;
    if (existingMode) {
      if (
        existingMode === fields.github_work_mode &&
        (fields.github_work_branch === undefined ||
          (current.github_work_branch?.trim() || null) === (fields.github_work_branch ?? null))
      ) {
        // Same values already on the plan: nothing to write.
      } else {
        throw new AppError(
          "validation",
          "`github_work_mode` is already set; update_plan can only fill the work target when missing.",
        );
      }
    } else {
      const mergedBase = base !== undefined ? base : current.github_base?.trim() || null;
      const work = parseWorkTarget(
        {
          github_work_mode: fields.github_work_mode,
          github_work_branch: fields.github_work_branch,
        },
        mergedBase,
      );
      patch.github_work_mode = work.github_work_mode;
      patch.github_work_branch = work.github_work_branch;
    }
  } else if (fields.github_work_branch !== undefined) {
    // Branch alone: only when mode is already set and branch is missing.
    const existingMode = isWorkMode(current.github_work_mode) ? current.github_work_mode : null;
    if (!existingMode) {
      throw new AppError("validation", "`github_work_branch` needs a `github_work_mode`.");
    }
    const branch = missingOnly(
      "`github_work_branch`",
      current.github_work_branch,
      fields.github_work_branch,
    );
    if (branch !== undefined) {
      const problem = workBranchProblem(
        existingMode,
        branch,
        base !== undefined ? base : current.github_base,
      );
      if (problem) throw new AppError("validation", problem);
      if (existingMode === "base") {
        throw new AppError(
          "validation",
          "The plan works on the base branch; there is no work branch to set.",
        );
      }
      patch.github_work_branch = branch;
    }
  }

  if (Object.keys(patch).length === 0) {
    throw new AppError(
      "validation",
      "Nothing to change: every field you sent is already set on the plan.",
    );
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export interface SectionFields {
  title?: string;
  description?: string | null;
  goals?: string | null;
  intentions?: string | null;
  /** Short plain-language Danish summary that clients of a client-view plan see. */
  client_summary?: string | null;
  color?: string | null;
  tags?: string[];
}

function sectionFields(body: Body): SectionFields {
  const fields: SectionFields = {};
  if (body.title !== undefined) fields.title = requireText(body.title, "`title`", 100);
  const description = textField(body.description, "`description`", 10000);
  if (description !== undefined) fields.description = description;
  const goals = textField(body.goals, "`goals`", 5000);
  if (goals !== undefined) fields.goals = goals;
  const intentions = textField(body.intentions, "`intentions`", 5000);
  if (intentions !== undefined) fields.intentions = intentions;
  const clientSummary = textField(body.client_summary, "`client_summary`", 2000);
  if (clientSummary !== undefined) fields.client_summary = clientSummary;
  const color = colorField(body.color);
  if (color !== undefined) fields.color = color;
  const tags = tagsField(body);
  if (tags !== undefined) fields.tags = tags;
  return fields;
}

export function parseSectionCreate(body: Body): SectionFields & { title: string } {
  const fields = sectionFields(body);
  if (!fields.title) throw new AppError("validation", "A section needs a `title`.");
  return { ...fields, title: fields.title };
}

export function parseSectionUpdate(body: Body): SectionFields {
  const fields = sectionFields(body);
  if (Object.keys(fields).length === 0) {
    throw new AppError(
      "validation",
      "Send at least one of title, description, goals, intentions, client_summary, color, tags.",
    );
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

/** A task's editable columns, named as the database names them. */
export interface TaskFields {
  title?: string;
  description?: string | null;
  /** The task as a client reads it: short plain Danish. Clients see a task only when this is set. */
  client_title?: string | null;
  /** One plain Danish sentence explaining the task to the client. */
  client_summary?: string | null;
  priority?: TaskPriority;
  complexity?: TaskComplexity | null;
  labels?: string[];
  color?: string | null;
  acceptance_criteria?: string | null;
  branch_name?: string | null;
  /** The teammate it is assigned to (a workspace member's user id), or null to clear. */
  assigned_user_id?: string | null;
}

function taskFields(body: Body): TaskFields {
  const fields: TaskFields = {};
  if (body.title !== undefined) fields.title = requireText(body.title, "`title`", 200);
  const description = textField(body.description, "`description`", 50000);
  if (description !== undefined) fields.description = description;
  const clientTitle = textField(body.client_title, "`client_title`", 200);
  if (clientTitle !== undefined) fields.client_title = clientTitle;
  const clientSummary = textField(body.client_summary, "`client_summary`", 1000);
  if (clientSummary !== undefined) fields.client_summary = clientSummary;
  const priority = enumField(body.priority, TASK_PRIORITIES, "`priority`");
  if (priority !== undefined) fields.priority = priority as TaskPriority;
  if (body.complexity === null) fields.complexity = null;
  else {
    const complexity = enumField(body.complexity, TASK_COMPLEXITIES, "`complexity`");
    if (complexity !== undefined) fields.complexity = complexity as TaskComplexity;
  }
  const tags = tagsField(body);
  if (tags !== undefined) fields.labels = tags;
  const color = colorField(body.color);
  if (color !== undefined) fields.color = color;
  const criteria = lineList(body.acceptance_criteria, "`acceptance_criteria`");
  if (criteria !== undefined) {
    fields.acceptance_criteria = criteria.length ? criteria.join("\n").slice(0, 20000) : null;
  }
  if (body.branch_name !== undefined) {
    const branch = textField(body.branch_name, "`branch_name`", 200);
    if (branch && !isValidBranchName(branch)) {
      throw new AppError("validation", `"${branch}" is not a valid branch name.`);
    }
    fields.branch_name = branch;
  }
  if (body.assigned_user_id !== undefined) {
    fields.assigned_user_id = optionalUuid(body.assigned_user_id, "`assigned_user_id`");
  }
  return fields;
}

export interface TaskCreate {
  sectionId: string;
  fields: TaskFields & { title: string };
  status: (typeof CREATE_STATUSES)[number];
  dependsOn: string[];
  /** What the task must deliver, each with the optional plain-Danish wording for clients. */
  features: Array<{ text: string; clientText?: string }>;
}

/**
 * `features` on a new task: a list of texts, one multi-line text, or entries
 * `{ text, client_text }` (plain Danish for the client; shown only when set).
 */
function createFeatures(value: unknown): TaskCreate["features"] {
  if (value === undefined || value === null) return [];
  const entries = typeof value === "string" ? value.split(/\r?\n/) : value;
  if (!Array.isArray(entries)) {
    throw new AppError("validation", "`features` is a list of texts or { text, client_text }.");
  }
  const features: TaskCreate["features"] = [];
  for (const entry of entries as unknown[]) {
    if (typeof entry === "string") {
      const text = entry.trim();
      if (text) features.push({ text });
    } else if (entry && typeof entry === "object" && typeof (entry as Body).text === "string") {
      const text = ((entry as Body).text as string).trim();
      if (!text) continue;
      const clientText = textField(
        (entry as Body).client_text,
        "`client_text`",
        FEATURE_CLIENT_TEXT_MAX,
      );
      features.push({ text, ...(clientText && { clientText }) });
    } else {
      throw new AppError("validation", "`features` is a list of texts or { text, client_text }.");
    }
  }
  return features;
}

export function parseTaskCreate(body: Body): TaskCreate {
  const fields = taskFields(body);
  if (!fields.title) throw new AppError("validation", "A task needs a `title`.");
  const sectionId = optionalUuid(body.section_id, "`section_id`");
  if (!sectionId) throw new AppError("validation", "`section_id` says which section it goes in.");
  const status = enumField(body.status, CREATE_STATUSES, "`status`") ?? "available";

  const features = createFeatures(body.features);
  if (features.length > MAX_FEATURES) {
    throw new AppError("validation", `At most ${MAX_FEATURES} features per task.`);
  }
  if (features.some((feature) => feature.text.length > FEATURE_TEXT_MAX)) {
    throw new AppError("validation", `A feature is at most ${FEATURE_TEXT_MAX} characters.`);
  }
  return {
    sectionId,
    fields: { ...fields, title: fields.title },
    status: status as TaskCreate["status"],
    dependsOn: uuidList(body.depends_on, "`depends_on`", 50),
    features,
  };
}

export function parseTaskUpdate(body: Body): TaskFields {
  const fields = taskFields(body);
  if (Object.keys(fields).length === 0) {
    throw new AppError(
      "validation",
      "Send at least one of title, description, client_title, client_summary, priority, complexity, tags, color, acceptance_criteria, branch_name, assigned_user_id.",
    );
  }
  return fields;
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export const MAX_COMMENT_BODY = 20000;

/**
 * A comment from an agent. Mentions go in the body as `@[Name](user:<id>)`
 * (the ids come from GET people); `mentions` is an optional list of ids for
 * clients that would rather pass them separately.
 */
export function parseCommentInput(body: Body): {
  body: string;
  agentId: string | null;
  mentions: string[];
} {
  return {
    body: requireText(body.body, "`body` (the comment)", MAX_COMMENT_BODY),
    agentId: optionalUuid(body.agent_id, "`agent_id`"),
    mentions: uuidList(body.mentions, "`mentions`", 20),
  };
}

/** Who has to answer a question: the agency (the default, the human operator), an agent, or the client. */
export const QUESTION_AUDIENCES = ["agency", "agent", "client"] as const;
export type QuestionAudience = (typeof QUESTION_AUDIENCES)[number];

const CLIENT_BODY_REQUIRED =
  "A question for the client needs a `client_body`: write the question in plain Danish so a non-technical person understands it.";

function audienceField(value: unknown): QuestionAudience | undefined {
  return enumField(value, QUESTION_AUDIENCES, "`audience`") as QuestionAudience | undefined;
}

function clientBodyField(value: unknown): string | null | undefined {
  return textField(value, "`client_body`", QUESTION_BODY_MAX);
}

/**
 * The `client_body` to store when a question is aimed at someone. A question can
 * only go to the client with a non-empty Danish wording: the one just sent, or
 * else the one it already has. For the other audiences a sent wording is kept
 * (so the question can be sent on later) and an absent one leaves it alone.
 */
export function resolveClientBody(
  audience: QuestionAudience,
  sent: string | null | undefined,
  existing: string | null | undefined,
): string | null | undefined {
  if (audience === "client") {
    const body = sent === undefined ? existing?.trim() || null : sent;
    if (!body) throw new AppError("validation", CLIENT_BODY_REQUIRED);
    return body;
  }
  return sent;
}

export function parseQuestionInput(body: Body): {
  body: string;
  blocking: boolean;
  agentId: string | null;
  audience: QuestionAudience;
  clientBody: string | null;
} {
  const audience = audienceField(body.audience ?? undefined) ?? "agency";
  return {
    body: requireText(body.body, "`body` (the question)", QUESTION_BODY_MAX),
    blocking: body.blocking === true,
    agentId: optionalUuid(body.agent_id, "`agent_id`"),
    audience,
    clientBody: resolveClientBody(audience, clientBodyField(body.client_body), null) ?? null,
  };
}

/** `set_question_audience`: re-aim an open question; `clientBody` is undefined when none was sent. */
export function parseAudienceInput(body: Body): {
  audience: QuestionAudience;
  clientBody: string | null | undefined;
} {
  const audience = audienceField(body.audience);
  if (!audience) {
    throw new AppError("validation", `\`audience\` is required: ${QUESTION_AUDIENCES.join(", ")}.`);
  }
  return { audience, clientBody: clientBodyField(body.client_body) };
}

export function parseAnswerInput(body: Body): { answer: string; agentId: string | null } {
  return {
    answer: requireText(body.answer, "`answer`", QUESTION_ANSWER_MAX),
    agentId: optionalUuid(body.agent_id, "`agent_id`"),
  };
}

export const QUESTION_STATUS_FILTERS = ["open", "answered", "dismissed", "all"] as const;
export type QuestionStatusFilter = (typeof QUESTION_STATUS_FILTERS)[number];

export function parseQuestionFilter(raw: string | null, fallback: QuestionStatusFilter) {
  if (!raw) return fallback;
  if (!(QUESTION_STATUS_FILTERS as readonly string[]).includes(raw)) {
    throw new AppError("validation", `\`status\` is ${QUESTION_STATUS_FILTERS.join(", ")}.`);
  }
  return raw as QuestionStatusFilter;
}

/** `?audience=` on a question list: one audience, a comma list, or `all` (no filter). */
export function parseAudienceFilter(raw: string | null): QuestionAudience[] | null {
  if (!raw || raw.trim() === "all") return null;
  const wanted = raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const unknown = wanted.filter(
    (value) => !(QUESTION_AUDIENCES as readonly string[]).includes(value),
  );
  if (unknown.length > 0 || wanted.length === 0) {
    throw new AppError(
      "validation",
      `\`audience\` is ${QUESTION_AUDIENCES.join(", ")}, a comma list of them, or all.`,
    );
  }
  return [...new Set(wanted)] as QuestionAudience[];
}

/** A blocking reason becomes the question a person sees, so it has to fit one. */
export function parseBlockInput(body: Body): { reason: string | null; agentId: string | null } {
  return {
    reason: optionalString(body.reason)?.slice(0, QUESTION_BODY_MAX) ?? null,
    agentId: optionalUuid(body.agent_id, "`agent_id`"),
  };
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

/** A feature to add, with the plain-Danish wording clients read when it has one. */
export type FeatureInput = ParsedFeature & { clientText?: string };

/**
 * `text` may be a pasted block of bullets; `items` is one feature per entry,
 * each a text or `{ text, client_text }` (the feature in plain Danish for the
 * client, who sees a feature only when it is set).
 */
export function parseFeaturesInput(body: Body): {
  features: FeatureInput[];
  agentId: string | null;
} {
  const features: FeatureInput[] = [];
  if (body.text !== undefined) {
    if (typeof body.text !== "string") throw new AppError("validation", "`text` must be text.");
    features.push(...parseFeatureList(body.text.slice(0, 20000)));
  }
  if (body.items !== undefined) {
    const problem = new AppError(
      "validation",
      "`items` is a list of feature texts or { text, client_text }.",
    );
    if (!Array.isArray(body.items)) throw problem;
    for (const item of body.items as unknown[]) {
      if (typeof item === "string") {
        features.push(...parseFeatureList(item));
      } else if (item && typeof item === "object" && typeof (item as Body).text === "string") {
        const entry = item as Body;
        const [first] = parseFeatureList(entry.text as string);
        if (!first) continue;
        const clientText = textField(entry.client_text, "`client_text`", FEATURE_CLIENT_TEXT_MAX);
        features.push({ ...first, ...(clientText && { clientText }) });
      } else {
        throw problem;
      }
    }
  }
  const clientText = textField(body.client_text, "`client_text`", FEATURE_CLIENT_TEXT_MAX);
  if (clientText) {
    if (features.length !== 1) {
      throw new AppError(
        "validation",
        "`client_text` goes with a single feature. Give each feature in `items` its own { text, client_text }, or set it later with update_task_feature.",
      );
    }
    features[0].clientText = clientText;
  }
  if (features.length === 0) throw new AppError("validation", "Send at least one feature.");
  if (features.length > MAX_FEATURES) {
    throw new AppError("validation", `At most ${MAX_FEATURES} features per call.`);
  }
  return { features, agentId: optionalUuid(body.agent_id, "`agent_id`") };
}

export function parseFeatureUpdate(body: Body): {
  met?: boolean;
  text?: string;
  client_text?: string | null;
} {
  const patch: { met?: boolean; text?: string; client_text?: string | null } = {};
  if (body.met !== undefined) {
    if (typeof body.met !== "boolean") throw new AppError("validation", "`met` is true or false.");
    patch.met = body.met;
  }
  if (body.text !== undefined) {
    patch.text = requireText(body.text, "`text`", FEATURE_TEXT_MAX).replace(/\s+/g, " ");
  }
  const clientText = textField(body.client_text, "`client_text`", FEATURE_CLIENT_TEXT_MAX);
  if (clientText !== undefined) patch.client_text = clientText;
  if (Object.keys(patch).length === 0) {
    throw new AppError("validation", "Send `met`, `text` and/or `client_text`.");
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export interface StepLine {
  text: string;
  depth: number;
  done: boolean;
  /** The step in plain Danish for clients; a step is shown to clients only when this is set. */
  clientText?: string;
}

/**
 * One step per line. Leading `-`, `1.` and `[ ]` / `[x]` markers are dropped
 * (a ticked box means the step is already done) and two spaces of indentation
 * make a step one level deeper.
 */
export function parseStepLines(text: string): StepLine[] {
  const lines: StepLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const indent = /^[ \t]*/.exec(raw)?.[0] ?? "";
    const depth = Math.min(MAX_STEP_DEPTH, Math.floor(indent.replace(/\t/g, "  ").length / 2));
    let rest = raw.trim().replace(/^(?:[-*•]+|\d+(?:\.\d+)*[.)]?)\s+/, "");
    let done = false;
    const check = /^\[([ xX])\]\s*/.exec(rest);
    if (check) {
      done = check[1].toLowerCase() === "x";
      rest = rest.slice(check[0].length);
    }
    rest = rest.replace(/\s+/g, " ").trim().slice(0, STEP_TEXT_MAX);
    if (rest) lines.push({ text: rest, depth, done });
  }
  return lines;
}

/** A step is at most one level deeper than the one above it. */
export function clampStepDepths(lines: readonly StepLine[], previousDepth: number): StepLine[] {
  let above = previousDepth;
  return lines.map((line) => {
    const depth = Math.max(0, Math.min(line.depth, above + 1));
    above = depth;
    return { ...line, depth };
  });
}

/**
 * Steps to add: `text` (one or many lines), `items` (a text, or `{ text, depth,
 * done, client_text }`), or both. `feature_id` points them all at one feature,
 * `depth` is the indent of a lone step, and `client_text` (plain Danish, for
 * clients) sets the client text of a lone step.
 */
export function parseStepsInput(body: Body): {
  lines: StepLine[];
  featureId: string | null;
  agentId: string | null;
} {
  const lines: StepLine[] = [];
  const baseDepth = Math.min(Math.max(Math.trunc(Number(body.depth)) || 0, 0), MAX_STEP_DEPTH);
  if (body.text !== undefined) {
    if (typeof body.text !== "string") throw new AppError("validation", "`text` must be text.");
    for (const line of parseStepLines(body.text.slice(0, 20000))) {
      lines.push({ ...line, depth: Math.min(line.depth + baseDepth, MAX_STEP_DEPTH) });
    }
  }
  if (body.items !== undefined) {
    if (!Array.isArray(body.items)) {
      throw new AppError("validation", "`items` is a list of steps.");
    }
    for (const item of body.items as unknown[]) {
      if (typeof item === "string") {
        lines.push(...parseStepLines(item));
      } else if (item && typeof item === "object" && typeof (item as Body).text === "string") {
        const entry = item as Body;
        const [first] = parseStepLines(entry.text as string);
        if (!first) continue;
        const depth = Math.min(Math.max(Math.trunc(Number(entry.depth)) || 0, 0), MAX_STEP_DEPTH);
        const clientText = textField(entry.client_text, "`client_text`", STEP_CLIENT_TEXT_MAX);
        lines.push({
          ...first,
          depth,
          done: entry.done === true || first.done,
          ...(clientText && { clientText }),
        });
      } else {
        throw new AppError("validation", "Each item is a text or { text, depth?, done? }.");
      }
    }
  }
  if (body.done === true && lines.length === 1) lines[0].done = true;
  const clientText = textField(body.client_text, "`client_text`", STEP_CLIENT_TEXT_MAX);
  if (clientText) {
    if (lines.length !== 1) {
      throw new AppError(
        "validation",
        "`client_text` goes with a single step. Give each step in `items` its own { text, client_text }, or set it later with update_task_step.",
      );
    }
    lines[0].clientText = clientText;
  }
  if (lines.length === 0) throw new AppError("validation", "Send at least one step in `text`.");
  if (lines.length > MAX_STEPS_PER_CALL) {
    throw new AppError("validation", `At most ${MAX_STEPS_PER_CALL} steps per call.`);
  }
  return {
    lines,
    featureId: optionalUuid(body.feature_id, "`feature_id`"),
    agentId: optionalUuid(body.agent_id, "`agent_id`"),
  };
}

export function parseStepPatch(body: Body): {
  done?: boolean;
  text?: string;
  client_text?: string | null;
  feature_id?: string | null;
} {
  const patch: {
    done?: boolean;
    text?: string;
    client_text?: string | null;
    feature_id?: string | null;
  } = {};
  if (body.done !== undefined) {
    if (typeof body.done !== "boolean")
      throw new AppError("validation", "`done` is true or false.");
    patch.done = body.done;
  }
  if (body.text !== undefined) {
    patch.text = requireText(body.text, "`text`", STEP_TEXT_MAX).replace(/\s+/g, " ");
  }
  const clientText = textField(body.client_text, "`client_text`", STEP_CLIENT_TEXT_MAX);
  if (clientText !== undefined) patch.client_text = clientText;
  if (body.feature_id !== undefined)
    patch.feature_id = optionalUuid(body.feature_id, "`feature_id`");
  if (Object.keys(patch).length === 0) {
    throw new AppError("validation", "Send `done`, `text`, `client_text` and/or `feature_id`.");
  }
  return patch;
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

export interface ProgressInput {
  agentId: string | null;
  status: ProgressStatus | null;
  /** A comment is posted only when this is not empty. */
  note: string | null;
  stepsDone: string[];
  featuresMet: string[];
}

/**
 * The "Progresser": status, ticks and an optional note in one call. A note is
 * the only thing that becomes a comment, so an update with nothing to say adds
 * no noise to the discussion.
 */
export function parseProgressInput(body: Body): ProgressInput {
  if (body.status === "blocked") {
    throw new AppError(
      "validation",
      "Do not set `blocked` here: ask a question with blocking true (ask_question) or call block with a reason.",
    );
  }
  const status = enumField(body.status, PROGRESS_STATUSES, "`status`");
  let note: string | null = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string") throw new AppError("validation", "`note` must be text.");
    note = body.note.trim() || null;
    if (note && note.length > MAX_PROGRESS_NOTE) {
      throw new AppError("validation", `\`note\` is over ${MAX_PROGRESS_NOTE} characters.`);
    }
  }
  const input: ProgressInput = {
    agentId: optionalUuid(body.agent_id, "`agent_id`"),
    status: (status as ProgressStatus | undefined) ?? null,
    note,
    stepsDone: uuidList(body.steps_done, "`steps_done`", 100),
    featuresMet: uuidList(body.features_met, "`features_met`", 100),
  };
  if (!input.status && !input.note && !input.stepsDone.length && !input.featuresMet.length) {
    throw new AppError(
      "validation",
      "Send at least one of status, note, steps_done, features_met.",
    );
  }
  return input;
}
