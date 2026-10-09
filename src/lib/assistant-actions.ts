import { z } from "zod";
import { Constants } from "@/integrations/supabase/types";
import {
  COLOR_PALETTE,
  colorLabel,
  FEATURE_TEXT_MAX,
  normalizeTags,
  parseColor,
} from "@/lib/plan-fields";
import { MAX_STEP_DEPTH, STEP_TEXT_MAX } from "@/lib/plan-markdown";

/**
 * What the assistant is allowed to do.
 *
 * The model is text-only, so it answers in JSON: `{ reply, actions[] }`. Each
 * action comes from the whitelist below and is validated here, never trusted:
 * a malformed action is dropped, and so is one that names a plan, section,
 * task, feature or question the model was not shown. The survivors are only
 * PROPOSED to the person; the browser runs them through the same server
 * functions every other button uses, so they happen as that person under RLS.
 *
 * Pure: no React, no network. Shared by the server (which validates) and the
 * client (which describes and runs).
 */

// ---------------------------------------------------------------------------
// Short refs: what the model sees instead of uuids
// ---------------------------------------------------------------------------

export type RefKind = "plan" | "section" | "task" | "feature" | "question";

const PREFIX: Record<RefKind, string> = {
  plan: "P",
  section: "S",
  task: "T",
  feature: "F",
  question: "Q",
};

type RefEntry = { kind: RefKind; id: string; label: string; parent?: string };

/**
 * `T3`, `S1`, `Q2`: short per-request names for the ids the model may act on.
 * They keep the context small, are easy to copy back without a typo, and make
 * "the model was shown this id" the same thing as "this ref resolves".
 */
export class RefIndex {
  private readonly byAlias = new Map<string, RefEntry>();
  private readonly byId = new Map<string, string>();
  private readonly counters: Record<RefKind, number> = {
    plan: 0,
    section: 0,
    task: 0,
    feature: 0,
    question: 0,
  };

  /** Registers an id (once) and returns its alias. `parent` is the id it belongs under. */
  add(kind: RefKind, id: string, label = "", parent?: string): string {
    const existing = this.byId.get(`${kind}:${id}`);
    if (existing) return existing;
    const alias = `${PREFIX[kind]}${++this.counters[kind]}`;
    this.byAlias.set(alias, { kind, id, label, parent });
    this.byId.set(`${kind}:${id}`, alias);
    return alias;
  }

  aliasOf(kind: RefKind, id: string): string | undefined {
    return this.byId.get(`${kind}:${id}`);
  }

  has(kind: RefKind, id: string): boolean {
    return this.byId.has(`${kind}:${id}`);
  }

