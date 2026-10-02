import { z } from "zod";
import {
  ACTION_VOCABULARY,
  describeAction,
  extractJson,
  MAX_FIX_ACTIONS,
  sanitizeActions,
  type Action,
  type RefIndex,
} from "@/lib/assistant-actions";
import { oneLine } from "@/lib/assistant-context";

/**
 * The words the assistant is given: the system prompt, the preset workflows
 * ("Audit plan", "Draft questions", …), the audit, and the quick assessment
 * the automatic mode runs. Pure, so the prompts and the parsing of what comes
 * back are tested without a model.
 */

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export const PRESET_IDS = [
  "audit_plan",
  "summarize_plan",
  "standup",
  "suggest_tasks",
  "tidy_tags",
  "review_task",
  "write_features",
  "break_into_steps",
  "draft_questions",
] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export type PresetScope = "plan" | "task";

export type PresetDef = {
  id: PresetId;
  label: string;
  /** One line under the button. */
  description: string;
  /** `plan` needs a plan in view; `task` needs a task. */
  scope: PresetScope;
  /** What the model is told to do, on top of the standing instructions. */
  instruction: string;
  /** What the person's side of the conversation says when the preset starts. */
  message: (subject: { plan?: string | null; task?: string | null }) => string;
};

export const PRESETS: Record<PresetId, PresetDef> = {
  audit_plan: {
    id: "audit_plan",
    label: "Audit plan",
    description: "Find gaps, vague tasks and missing detail",
    scope: "plan",
    instruction:
      "Audit the current plan. Read every section and task and look for: tasks with no description or " +
      "acceptance criteria, tasks that are too big to be one task, features or sub-steps that are missing, " +
      "open or blocking questions nobody is answering, duplicated or overlapping tasks, tasks whose status " +
      "does not match their progress, and sections with no goals. Put the findings in the reply, most " +
      "important first, and propose the fixes you are confident in as actions.",
    message: ({ plan }) => `Audit the plan${plan ? ` "${plan}"` : ""}.`,
  },
  summarize_plan: {
    id: "summarize_plan",
    label: "Summarize plan",
    description: "Where the plan stands, in a few lines",
    scope: "plan",
    instruction:
      "Summarize the current plan for someone who has not seen it: what it is for, how far along it is " +
      "(use the counts, do not guess), what is in progress, what is blocked or has open questions, and the " +
      "two or three things that most need attention. Short bullets. Propose no actions.",
    message: ({ plan }) => `Summarize the plan${plan ? ` "${plan}"` : ""}.`,
  },
  standup: {
    id: "standup",
    label: "Standup",
    description: "Done, in progress and blocked, ready to paste",
    scope: "plan",
    instruction:
      "Write a standup update for the current plan in three short groups: Done (tasks marked done), " +
      "In progress (in progress or in review), Blocked / needs an answer (blocked tasks and open " +
      "questions). Name tasks by title, not by ref. Do not invent progress that is not in the context. " +
      "Propose no actions.",
    message: ({ plan }) => `Write a standup${plan ? ` for "${plan}"` : ""}.`,
  },
  suggest_tasks: {
    id: "suggest_tasks",
    label: "Suggest next tasks",
    description: "Tasks the plan seems to be missing",
    scope: "plan",
    instruction:
      "Look at the sections and tasks and suggest the tasks the plan appears to be missing, each placed in " +
      "the section where it belongs. Do not repeat tasks that already exist. Propose at most 8 " +
      "create_task actions, each with a clear title, a short description, and a priority.",
    message: ({ plan }) => `What tasks is${plan ? ` "${plan}"` : " the plan"} missing?`,
  },
  tidy_tags: {
    id: "tidy_tags",
    label: "Tidy tags",
    description: "Consistent tags and colours across the plan",
    scope: "plan",
    instruction:
      "Tidy the tags on the current plan: merge near-duplicates (front-end / frontend), tag untagged tasks " +
      "with the tags already in use where they clearly fit, and give each section a colour where it has " +
      "none. Reuse the tags that exist; add a new tag only when nothing fits. Propose update_task and " +
      "update_section actions that change only tags and colours.",
    message: ({ plan }) => `Tidy the tags${plan ? ` on "${plan}"` : ""}.`,
  },
  review_task: {
    id: "review_task",
    label: "Review task",
    description: "What is missing before this can be started",
    scope: "task",
    instruction:
      "Review the open task: is it clear enough to start? Say what is missing or ambiguous. Where it helps, " +
      "propose an update_task that sharpens the title or description, add_features for missing " +
      "requirements, and ask_question for anything only a person can answer.",
    message: ({ task }) => `Review${task ? ` "${task}"` : " this task"}.`,
  },
  write_features: {
    id: "write_features",
    label: "Write feature list",
    description: "What the task must satisfy, as a checklist",
    scope: "task",
    instruction:
      "Write the feature list for the open task: the requirements it must meet, each one a short, testable " +
      "statement of WHAT (not how). 3 to 10 features. Skip any the task already has. Propose one " +
      "add_features action.",
    message: ({ task }) => `Write the feature list${task ? ` for "${task}"` : ""}.`,
  },
  break_into_steps: {
    id: "break_into_steps",
    label: "Break into sub-steps",
    description: "Concrete steps, linked to the features",
    scope: "task",
    instruction:
      "Break the open task into concrete sub-steps: how to do it, in order, each small enough to tick off " +
      "in one sitting. If the task has features, write the steps for each feature as its own add_steps " +
      "action with featureId set, so every unmet feature is covered. Skip steps the task already has.",
    message: ({ task }) => `Break${task ? ` "${task}"` : " this task"} into sub-steps.`,
  },
  draft_questions: {
    id: "draft_questions",
    label: "Draft questions",
    description: "What to ask before starting",
    scope: "task",
    instruction:
      "Draft the questions that should be answered before the open task is built: unclear requirements, " +
      "missing decisions, unknown constraints. Propose them as ask_question actions, at most 5, most " +
      "important first. Mark a question blocking only if the work genuinely cannot start without the " +
      "answer. Do not repeat questions already open on the task.",
    message: ({ task }) => `Draft questions${task ? ` for "${task}"` : ""}.`,
  },
};

