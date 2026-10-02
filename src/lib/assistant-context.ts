import { RefIndex } from "@/lib/assistant-actions";

/**
 * What the assistant is told about the platform, as compact text.
 *
 * The model sees the workspace's plans, the plan the person is looking at (with
 * every section and task), the task they have open in full, and a few open
 * tickets. Ids are replaced by short refs (`T3`, `S1`) that are registered as
 * they are written, so a ref exists exactly when the model was shown the thing
 * it names. Everything is size-capped: a big plan loses its tail, not the
 * request.
 *
 * Pure: the server maps database rows into `PlatformData` and this renders it.
 */

export type CtxPlanSummary = {
  title: string;
  status: string;
  projectTitle?: string | null;
  tasks: number;
  done: number;
};

export type CtxSection = {
  id: string;
  title: string;
  description?: string | null;
  goals?: string | null;
  intentions?: string | null;
  tags: string[];
};

export type CtxTask = {
  id: string;
  sectionId: string;
  title: string;
  status: string;
  priority: string;
  complexity?: string | null;
  labels: string[];
  description?: string | null;
  hasAcceptance: boolean;
  features: { total: number; met: number };
  steps: { total: number; done: number };
  openQuestions: number;
  blockingQuestions: number;
  hasAiContext: boolean;
  dependsOn: number;
};

export type CtxPlan = {
  id: string;
  title: string;
  status: string;
  description?: string | null;
  repo?: string | null;
  base?: string | null;
  sections: CtxSection[];
  tasks: CtxTask[];
};

export type CtxTaskDetail = {
  id: string;
  description?: string | null;
  acceptance?: string | null;
  features: Array<{ id: string; text: string; met: boolean }>;
  steps: Array<{
    id: string;
    text: string;
    done: boolean;
    depth: number;
    featureId?: string | null;
  }>;
  questions: Array<{
    id: string;
    body: string;
    blocking: boolean;
    status: string;
    answer?: string | null;
  }>;
  aiContext?: string | null;
  comments: Array<{ author?: string | null; body: string }>;
};

export type CtxTicket = {
  number: number;
  title: string;
  priority: string;
  status: string;
};

export type PlatformData = {
  today: string;
  person?: string | null;
  plans: CtxPlanSummary[];
  plan?: CtxPlan | null;
  task?: CtxTaskDetail | null;
  tickets: CtxTicket[];
};

export const DEFAULT_CONTEXT_CHARS = 14_000;
export const AUDIT_CONTEXT_CHARS = 26_000;

/** Whitespace collapsed and cut to length, for a line that must stay one line. */
export function oneLine(text: string | null | undefined, max: number): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

type Lines = Array<() => string>;

/** Lines until the budget is spent, then a note on how many were left out. */
function fit(heading: string, lines: Lines, budget: number): { text: string; cut: boolean } {
  if (budget < heading.length + 60) return { text: "", cut: lines.length > 0 };
  const out: string[] = [heading];
  let used = heading.length + 1;
  let shown = 0;
  for (const line of lines) {
    const text = line();
    if (used + text.length + 1 > budget - 40) break;
    out.push(text);
    used += text.length + 1;
    shown++;
  }
  const left = lines.length - shown;
  if (left > 0) out.push(`… ${left} more line${left === 1 ? "" : "s"} not shown`);
  return { text: out.join("\n"), cut: left > 0 };
}

function taskLine(task: CtxTask, refs: RefIndex, audit: boolean): string {
  const ref = refs.add("task", task.id, task.title, task.sectionId);
  if (task.status === "done") return `${ref} [done] ${JSON.stringify(oneLine(task.title, 80))}`;

  const facts = [
    task.labels.length > 0 && task.labels.map((tag) => `#${tag}`).join(" "),
    task.features.total > 0 && `features ${task.features.met}/${task.features.total}`,
    task.steps.total > 0 && `steps ${task.steps.done}/${task.steps.total}`,
    task.openQuestions > 0 &&
      `${task.openQuestions} open question${task.openQuestions === 1 ? "" : "s"}${
        task.blockingQuestions > 0 ? ` (${task.blockingQuestions} blocking)` : ""
      }`,
    task.hasAiContext && "has AI context",
    task.dependsOn > 0 && `depends on ${task.dependsOn}`,
    !task.description?.trim() && "no description",
    audit && !task.hasAcceptance && "no acceptance criteria",
    audit && task.description?.trim() && `desc: ${JSON.stringify(oneLine(task.description, 140))}`,
  ].filter(Boolean);

  const size = task.complexity ? `|${task.complexity}` : "";
  return `${ref} [${task.status}|${task.priority}${size}] ${JSON.stringify(
    oneLine(task.title, 100),
  )}${facts.length > 0 ? ` - ${facts.join("; ")}` : ""}`;
}

function planLines(plan: CtxPlan, refs: RefIndex, audit: boolean): Lines {
  const lines: Lines = [];
  const planRef = refs.add("plan", plan.id, plan.title);
  lines.push(
    () =>
      `${planRef} ${JSON.stringify(oneLine(plan.title, 100))} [${plan.status}]${
        plan.repo
          ? ` repo ${plan.repo}${plan.base ? ` (base ${plan.base})` : ""}`
          : " (no repository)"
      }`,
  );
  if (plan.description?.trim()) lines.push(() => `About: ${oneLine(plan.description, 500)}`);

  for (const section of plan.sections) {
    lines.push(() => {
      const ref = refs.add("section", section.id, section.title, plan.id);
      const bits = [
        section.tags.length > 0 && section.tags.map((tag) => `#${tag}`).join(" "),
        section.goals?.trim() && `goals: ${oneLine(section.goals, 160)}`,
        section.intentions?.trim() && `intent: ${oneLine(section.intentions, 160)}`,
        !section.description?.trim() && "no description",
      ].filter(Boolean);
      return `${ref} section ${JSON.stringify(oneLine(section.title, 80))}${
        bits.length > 0 ? ` - ${bits.join("; ")}` : ""
      }`;
    });
    for (const task of plan.tasks.filter((entry) => entry.sectionId === section.id)) {
      lines.push(() => `  ${taskLine(task, refs, audit)}`);
    }
  }
  return lines;
}