  /** An alias (`t3`, `#T3`, `[T3]`) or the exact id the model was shown, back to the id. */
  resolve(kind: RefKind, ref: unknown): string | undefined {
    if (typeof ref !== "string") return undefined;
    const cleaned = ref.trim().replace(/^[#[(]+|[\])]+$/g, "");
    const entry = this.byAlias.get(cleaned.toUpperCase());
    if (entry?.kind === kind) return entry.id;
    // The exact id also works, in either case: a model may have upper-cased what it copied.
    const id = [cleaned, cleaned.toLowerCase()].find((candidate) => this.has(kind, candidate));
    return id;
  }

  parentOf(kind: RefKind, id: string): string | undefined {
    const alias = this.byId.get(`${kind}:${id}`);
    return alias ? this.byAlias.get(alias)?.parent : undefined;
  }

  ids(kind: RefKind): string[] {
    return [...this.byAlias.values()].filter((entry) => entry.kind === kind).map((e) => e.id);
  }

  /** Titles by id, for describing an action in plain words. */
  names(): NameLookup {
    const names: Required<NameLookup> = { plans: {}, sections: {}, tasks: {}, questions: {} };
    for (const entry of this.byAlias.values()) {
      if (!entry.label) continue;
      if (entry.kind === "plan") names.plans[entry.id] = entry.label;
      if (entry.kind === "section") names.sections[entry.id] = entry.label;
      if (entry.kind === "task") names.tasks[entry.id] = entry.label;
      if (entry.kind === "question") names.questions[entry.id] = entry.label;
    }
    return names;
  }
}

export type NameLookup = {
  plans?: Record<string, string>;
  sections?: Record<string, string>;
  tasks?: Record<string, string>;
  questions?: Record<string, string>;
};

// ---------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------

export const ACTION_TYPES = [
  "create_task",
  "update_task",
  "create_section",
  "update_section",
  "add_features",
  "add_steps",
  "ask_question",
  "answer_question",
  "add_comment",
] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

/** Most actions one reply may carry, and most a single audit finding may carry. */
export const MAX_ACTIONS = 25;
export const MAX_FIX_ACTIONS = 8;

const TASK_TITLE_MAX = 200;
const SECTION_TITLE_MAX = 100;
const LONG_TEXT_MAX = 4000;
const NOTE_MAX = 4000;

/** `claimed` belongs to whoever (or whatever) picked the task up, so it is not on offer. */
const STATUSES = ["backlog", "available", "in_progress", "in_review", "done", "blocked"] as const;
const PRIORITIES = Constants.public.Enums.plan_task_priority;
const COMPLEXITIES = Constants.public.Enums.plan_task_complexity;

/** `"In progress"` -> `"in_progress"`: models write enums the way people say them. */
const slug = (value: unknown) =>
  typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
    : value;

const priorityField = z.preprocess(
  (value) => (slug(value) === "urgent" ? "critical" : slug(value)),
  z.enum(PRIORITIES),
);

/** Trimmed and cut to length rather than refused: a long description is still a useful one. */
const clipped = (max: number) =>
  z
    .string()
    .transform((value) => value.trim().slice(0, max))
    .pipe(z.string().min(1));

/** Like `clipped`, but an empty string is allowed: it clears the field. */
const clippedOrEmpty = (max: number) => z.string().transform((value) => value.trim().slice(0, max));

const list = (max: number, items: number) =>
  z
    .array(z.string())
    .transform((values) =>
      values
        .map((value) => value.replace(/\s+/g, " ").trim().slice(0, max))
        .filter(Boolean)
        .slice(0, items),
    )
    .pipe(z.array(z.string()).min(1));

const tagsField = z.array(z.string()).transform((values) => normalizeTags(values.slice(0, 40)));

/** A palette name (`"red"`), a hex value, or null to clear. */
const colorField = z.union([z.string(), z.null()]).transform((value, ctx) => {
  if (value === null || value.trim() === "") return null;
  const named = COLOR_PALETTE.find((entry) => entry.id === value.trim().toLowerCase());
  const parsed = named?.value ?? parseColor(value);
  if (!parsed) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Not a colour." });
    return z.NEVER;
  }
  return parsed;
});

const stepItems = z
  .array(
    z.union([
      z.string().transform((text) => ({ text, depth: 0 })),
      z.object({ text: z.string(), depth: z.number().optional() }).transform((item) => ({
        text: item.text,
        depth: item.depth ?? 0,
      })),
    ]),
  )
  .transform((items) =>
    items
      .map((item) => ({
        text: item.text.replace(/\s+/g, " ").trim().slice(0, STEP_TEXT_MAX),
        depth: Math.max(0, Math.min(MAX_STEP_DEPTH, Math.round(item.depth))),
      }))
      .filter((item) => item.text)
      .slice(0, 30),
  )
  .pipe(z.array(z.object({ text: z.string(), depth: z.number() })).min(1));

const ref = z.string().min(1).max(80);

const createTaskSchema = z.object({
  type: z.literal("create_task"),
  sectionId: ref,
  /** Filled in from the section; the model never supplies it. */
  planId: z.string().optional(),
  title: clipped(TASK_TITLE_MAX),
  description: clipped(LONG_TEXT_MAX).optional(),
  status: z.preprocess(slug, z.enum(STATUSES)).optional(),
  priority: priorityField.optional(),
  complexity: z.preprocess(slug, z.enum(COMPLEXITIES)).optional(),
  tags: tagsField.optional(),
  color: colorField.optional(),
  features: list(FEATURE_TEXT_MAX, 10).optional(),
  steps: list(STEP_TEXT_MAX, 15).optional(),
});

const updateTaskSchema = z.object({
  type: z.literal("update_task"),
  taskId: ref,
  title: clipped(TASK_TITLE_MAX).optional(),
  description: clippedOrEmpty(LONG_TEXT_MAX).optional(),
  status: z.preprocess(slug, z.enum(STATUSES)).optional(),
  priority: priorityField.optional(),
  complexity: z.preprocess(slug, z.enum(COMPLEXITIES)).nullable().optional(),
  tags: tagsField.optional(),
  color: colorField.optional(),
});

const createSectionSchema = z.object({
  type: z.literal("create_section"),
  planId: ref.optional(),
  title: clipped(SECTION_TITLE_MAX),
  description: clipped(LONG_TEXT_MAX).optional(),
  goals: clipped(2000).optional(),
  intentions: clipped(2000).optional(),
  client_summary: clipped(2000).optional(),
  tags: tagsField.optional(),
  color: colorField.optional(),
});

const updateSectionSchema = z.object({
  type: z.literal("update_section"),
  sectionId: ref,
  title: clipped(SECTION_TITLE_MAX).optional(),
  description: clippedOrEmpty(LONG_TEXT_MAX).optional(),
  goals: clippedOrEmpty(2000).optional(),
  intentions: clippedOrEmpty(2000).optional(),
  client_summary: clippedOrEmpty(2000).optional(),
  tags: tagsField.optional(),
  color: colorField.optional(),
});

const addFeaturesSchema = z.object({
  type: z.literal("add_features"),
  taskId: ref,
  items: list(FEATURE_TEXT_MAX, 20),
});

const addStepsSchema = z.object({
  type: z.literal("add_steps"),
  taskId: ref,
  /** The feature these steps deliver, when they all deliver one. */
  featureId: ref.nullable().optional(),
  items: stepItems,
});

const askQuestionSchema = z.object({
  type: z.literal("ask_question"),
  taskId: ref,
  body: clipped(2000),
  /** A blocking question holds the task in "blocked" until someone answers it. */
  blocking: z.boolean().optional(),
});

const answerQuestionSchema = z.object({
  type: z.literal("answer_question"),
  questionId: ref,
  answer: clipped(5000),
});

const addCommentSchema = z.object({
  type: z.literal("add_comment"),
  taskId: ref,
  body: clipped(NOTE_MAX),
});

export const actionSchema = z.discriminatedUnion("type", [
  createTaskSchema,
  updateTaskSchema,
  createSectionSchema,
  updateSectionSchema,
  addFeaturesSchema,
  addStepsSchema,
  askQuestionSchema,
  answerQuestionSchema,
  addCommentSchema,
]);

export type Action = z.infer<typeof actionSchema>;

/** The fields an update must change at least one of, or there is nothing to propose. */
const TASK_FIELDS = [
  "title",
  "description",
  "status",
  "priority",
  "complexity",
  "tags",
  "color",
] as const;
const SECTION_FIELDS = [
  "title",
  "description",
  "goals",
  "intentions",
  "client_summary",
  "tags",
  "color",
] as const;

// ---------------------------------------------------------------------------
// Validating what the model sent
// ---------------------------------------------------------------------------

/** `createTask`, `Create Task` and `create-task` all mean `create_task`. */
function normalizeType(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const type = (raw as Record<string, unknown>).type;
  if (typeof type !== "string") return raw;
  const fixed = type
    .trim()
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return { ...raw, type: fixed };
}

/** The action's shape is valid; its ids are still the model's words. */
export function parseAction(raw: unknown): Action | null {
  const result = actionSchema.safeParse(normalizeType(raw));
  return result.success ? result.data : null;
}

/**
 * Swaps the model's short refs for real ids, and drops the action when any ref
 * it relies on was not in the context. A feature link that does not hold up is
 * removed instead (the steps are still worth adding); everything else is a drop.
 */
export function resolveAction(action: Action, refs: RefIndex): Action | null {
  switch (action.type) {
    case "create_task": {
      const sectionId = refs.resolve("section", action.sectionId);
      const planId = sectionId ? refs.parentOf("section", sectionId) : undefined;
      return sectionId && planId ? { ...action, sectionId, planId } : null;
    }
    case "update_task": {
      const taskId = refs.resolve("task", action.taskId);
      if (!taskId || !TASK_FIELDS.some((field) => action[field] !== undefined)) return null;
      return { ...action, taskId };
    }
    case "create_section": {
      const plans = refs.ids("plan");
      const planId = action.planId ? refs.resolve("plan", action.planId) : plans[0];
      // Without a plan named, the only plan on offer is the obvious one.
      if (!planId || (!action.planId && plans.length !== 1)) return null;
      return { ...action, planId };
    }
    case "update_section": {
      const sectionId = refs.resolve("section", action.sectionId);
      if (!sectionId || !SECTION_FIELDS.some((field) => action[field] !== undefined)) return null;
      return { ...action, sectionId };
    }
    case "add_features":
    case "ask_question":
    case "add_comment": {
      const taskId = refs.resolve("task", action.taskId);
      return taskId ? { ...action, taskId } : null;
    }
    case "add_steps": {
      const taskId = refs.resolve("task", action.taskId);
      if (!taskId) return null;
      const featureId = action.featureId ? refs.resolve("feature", action.featureId) : undefined;
      const linked = featureId && refs.parentOf("feature", featureId) === taskId ? featureId : null;
      return { ...action, taskId, featureId: linked };
    }
    case "answer_question": {
      const questionId = refs.resolve("question", action.questionId);
      return questionId ? { ...action, questionId } : null;
    }
  }
}

/**
 * Everything a model proposed, down to what is valid and grounded in the
 * context. `dropped` counts what did not make it, so the panel can say so.
 */
export function sanitizeActions(
  raw: unknown,
  refs: RefIndex,
  max = MAX_ACTIONS,
): { actions: Action[]; dropped: number } {
  if (!Array.isArray(raw)) return { actions: [], dropped: 0 };
  const actions: Action[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const entry of raw) {
    const parsed = parseAction(entry);
    const resolved = parsed ? resolveAction(parsed, refs) : null;
    if (!resolved) {
      dropped++;
      continue;
    }
    const key = JSON.stringify(resolved);
    if (seen.has(key)) continue;
    seen.add(key);
    if (actions.length >= max) {
      dropped++;
      continue;
    }
    actions.push(resolved);
  }
  return { actions, dropped };
}

// ---------------------------------------------------------------------------
// Reading a reply
// ---------------------------------------------------------------------------

const REPLY_MAX = 6000;

/** Models wrap JSON in fences or add a sentence around it despite being asked not to. */
export function extractJson(raw: string): unknown {
  const text = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}

export type AssistantReply = { reply: string; actions: Action[]; dropped: number };

/**
 * `{reply, actions[]}` from the model. Prose with no JSON in it is still an
 * answer, so it becomes the reply with no actions rather than an error.
 */
export function parseAssistantReply(raw: string, refs: RefIndex): AssistantReply {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { reply: raw.trim().slice(0, REPLY_MAX), actions: [], dropped: 0 };
  }
  const body = parsed as Record<string, unknown>;
  const { actions, dropped } = sanitizeActions(body.actions, refs);
  const said = typeof body.reply === "string" ? body.reply.trim().slice(0, REPLY_MAX) : "";
  const reply = said || (actions.length > 0 ? "Here is what I suggest." : "I have nothing to add.");
  return { reply, actions, dropped };
}