export function isPresetId(value: unknown): value is PresetId {
  return typeof value === "string" && (PRESET_IDS as readonly string[]).includes(value);
}

/** The presets that make sense with what is in view. */
export function presetsFor(view: { plan: boolean; task: boolean }): PresetDef[] {
  return PRESET_IDS.map((id) => PRESETS[id]).filter((preset) =>
    preset.scope === "task" ? view.task : view.plan,
  );
}

// ---------------------------------------------------------------------------
// The assistant
// ---------------------------------------------------------------------------

const STANDING_RULES = [
  "You are the Boared assistant. You work for one person inside their workspace of plans: plan -> sections -> tasks. A task has a description, features (what it must satisfy), sub-steps (how to do it), questions, comments, tags and a status.",
  "You can see only the context below. Say so plainly when something you were asked about is not in it; never make up tasks, progress, ids or facts.",
  'Reply with a single JSON object and nothing else: {"reply": string, "actions": Action[]}.',
  '"reply" is a short answer to the person, plain text with light markdown. "actions" are changes you PROPOSE: the person reviews each one and nothing happens until they accept it. Use [] when no change is wanted.',
  ACTION_VOCABULARY,
  "Rules for actions: only refs from the context; at most 15 actions; do not propose what already exists (check the features, sub-steps and questions listed); keep titles short and specific; make small, precise changes rather than rewriting everything; write in the language the person writes in.",
].join("\n\n");

