/**
 * How the agent API shapes what it returns: steps and features in order,
 * questions with who asked and who answered, and a one-line progress summary.
 * Pure, so the route stays a thin layer over the database.
 */

export type Who = { kind: "agent" | "person"; id: string; name: string };

export interface QuestionRow {
  asked_by_agent_id: string | null;
  asked_by_user_id: string | null;
  answered_by_agent_id: string | null;
  answered_by_user_id: string | null;
  created_at: string;
}

export interface WhoNames {
  agents: ReadonlyMap<string, string>;
  people: ReadonlyMap<string, string>;
}

export const byPosition = <T extends { position?: number | null }>(rows: readonly T[] | null) =>
  [...(rows ?? [])].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

function who(agentId: string | null, userId: string | null, names: WhoNames): Who | null {
  if (agentId) return { kind: "agent", id: agentId, name: names.agents.get(agentId) ?? "Agent" };
  if (userId) return { kind: "person", id: userId, name: names.people.get(userId) ?? "A teammate" };
  return null;
}

/** Adds `asked_by` and `answered_by` ({ kind, id, name }) to a question, oldest first. */
export function withQuestionAuthors<T extends QuestionRow>(
  questions: readonly T[] | null,
  names: WhoNames,
) {
  return [...(questions ?? [])]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((question) => ({
      ...question,
      asked_by: who(question.asked_by_agent_id, question.asked_by_user_id, names),
      answered_by: who(question.answered_by_agent_id, question.answered_by_user_id, names),
    }));
}

/** The ids a set of questions needs names for. */
export function questionAuthorIds(questions: readonly QuestionRow[]) {
  const agents = new Set<string>();
  const people = new Set<string>();
  for (const question of questions) {
    for (const id of [question.asked_by_agent_id, question.answered_by_agent_id]) {
      if (id) agents.add(id);
    }
    for (const id of [question.asked_by_user_id, question.answered_by_user_id]) {
      if (id) people.add(id);
    }
  }
  return { agents: [...agents], people: [...people] };
}

/** How far a task is: ticked steps, met features, and what is waiting on an answer. */
export function progressSummary(task: {
  steps?: ReadonlyArray<{ done: boolean }> | null;
  features?: ReadonlyArray<{ met: boolean }> | null;
  questions?: ReadonlyArray<{ status: string; blocking: boolean }> | null;
}) {
  const steps = task.steps ?? [];
  const features = task.features ?? [];
  const open = (task.questions ?? []).filter((question) => question.status === "open");
  return {
    steps: { done: steps.filter((step) => step.done).length, total: steps.length },
    features: { met: features.filter((feature) => feature.met).length, total: features.length },
    open_questions: open.length,
    blocking_questions: open.filter((question) => question.blocking).length,
  };
}
