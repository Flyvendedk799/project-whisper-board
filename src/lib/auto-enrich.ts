import { ASSESS_NEEDS, type AssessNeed } from "@/lib/assistant-prompts";

/**
 * Which task the automatic AI looks at next, and when it should stop.
 *
 * It runs in the browser while a plan is open (there is no server cron), one
 * task at a time with a gap between, and only a few per page load: it is
 * background help, not a bulk job on someone's AI subscription. The choosing is
 * pure so the order and the limits are tested.
 */

/** Tasks looked at per page load, the gap between them, and how many failures in a row end the run. */
export const AUTO_ENRICH_SESSION_CAP = 10;
export const AUTO_ENRICH_SPACING_MS = 6_000;
export const AUTO_ENRICH_MAX_ERRORS = 3;

export type EnrichTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  position?: number | null;
  ai_assessed_at?: string | null;
};

export type EnrichPlan = {
  id: string;
  github_repo?: string | null;
  project?: { github_repo?: string | null } | null;
  sections?: ReadonlyArray<{
    position?: number | null;
    tasks?: ReadonlyArray<EnrichTask> | null;
  }> | null;
};

/** The repository the plan's code lives in: its own, else its project's. */
export function planRepo(plan: Pick<EnrichPlan, "github_repo" | "project">): string | null {
  return plan.github_repo?.trim() || plan.project?.github_repo?.trim() || null;
}

/** Work in progress first, then what is ready, then the rest; urgent before idle within each. */
const STATUS_RANK: Record<string, number> = {
  in_progress: 0,
  claimed: 0,
  in_review: 1,
  available: 1,
  blocked: 2,
  backlog: 3,
};
const PRIORITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** Tasks that have not been assessed and are not done, in the order to take them. */
export function enrichQueue(
  plan: EnrichPlan,
  attempted: ReadonlySet<string> = new Set(),
): EnrichTask[] {
  const queue: Array<{ task: EnrichTask; section: number }> = [];
  for (const section of plan.sections ?? []) {
    for (const task of section.tasks ?? []) {
      if (task.status === "done" || task.ai_assessed_at || attempted.has(task.id)) continue;
      if (task.title.trim().length < 3) continue;
      queue.push({ task, section: section.position ?? 0 });
    }
  }
  queue.sort(
    (a, b) =>
      (STATUS_RANK[a.task.status] ?? 4) - (STATUS_RANK[b.task.status] ?? 4) ||
      (PRIORITY_RANK[a.task.priority] ?? 4) - (PRIORITY_RANK[b.task.priority] ?? 4) ||
      a.section - b.section ||
      (a.task.position ?? 0) - (b.task.position ?? 0),
  );
  return queue.map((entry) => entry.task);
}

export function selectNextTask(
  plan: EnrichPlan,
  attempted: ReadonlySet<string> = new Set(),
): EnrichTask | null {
  return enrichQueue(plan, attempted)[0] ?? null;
}

export type EnrichRun = { processed: number; consecutiveErrors: number };

/** Whether another task may be looked at: under the page-load cap and not failing repeatedly. */
export function mayContinue(run: EnrichRun): boolean {
  return run.processed < AUTO_ENRICH_SESSION_CAP && run.consecutiveErrors < AUTO_ENRICH_MAX_ERRORS;
}

/** Context is worth writing only when asked for, with a repository to read, and not already there. */
export function shouldAddContext(
  assessment: { needs: readonly string[] } | null,
  plan: Pick<EnrichPlan, "github_repo" | "project">,
): boolean {
  return Boolean(assessment?.needs.includes("context")) && planRepo(plan) !== null;
}

/** The stored `ai_assessment` json, if it is what `assessTask` writes. */
export function readAssessment(value: unknown): { needs: AssessNeed[]; note: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const asked = Array.isArray(body.needs) ? body.needs : [];
  return {
    needs: ASSESS_NEEDS.filter((need) => asked.includes(need)),
    note: typeof body.note === "string" ? body.note : "",
  };
}
