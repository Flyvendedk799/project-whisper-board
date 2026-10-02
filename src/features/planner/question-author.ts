import type { QuestionWithPeople } from "@/data";

type Person = { full_name?: string | null; email?: string | null } | null | undefined;
type Agent = { name?: string | null } | null | undefined;

function personName(person: Person): string | null {
  return person?.full_name?.trim() || person?.email?.trim() || null;
}

/** Who asked a question, and whether that was an agent. */
export function askerOf(question: QuestionWithPeople): { name: string; agent: boolean } {
  if (question.asked_by_agent_id || question.asked_by_agent) {
    return { name: question.asked_by_agent?.name?.trim() || "An agent", agent: true };
  }
  return { name: personName(question.asked_by_user) ?? "Someone", agent: false };
}

/** Who answered it, or null while it is open. */
export function answererOf(question: QuestionWithPeople): { name: string; agent: boolean } | null {
  if (question.status === "open") return null;
  if (question.answered_by_agent_id || question.answered_by_agent) {
    return { name: (question.answered_by_agent as Agent)?.name?.trim() || "An agent", agent: true };
  }
  const name = personName(question.answered_by_user);
  return name ? { name, agent: false } : null;
}
