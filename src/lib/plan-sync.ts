/**
 * Non-destructive import ("sync"): bring a plan up to date with a markdown
 * document without losing progress.
 *
 * Sections and tasks are matched by id when the document carries one (the
 * board's own export does), else by title. What is missing is added; empty
 * fields (a task's description, its acceptance criteria, technical context,
 * colour) are filled in, tags are only ever added, and feature lists and
 * questions gain the entries the task does not have yet. A section's note is
 * refreshed only when this sync adds tasks to it, because that is when text
 * moved out of the note into those tasks (outlines only). Nothing is deleted,
 * and status, assignee, claim, pull request, comments, files, met features,
 * answers and ticked steps are never written. Tasks that exist only on the
 * board stay.
 *
 * The logic works against a small store so it can be tested without a database.
 */
import type { PlanTaskComplexity, PlanTaskPriority, PlanTaskStatus } from "@/data/enums";
import { isValidColor, normalizeTags } from "@/lib/plan-fields";
import type { PlanMdQuestion, PlanMdSection, PlanMdStep, PlanMdTask } from "@/lib/plan-markdown";

export type ExistingStep = {
  id: string;
  text: string;
  position: number;
  feature_id?: string | null;
};

export type ExistingFeature = { id: string; text: string; position: number };

export type ExistingQuestion = { id: string; body: string };

export type ExistingTask = {
  id: string;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  position: number;
  steps: ExistingStep[];
  labels?: string[] | null;
  color?: string | null;
  ai_context?: string | null;
  features?: ExistingFeature[];
  questions?: ExistingQuestion[];
};

export type ExistingSection = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  tasks: ExistingTask[];
  goals?: string | null;
  intentions?: string | null;
  tags?: string[] | null;
};

export type NewTask = {
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  status: PlanTaskStatus;
  position: number;
  priority?: PlanTaskPriority;
  complexity?: PlanTaskComplexity;
  labels?: string[];
  color?: string;
  ai_context?: string;
  /** Where a blocked task goes back to once its blocking question is answered. */
  blocked_from?: PlanTaskStatus;
};

export type NewStep = {
  taskId: string;
  text: string;
  done: boolean;
  depth: number;
  position: number;
  featureId?: string | null;
};

export type NewFeature = { taskId: string; text: string; met: boolean; position: number };

export type NewQuestion = {
  taskId: string;
  body: string;
  blocking: boolean;
  status: "open" | "answered" | "dismissed";
  answer: string | null;
};

export type SyncStore = {
  load(): Promise<ExistingSection[]>;
  createSection(input: {
    title: string;
    description: string | null;
    position: number;
    goals?: string;
    intentions?: string;
    tags?: string[];
    color?: string;
  }): Promise<{ id: string }>;
  updateSection(id: string, patch: { description: string }): Promise<void>;
  /** Fills the goals, intentions and tags of a section that is already there. */
  updateSectionFields?(
    id: string,
    patch: { goals?: string; intentions?: string; tags?: string[] },
  ): Promise<void>;
  /** Rows come back in the order they were given. */
  createTasks(sectionId: string, tasks: NewTask[]): Promise<Array<{ id: string }>>;
  updateTask(
    id: string,
    patch: {
      description?: string;
      acceptance_criteria?: string;
      ai_context?: string;
      color?: string;
      labels?: string[];
    },
  ): Promise<void>;
  createSteps(steps: NewStep[]): Promise<void>;
  /** Rows come back in the order they were given. A store without it skips feature lists. */
  createFeatures?(features: NewFeature[]): Promise<Array<{ id: string }>>;
  /** A store without it skips questions. */
  createQuestions?(questions: NewQuestion[]): Promise<void>;
};

export type SyncOutcome = {
  createdSections: number;
  createdTasks: number;
  createdSteps: number;
  createdFeatures: number;
  createdQuestions: number;
  matchedSections: number;
  matchedTasks: number;
  /** Sections whose note was refreshed because tasks were split out of it. */
  updatedSections: number;
  /** Existing tasks that had an empty description or acceptance filled in. */
  updatedTasks: number;
};