export function buildAssistantSystemPrompt(input: {
  context: string;
  preset?: PresetId | null;
  truncated?: boolean;
}): string {
  return [
    STANDING_RULES,
    input.preset
      ? `The person started a preset workflow.\n${PRESETS[input.preset].instruction}`
      : "",
    `# Context\n${input.context}${
      input.truncated ? "\n\n(Large plan: some lines were left out to fit.)" : ""
    }`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

type Turn = { role: "user" | "assistant"; content: string };

/**
 * A conversation a provider will accept: empty turns dropped, consecutive
 * turns by the same side merged (an error bubble can leave two user messages
 * in a row), the last `max` kept, and starting with the person.
 */
export function compactHistory(history: readonly Turn[], max = 14): Turn[] {
  const merged: Turn[] = [];
  for (const turn of history) {
    const content = turn.content.trim();
    if (!content) continue;
    const previous = merged[merged.length - 1];
    if (previous?.role === turn.role) previous.content += `\n\n${content}`;
    else merged.push({ role: turn.role, content });
  }
  const recent = merged.slice(-max);
  while (recent.length > 0 && recent[0].role !== "user") recent.shift();
  return recent;
}

/** What goes to the provider: earlier answers go back in the JSON shape they were asked for. */
export function toProviderMessages(
  system: string,
  history: readonly Turn[],
): Array<{ role: "system" | "user" | "assistant"; content: string }> {
  return [
    { role: "system", content: system },
    ...compactHistory(history).map((message) =>
      message.role === "assistant"
        ? {
            role: "assistant" as const,
            content: JSON.stringify({ reply: message.content, actions: [] }),
          }
        : message,
    ),
  ];
}

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

export const MAX_FINDINGS = 12;

export const AUDIT_SEVERITIES = ["high", "medium", "low"] as const;
export type AuditSeverity = (typeof AUDIT_SEVERITIES)[number];

export type AuditFinding = {
  id: string;
  severity: AuditSeverity;
  taskId?: string;
  sectionId?: string;
  title: string;
  detail: string;
  /** What fixing it would change; may be empty when it needs a person's judgement. */
  fix: Action[];
  /** `describeAction` for each of `fix`, written with the names the audit saw. */
  fixSummary: string[];
};

export type AuditResult = { summary: string; findings: AuditFinding[] };

export function buildAuditSystemPrompt(context: string, truncated: boolean): string {
  return [
    "You are the Boared plan auditor. You are shown one plan (sections -> tasks, with counts of features, sub-steps and open questions) and you find what would make it better for the people and AI agents who will work from it.",
    "Look for: tasks with no description or acceptance criteria, tasks too big or too vague to start, missing features or sub-steps, blocking questions nobody has answered, duplicate or overlapping tasks, status that does not match progress, sections with no goals or a muddled scope, and inconsistent tags. Only report what you can see in the context; never invent problems to fill the list.",
    `Reply with a single JSON object and nothing else: {"summary": string, "findings": Finding[]}. "summary" is two or three sentences on the plan's overall shape. Return at most ${MAX_FINDINGS} findings, most important first.`,
    'Finding: {"severity":"high|medium|low","taskId"?:"T3","sectionId"?:"S1","title":"short","detail":"what is wrong and why it matters, one or two sentences","fix":[Action…]}. "fix" holds the actions that would resolve it (at most ' +
      `${MAX_FIX_ACTIONS}); use [] when only a person can decide.`,
    ACTION_VOCABULARY,
    `# Context\n${context}${truncated ? "\n\n(Large plan: some lines were left out to fit.)" : ""}`,
  ].join("\n\n");
}

const slug = (value: unknown) =>
  typeof value === "string"
    ? value
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, "_")
    : value;

const findingSchema = z.object({
  severity: z.preprocess(slug, z.enum(AUDIT_SEVERITIES)).catch("medium"),
  taskId: z.string().max(80).optional().catch(undefined),
  sectionId: z.string().max(80).optional().catch(undefined),
  title: z
    .string()
    .transform((value) => oneLine(value, 140))
    .pipe(z.string().min(1)),
  detail: z
    .string()
    .transform((value) => oneLine(value, 600))
    .catch(""),
  fix: z.array(z.unknown()).catch([]),
});

const SEVERITY_ORDER: Record<AuditSeverity, number> = { high: 0, medium: 1, low: 2 };

/**
 * The model's audit, down to what can be shown and applied. A finding that
 * does not parse is dropped; a finding whose task or section is unknown loses
 * the pointer but keeps its text; every fix is validated like any action.
 */
export function parseAuditReply(raw: string, refs: RefIndex): AuditResult | null {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const body = parsed as Record<string, unknown>;

  const findings: AuditFinding[] = [];
  for (const entry of Array.isArray(body.findings) ? body.findings : []) {
    const result = findingSchema.safeParse(entry);
    if (!result.success) continue;
    const finding = result.data;
    const { actions } = sanitizeActions(finding.fix, refs, MAX_FIX_ACTIONS);
    const names = refs.names();
    findings.push({
      id: "",
      severity: finding.severity,
      taskId: refs.resolve("task", finding.taskId),
      sectionId: refs.resolve("section", finding.sectionId),
      title: finding.title,
      detail: finding.detail,
      fix: actions,
      fixSummary: actions.map((action) => describeAction(action, names)),
    });
    if (findings.length >= MAX_FINDINGS) break;
  }
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  findings.forEach((finding, index) => {
    finding.id = `f${index + 1}`;
  });

  const summary = typeof body.summary === "string" ? oneLine(body.summary, 800) : "";
  return { summary: summary || "Here is what stood out.", findings };
}

// ---------------------------------------------------------------------------
// The quick assessment
// ---------------------------------------------------------------------------

export const ASSESS_NEEDS = ["context", "features", "steps", "questions"] as const;
export type AssessNeed = (typeof ASSESS_NEEDS)[number];

export type Assessment = { needs: AssessNeed[]; note: string };

/** What the task already has, so the assessment does not ask for it again. */
export type AssessFacts = {
  hasRepo: boolean;
  hasAiContext: boolean;
  features: number;
  steps: number;
  openQuestions: number;
};

export function buildAssessPrompt(
  task: { title: string; description?: string | null; acceptance?: string | null; status: string },
  facts: AssessFacts,
): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content:
        "You quickly assess one task on a software plan: what would help whoever builds it? Choose any of: " +
        '"context" (needs technical context from the code: where to change, what exists), "features" (needs ' +
        'a list of what it must satisfy), "steps" (needs breaking into sub-steps), "questions" (is ' +
        "ambiguous: needs questions answered first). Choose none when the task is already clear and small. " +
        'Reply with strict JSON and nothing else: {"needs":["context"|"features"|"steps"|"questions"],"note":"<one short sentence why>"}.',
    },
    {
      role: "user",
      content: [
        `Title: ${task.title}`,
        `Status: ${task.status}`,
        `Description: ${oneLine(task.description, 1500) || "(none)"}`,
        task.acceptance?.trim() ? `Acceptance: ${oneLine(task.acceptance, 500)}` : "",
        `It already has: ${facts.features} feature${facts.features === 1 ? "" : "s"}, ${facts.steps} sub-step${
          facts.steps === 1 ? "" : "s"
        }, ${facts.openQuestions} open question${facts.openQuestions === 1 ? "" : "s"}${
          facts.hasAiContext ? ", AI context" : ""
        }.`,
        facts.hasRepo ? "The plan has a code repository." : "The plan has no code repository.",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];
}

/**
 * The assessment, validated, and without anything the task already has or
 * cannot get (context needs a repository). Null when the answer was not JSON.
 */
export function normalizeAssessment(raw: string, facts: AssessFacts): Assessment | null {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const body = parsed as Record<string, unknown>;

  const asked = Array.isArray(body.needs) ? body.needs.map(slug) : [];
  const needs = ASSESS_NEEDS.filter((need) => asked.includes(need)).filter((need) => {
    if (need === "context") return facts.hasRepo && !facts.hasAiContext;
    if (need === "features") return facts.features === 0;
    if (need === "steps") return facts.steps === 0;
    return facts.openQuestions === 0;
  });
  return { needs, note: typeof body.note === "string" ? oneLine(body.note, 300) : "" };
}