// ---------------------------------------------------------------------------
// Telling a person what an action does
// ---------------------------------------------------------------------------

const STATUS_WORD: Record<string, string> = {
  backlog: "Backlog",
  available: "Available",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  blocked: "Blocked",
};

const quote = (text: string, max = 60) =>
  `"${text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text}"`;

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** One plain-language line for an action: what would change, in words a person would use. */
export function describeAction(action: Action, names: NameLookup = {}): string {
  const task = (id: string) => (names.tasks?.[id] ? `task ${quote(names.tasks[id])}` : "a task");
  const section = (id: string) =>
    names.sections?.[id] ? `section ${quote(names.sections[id])}` : "a section";

  switch (action.type) {
    case "create_task": {
      const extras = [
        action.features && count(action.features.length, "feature"),
        action.steps && count(action.steps.length, "sub-step"),
      ].filter(Boolean);
      return `Create task ${quote(action.title)} in ${section(action.sectionId)}${
        extras.length > 0 ? ` with ${extras.join(" and ")}` : ""
      }`;
    }
    case "update_task": {
      const changes = [
        action.title !== undefined && `rename to ${quote(action.title)}`,
        action.description !== undefined &&
          (action.description ? "rewrite the description" : "clear the description"),
        action.status !== undefined && `set status to ${STATUS_WORD[action.status]}`,
        action.priority !== undefined && `set priority to ${action.priority}`,
        action.complexity !== undefined &&
          (action.complexity ? `set size to ${action.complexity}` : "clear the size"),
        action.tags !== undefined &&
          (action.tags.length > 0 ? `set tags to ${action.tags.join(", ")}` : "clear the tags"),
        action.color !== undefined &&
          (action.color ? `set colour to ${colorLabel(action.color)}` : "clear the colour"),
      ].filter(Boolean);
      return `Update ${task(action.taskId)}: ${changes.join(", ")}`;
    }
    case "create_section":
      return `Create section ${quote(action.title)}`;
    case "update_section": {
      const changes = [
        action.title !== undefined && `rename to ${quote(action.title)}`,
        action.description !== undefined && "rewrite the description",
        action.goals !== undefined && "set the goals",
        action.intentions !== undefined && "set the intentions",
        action.client_summary !== undefined && "set the client summary",
        action.tags !== undefined &&
          (action.tags.length > 0 ? `set tags to ${action.tags.join(", ")}` : "clear the tags"),
        action.color !== undefined &&
          (action.color ? `set colour to ${colorLabel(action.color)}` : "clear the colour"),
      ].filter(Boolean);
      return `Update ${section(action.sectionId)}: ${changes.join(", ")}`;
    }
    case "add_features":
      return `Add ${count(action.items.length, "feature")} to ${task(action.taskId)}: ${action.items
        .slice(0, 3)
        .map((item) => quote(item, 40))
        .join(", ")}${action.items.length > 3 ? ", …" : ""}`;
    case "add_steps":
      return `Add ${count(action.items.length, "sub-step")} to ${task(action.taskId)}${
        action.featureId ? ", linked to a feature" : ""
      }: ${action.items
        .slice(0, 3)
        .map((item) => quote(item.text, 40))
        .join(", ")}${action.items.length > 3 ? ", …" : ""}`;
    case "ask_question":
      return `Ask${action.blocking ? " (blocking)" : ""} on ${task(action.taskId)}: ${quote(action.body, 80)}`;
    case "answer_question": {
      const asked = names.questions?.[action.questionId];
      return `Answer ${asked ? quote(asked, 50) : "a question"}: ${quote(action.answer, 80)}`;
    }
    case "add_comment":
      return `Comment on ${task(action.taskId)}: ${quote(action.body, 80)}`;
  }
}