/** Two titles are the same when they read the same without markdown, case or spacing. */
export function titleKey(title: string): string {
  return title
    .replace(/[✅☑✔]️?/gu, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const blank = (text: string | null | undefined) => !text || !text.trim();

function maxPosition(rows: ReadonlyArray<{ position: number }>): number {
  return rows.reduce((max, row) => Math.max(max, row.position), 0);
}

function newTaskRow(task: PlanMdTask, position: number): NewTask {
  const status: PlanTaskStatus = task.status ?? (task.done ? "done" : "available");
  const tags = normalizeTags(task.tags);
  const holdsTask = (task.questions ?? []).some(
    (question) => question.status === "open" && question.blocking,
  );
  return {
    title: task.title,
    description: task.description || null,
    acceptance_criteria: task.acceptance || null,
    status,
    position,
    ...(task.priority && { priority: task.priority }),
    ...(task.size && { complexity: task.size }),
    ...(tags.length > 0 && { labels: tags }),
    ...(isValidColor(task.color) && { color: task.color.trim() }),
    ...(task.context && { ai_context: task.context }),
    // Without this, answering the question would leave a task that was "blocked" on import blocked.
    ...(status === "blocked" && holdsTask && { blocked_from: "available" as const }),
  };
}

function stepRows(
  taskId: string,
  steps: readonly PlanMdStep[],
  from: number,
  maxDepth: number,
  maxText: number,
  featureIds: ReadonlyMap<number, string> = new Map(),
): NewStep[] {
  return steps.map((step, index) => {
    const featureId = step.feature ? featureIds.get(step.feature) : undefined;
    return {
      taskId,
      text: step.text.slice(0, maxText),
      done: step.done,
      depth: Math.min(step.depth, maxDepth),
      position: from + index + 1,
      ...(featureId && { featureId }),
    };
  });
}

export type SyncOptions = {
  /**
   * Refresh a section's note when tasks are added to it. That is right for
   * outlines (text moved out of the note into the tasks) and wrong for the
   * board's own format, whose notes are separate. Default true.
   */
  refreshNotes?: boolean;
};

type Limits = { maxStepDepth: number; maxStepText: number };

const emptyOutcome = (): SyncOutcome => ({
  createdSections: 0,
  createdTasks: 0,
  createdSteps: 0,
  createdFeatures: 0,
  createdQuestions: 0,
  matchedSections: 0,
  matchedTasks: 0,
  updatedSections: 0,
  updatedTasks: 0,
});

const questionRows = (taskId: string, questions: readonly PlanMdQuestion[]): NewQuestion[] =>
  questions.map((entry) => ({
    taskId,
    body: entry.body,
    blocking: entry.blocking,
    status: entry.status,
    answer: entry.answer ?? null,
  }));

/**
 * Creates tasks with everything under them: feature lists first (so steps can
 * point at them), then steps, then questions (a blocking one holds its task).
 */
function taskWriter(store: SyncStore, limits: Limits, out: SyncOutcome) {
  return async (sectionId: string, tasks: readonly PlanMdTask[], startAt: number) => {
    if (tasks.length === 0) return;
    const created = await store.createTasks(
      sectionId,
      tasks.map((task, index) => newTaskRow(task, startAt + index + 1)),
    );
    out.createdTasks += created.length;

    // Per task: feature number (1-based) -> feature id.
    const featureIds = created.map(() => new Map<number, string>());
    if (store.createFeatures) {
      const rows = created.flatMap((row, owner) =>
        (tasks[owner]?.features ?? []).map((feature, at) => ({
          owner,
          number: at + 1,
          row: { taskId: row.id, text: feature.text, met: feature.met, position: at + 1 },
        })),
      );
      if (rows.length > 0) {
        const made = await store.createFeatures(rows.map((entry) => entry.row));
        rows.forEach((entry, at) => {
          if (made[at]) featureIds[entry.owner].set(entry.number, made[at].id);
        });
        out.createdFeatures += made.length;
      }
    }

    const steps = created.flatMap((row, index) =>
      stepRows(
        row.id,
        tasks[index]?.steps ?? [],
        0,
        limits.maxStepDepth,
        limits.maxStepText,
        featureIds[index],
      ),
    );
    if (steps.length > 0) {
      await store.createSteps(steps);
      out.createdSteps += steps.length;
    }

    if (store.createQuestions) {
      const questions = created.flatMap((row, index) =>
        questionRows(row.id, tasks[index]?.questions ?? []),
      );
      if (questions.length > 0) {
        await store.createQuestions(questions);
        out.createdQuestions += questions.length;
      }
    }
  };
}

function sectionExtras(section: PlanMdSection) {
  const tags = normalizeTags(section.tags);
  return {
    ...(section.goals && { goals: section.goals }),
    ...(section.intentions && { intentions: section.intentions }),
    ...(tags.length > 0 && { tags }),
    ...(isValidColor(section.color) && { color: section.color.trim() }),
  };
}

/**
 * Adds every section as new (the `merge` and `replace` imports). Positions
 * continue from `startAt`.
 */
export async function appendSections(
  store: SyncStore,
  sections: readonly PlanMdSection[],
  limits: Limits,
  startAt: number,
): Promise<SyncOutcome> {
  const out = emptyOutcome();
  const createTasks = taskWriter(store, limits, out);
  let position = startAt;
  for (const section of sections) {
    const created = await store.createSection({
      title: section.title,
      description: section.description || null,
      position,
      ...sectionExtras(section),
    });
    position += 1;
    out.createdSections += 1;
    await createTasks(created.id, section.tasks, 0);
  }
  return out;
}

export async function syncSections(
  store: SyncStore,
  sections: readonly PlanMdSection[],
  limits: Limits,
  options: SyncOptions = {},
): Promise<SyncOutcome> {
  const refreshNotes = options.refreshNotes ?? true;
  const existing = await store.load();
  const out = emptyOutcome();
  const createTasks = taskWriter(store, limits, out);

  const used = new Set<string>();
  /** Tasks matched by id, so a title match elsewhere cannot take them twice. */
  const matchedById = new Set<string>();
  const tasksById = new Map(
    existing.flatMap((section) => section.tasks.map((task) => [task.id, task] as const)),
  );
  let nextSectionPosition = maxPosition(existing) + 1;

  /** Feature numbers (1-based) of a document task -> ids, adding the features the task lacks. */
  const settleFeatures = async (found: ExistingTask, task: PlanMdTask) => {
    const ids = new Map<number, string>();
    const wanted = task.features ?? [];
    if (!store.createFeatures || wanted.length === 0) return ids;

    const features = found.features ?? [];
    const known = new Map(features.map((feature) => [titleKey(feature.text), feature.id]));
    const missing: Array<{ key: string; text: string; met: boolean }> = [];
    for (const feature of wanted) {
      const key = titleKey(feature.text);
      if (!known.has(key) && !missing.some((entry) => entry.key === key)) {
        missing.push({ key, text: feature.text, met: feature.met });
      }
    }
    if (missing.length > 0) {
      const from = maxPosition(features);
      const made = await store.createFeatures(
        missing.map((entry, at) => ({
          taskId: found.id,
          text: entry.text,
          met: entry.met,
          position: from + at + 1,
        })),
      );
      out.createdFeatures += made.length;
      missing.forEach((entry, at) => {
        if (made[at]) known.set(entry.key, made[at].id);
      });
    }
    wanted.forEach((feature, index) => {
      const id = known.get(titleKey(feature.text));
      if (id) ids.set(index + 1, id);
    });
    return ids;
  };

  /** Fills what is empty on a task that is already there and adds what it is missing. */
  const fillTask = async (found: ExistingTask, task: PlanMdTask) => {
    out.matchedTasks += 1;

    const patch: Parameters<SyncStore["updateTask"]>[1] = {};
    if (blank(found.description) && task.description) patch.description = task.description;
    if (blank(found.acceptance_criteria) && task.acceptance)
      patch.acceptance_criteria = task.acceptance;
    if (blank(found.ai_context) && task.context) patch.ai_context = task.context;
    if (blank(found.color) && isValidColor(task.color)) patch.color = task.color.trim();
    const haveTags = found.labels ?? [];
    const labels = normalizeTags([...haveTags, ...normalizeTags(task.tags)]);
    if (labels.length > haveTags.length) patch.labels = labels;
    if (Object.keys(patch).length > 0) {
      await store.updateTask(found.id, patch);
      out.updatedTasks += 1;
    }

    const featureIds = await settleFeatures(found, task);

    const have = new Set(found.steps.map((step) => titleKey(step.text)));
    const missing = (task.steps ?? []).filter((step) => !have.has(titleKey(step.text)));
    if (missing.length > 0) {
      await store.createSteps(
        stepRows(
          found.id,
          missing,
          maxPosition(found.steps),
          limits.maxStepDepth,
          limits.maxStepText,
          featureIds,
        ),
      );
      out.createdSteps += missing.length;
    }

    if (store.createQuestions) {
      const asked = new Set((found.questions ?? []).map((question) => titleKey(question.body)));
      const fresh = (task.questions ?? []).filter(
        (question) => !asked.has(titleKey(question.body)),
      );
      if (fresh.length > 0) {
        await store.createQuestions(questionRows(found.id, fresh));
        out.createdQuestions += fresh.length;
      }
    }
  };

  /** The existing task a document task stands for: the same id anywhere, else the same title in `within`. */
  const findTask = (
    task: PlanMdTask,
    within: ExistingSection | null,
    taken: ReadonlySet<string>,
  ): ExistingTask | undefined => {
    const byId = task.id ? tasksById.get(task.id) : undefined;
    if (byId && !matchedById.has(byId.id)) {
      matchedById.add(byId.id);
      return byId;
    }
    if (!within) return undefined;
    const key = titleKey(task.title);
    return within.tasks.find(
      (candidate) =>
        !taken.has(candidate.id) &&
        !matchedById.has(candidate.id) &&
        titleKey(candidate.title) === key,
    );
  };

  /** Matches what can be matched and returns the tasks that are really new. */
  const settleTasks = async (tasks: readonly PlanMdTask[], within: ExistingSection | null) => {
    const fresh: PlanMdTask[] = [];
    const taken = new Set<string>();
    for (const task of tasks) {
      const found = findTask(task, within, taken);
      if (!found) {
        fresh.push(task);
        continue;
      }
      taken.add(found.id);
      await fillTask(found, task);
    }
    return fresh;
  };

  for (const section of sections) {
    const key = titleKey(section.title);
    const byId = section.id ? existing.find((candidate) => candidate.id === section.id) : undefined;
    const match =
      byId && !used.has(byId.id)
        ? byId
        : existing.find(
            (candidate) => !used.has(candidate.id) && titleKey(candidate.title) === key,
          );

    if (!match) {
      const created = await store.createSection({
        title: section.title,
        description: section.description || null,
        position: nextSectionPosition,
        ...sectionExtras(section),
      });
      nextSectionPosition += 1;
      out.createdSections += 1;
      await createTasks(created.id, await settleTasks(section.tasks, null), 0);
      continue;
    }

    used.add(match.id);
    out.matchedSections += 1;

    const fresh = await settleTasks(section.tasks, match);
    await createTasks(match.id, fresh, maxPosition(match.tasks));

    let touched = false;
    const note = section.description ?? "";
    const refresh = refreshNotes && fresh.length > 0 && note !== match.description;
    if (note && (blank(match.description) || refresh)) {
      await store.updateSection(match.id, { description: note });
      touched = true;
    }

    const fields: { goals?: string; intentions?: string; tags?: string[] } = {};
    if (blank(match.goals) && section.goals) fields.goals = section.goals;
    if (blank(match.intentions) && section.intentions) fields.intentions = section.intentions;
    const haveTags = match.tags ?? [];
    const tags = normalizeTags([...haveTags, ...normalizeTags(section.tags)]);
    if (tags.length > haveTags.length) fields.tags = tags;
    if (store.updateSectionFields && Object.keys(fields).length > 0) {
      await store.updateSectionFields(match.id, fields);
      touched = true;
    }
    if (touched) out.updatedSections += 1;
  }

  return out;
}
