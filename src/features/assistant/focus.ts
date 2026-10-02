/**
 * What the person is looking at, read from the address: the plan, the task open
 * in its drawer, the project. The assistant is told this so "break this into
 * steps" means the task on screen without anyone naming it.
 */

export type AssistantFocus = {
  planId: string | null;
  taskId: string | null;
  projectId: string | null;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PLAN_PATH = new RegExp(`^/app/planner/(${UUID})(?:/|$)`, "i");
const PROJECT_PATH = new RegExp(`^/app/projects/(${UUID})(?:/|$)`, "i");
const UUID_ONLY = new RegExp(`^${UUID}$`, "i");

export const NO_FOCUS: AssistantFocus = { planId: null, taskId: null, projectId: null };

export function focusFromLocation(pathname: string, search: unknown): AssistantFocus {
  const planId = PLAN_PATH.exec(pathname)?.[1] ?? null;
  const projectId = PROJECT_PATH.exec(pathname)?.[1] ?? null;
  const task =
    planId && search && typeof search === "object" ? (search as { task?: unknown }).task : null;
  const taskId = typeof task === "string" && UUID_ONLY.test(task) ? task : null;
  return { planId, taskId, projectId };
}

export function sameFocus(a: AssistantFocus, b: AssistantFocus): boolean {
  return a.planId === b.planId && a.taskId === b.taskId && a.projectId === b.projectId;
}
