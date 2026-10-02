/**
 * Non-destructive import ("sync"): bring a plan up to date with a markdown
 * document without losing progress.
 *
 * Sections and tasks are matched by title. What is missing is added; empty
 * fields (a task's description, its acceptance criteria) are filled in; a
 * section's note is refreshed only when this sync adds tasks to it, because
 * that is when text moved out of the note into those tasks. Nothing is
 * deleted, and status, assignee, claim, pull request, comments, files and
 * ticked steps are never written. Tasks that exist only on the board stay.
 *
 * The logic works against a small store so it can be tested without a database.
 */
import type { PlanMdSection, PlanMdStep, PlanMdTask } from "@/lib/plan-markdown";

export type ExistingStep = { id: string; text: string; position: number };

export type ExistingTask = {
  id: string;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  position: number;
  steps: ExistingStep[];
};

export type ExistingSection = {
  id: string;
  title: string;
  description: string | null;
  position: number;
  tasks: ExistingTask[];
};

export type NewTask = {
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  status: "available" | "done";
  position: number;
};

export type NewStep = {
  taskId: string;
  text: string;
  done: boolean;
  depth: number;
  position: number;
};

export type SyncStore = {
  load(): Promise<ExistingSection[]>;
  createSection(input: {
    title: string;
    description: string | null;
    position: number;
  }): Promise<{ id: string }>;
  updateSection(id: string, patch: { description: string }): Promise<void>;
  /** Rows come back in the order they were given. */
  createTasks(sectionId: string, tasks: NewTask[]): Promise<Array<{ id: string }>>;
  updateTask(
    id: string,
    patch: { description?: string; acceptance_criteria?: string },
  ): Promise<void>;
  createSteps(steps: NewStep[]): Promise<void>;
};

export type SyncOutcome = {
  createdSections: number;
  createdTasks: number;
  createdSteps: number;
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
  return {
    title: task.title,
    description: task.description || null,
    acceptance_criteria: task.acceptance || null,
    status: task.done ? "done" : "available",
    position,
  };
}

function stepRows(
  taskId: string,
  steps: readonly PlanMdStep[],
  from: number,
  maxDepth: number,
  maxText: number,
): NewStep[] {
  return steps.map((step, index) => ({
    taskId,
    text: step.text.slice(0, maxText),
    done: step.done,
    depth: Math.min(step.depth, maxDepth),
    position: from + index + 1,
  }));
}

export async function syncSections(
  store: SyncStore,
  sections: readonly PlanMdSection[],
  limits: { maxStepDepth: number; maxStepText: number },
): Promise<SyncOutcome> {
  const existing = await store.load();
  const out: SyncOutcome = {
    createdSections: 0,
    createdTasks: 0,
    createdSteps: 0,
    matchedSections: 0,
    matchedTasks: 0,
    updatedSections: 0,
    updatedTasks: 0,
  };

  const createTasks = async (sectionId: string, tasks: readonly PlanMdTask[], startAt: number) => {
    if (tasks.length === 0) return;
    const created = await store.createTasks(
      sectionId,
      tasks.map((task, index) => newTaskRow(task, startAt + index + 1)),
    );
    out.createdTasks += created.length;
    const steps = created.flatMap((row, index) =>
      stepRows(row.id, tasks[index]?.steps ?? [], 0, limits.maxStepDepth, limits.maxStepText),
    );
    if (steps.length > 0) {
      await store.createSteps(steps);
      out.createdSteps += steps.length;
    }
  };

  const used = new Set<string>();
  let nextSectionPosition = maxPosition(existing) + 1;

  for (const section of sections) {
    const key = titleKey(section.title);
    const match = existing.find(
      (candidate) => !used.has(candidate.id) && titleKey(candidate.title) === key,
    );

    if (!match) {
      const created = await store.createSection({
        title: section.title,
        description: section.description || null,
        position: nextSectionPosition,
      });
      nextSectionPosition += 1;
      out.createdSections += 1;
      await createTasks(created.id, section.tasks, 0);
      continue;
    }

    used.add(match.id);
    out.matchedSections += 1;

    const taken = new Set<string>();
    const fresh: PlanMdTask[] = [];
    for (const task of section.tasks) {
      const taskKey = titleKey(task.title);
      const found = match.tasks.find(
        (candidate) => !taken.has(candidate.id) && titleKey(candidate.title) === taskKey,
      );
      if (!found) {
        fresh.push(task);
        continue;
      }
      taken.add(found.id);
      out.matchedTasks += 1;

      const patch: { description?: string; acceptance_criteria?: string } = {};
      if (blank(found.description) && task.description) patch.description = task.description;
      if (blank(found.acceptance_criteria) && task.acceptance)
        patch.acceptance_criteria = task.acceptance;
      if (Object.keys(patch).length > 0) {
        await store.updateTask(found.id, patch);
        out.updatedTasks += 1;
      }

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
          ),
        );
        out.createdSteps += missing.length;
      }
    }

    await createTasks(match.id, fresh, maxPosition(match.tasks));

    const note = section.description ?? "";
    if (note && (blank(match.description) || (fresh.length > 0 && note !== match.description))) {
      await store.updateSection(match.id, { description: note });
      out.updatedSections += 1;
    }
  }

  return out;
}