// ---------------------------------------------------------------------------
// What the model is told about the vocabulary
// ---------------------------------------------------------------------------

export const ACTION_VOCABULARY = [
  'Each action is an object with a "type". Refs (P1, S2, T3, F4, Q5) are the short names from the context; use only refs that appear there and never invent ids. Fields ending in ? are optional.',
  '- {"type":"create_task","sectionId":"S1","title":"…","description"?:"markdown","status"?:"backlog|available|in_progress|in_review|done|blocked","priority"?:"low|medium|high|critical","complexity"?:"trivial|small|medium|large|epic","tags"?:["…"],"color"?:"red|orange|amber|green|teal|blue|violet|pink|slate","features"?:["…"],"steps"?:["…"]}',
  '- {"type":"update_task","taskId":"T3", plus any of: "title","description","status","priority","complexity","tags","color"}  (only the fields that change)',
  '- {"type":"create_section","planId"?:"P1","title":"…","description"?:"…","goals"?:"…","intentions"?:"…","client_summary"?:"short plain Danish summary for the client","tags"?:["…"],"color"?:"…"}',
  '- {"type":"update_section","sectionId":"S1", plus any of: "title","description","goals","intentions","client_summary","tags","color"}',
  '- {"type":"add_features","taskId":"T3","items":["what the task must satisfy, one requirement each"]}',
  '- {"type":"add_steps","taskId":"T3","featureId"?:"F2","items":["how to do it, one concrete sub-step each"]}',
  '- {"type":"ask_question","taskId":"T3","body":"…","blocking"?:true}  (blocking only when the work cannot go on without the answer)',
  '- {"type":"answer_question","questionId":"Q1","answer":"…"}  (only for open questions you can answer from the context)',
  '- {"type":"add_comment","taskId":"T3","body":"…"}',
].join("\n");