function taskDetailLines(task: CtxTaskDetail, summary: CtxTask | undefined, refs: RefIndex): Lines {
  const lines: Lines = [];
  if (summary) lines.push(() => `${taskLine(summary, refs, false)}`);
  else lines.push(() => `${refs.add("task", task.id)} (the open task)`);
  if (task.description?.trim()) lines.push(() => `Description: ${oneLine(task.description, 1500)}`);
  if (task.acceptance?.trim()) lines.push(() => `Acceptance: ${oneLine(task.acceptance, 600)}`);

  if (task.features.length > 0) {
    lines.push(() => "Features:");
    for (const feature of task.features) {
      lines.push(() => {
        const ref = refs.add("feature", feature.id, feature.text, task.id);
        return `  ${ref} [${feature.met ? "x" : " "}] ${oneLine(feature.text, 200)}`;
      });
    }
  }
  if (task.steps.length > 0) {
    lines.push(() => "Sub-steps:");
    for (const step of task.steps) {
      lines.push(() => {
        const link = step.featureId ? refs.aliasOf("feature", step.featureId) : undefined;
        return `  ${"  ".repeat(step.depth)}- [${step.done ? "x" : " "}] ${oneLine(step.text, 160)}${
          link ? ` (${link})` : ""
        }`;
      });
    }
  }
  if (task.questions.length > 0) {
    lines.push(() => "Questions:");
    for (const question of task.questions) {
      lines.push(() => {
        if (question.status !== "open") {
          return `  (${question.status}) ${oneLine(question.body, 140)}${
            question.answer ? ` -> ${oneLine(question.answer, 140)}` : ""
          }`;
        }
        const ref = refs.add("question", question.id, question.body, task.id);
        return `  ${ref} open${question.blocking ? " BLOCKING" : ""}: ${oneLine(question.body, 200)}`;
      });
    }
  }
  if (task.aiContext?.trim())
    lines.push(() => `AI context (excerpt): ${oneLine(task.aiContext, 800)}`);
  if (task.comments.length > 0) {
    lines.push(() => "Recent comments:");
    for (const comment of task.comments) {
      lines.push(() => `  - ${comment.author ?? "someone"}: ${oneLine(comment.body, 200)}`);
    }
  }
  return lines;
}

export type BuiltContext = {
  text: string;
  refs: RefIndex;
  /** Something was left out to stay inside the size cap. */
  truncated: boolean;
};

/**
 * Renders the context. Blocks are written in the order that matters most (the
 * open task, then its plan, then tickets and other plans) and each takes what
 * the others have not reserved, so a huge plan cannot crowd out the task.
 */
export function buildPlatformContext(
  data: PlatformData,
  opts: { maxChars?: number; audit?: boolean } = {},
): BuiltContext {
  const max = opts.maxChars ?? DEFAULT_CONTEXT_CHARS;
  const audit = opts.audit === true;
  const refs = new RefIndex();

  const header = `Today: ${data.today}.${data.person ? ` Signed-in person: ${data.person}.` : ""}`;
  let remaining = max - header.length - 2;
  let truncated = false;
  const blocks: string[] = [header];

  const take = (heading: string, lines: Lines, share: number, reserve: number) => {
    if (lines.length === 0) return;
    const budget = Math.min(Math.floor(max * share), Math.max(0, remaining - reserve));
    const result = fit(heading, lines, budget);
    truncated ||= result.cut;
    if (result.text) {
      blocks.push(result.text);
      remaining -= result.text.length + 2;
    }
  };

  const tickets: Lines = data.tickets.map(
    (ticket) => () =>
      `#${ticket.number} ${JSON.stringify(oneLine(ticket.title, 90))} (${ticket.priority}, ${ticket.status})`,
  );
  const plans: Lines = data.plans.map(
    (plan) => () =>
      `- ${JSON.stringify(oneLine(plan.title, 70))} [${plan.status}]${
        plan.projectTitle ? ` project ${oneLine(plan.projectTitle, 40)}` : ""
      } - ${plan.done}/${plan.tasks} tasks done`,
  );
  const later = Math.floor(
    max * (tickets.length > 0 ? 0.08 : 0) + max * (plans.length > 0 ? 0.1 : 0),
  );

  // The plan is rendered before the task so the task's ref is the plan's ref for it,
  // but the task block is written first in the prompt.
  const planBlock = data.plan ? planLines(data.plan, refs, audit) : [];
  const focused = data.task
    ? data.plan?.tasks.find((entry) => entry.id === data.task!.id)
    : undefined;
  const taskBlock = data.task ? taskDetailLines(data.task, focused, refs) : [];

  take("## Open task (full detail)", taskBlock, 0.32, later + (planBlock.length > 0 ? 1500 : 0));
  take("## Current plan", planBlock, 1, later);
  take("## Open tickets (sample)", tickets, 0.08, 0);
  take("## Plans in this workspace", plans, 0.1, 0);

  return { text: blocks.join("\n\n"), refs, truncated };
}
