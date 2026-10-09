/**
 * Who has to answer a question: the agency (the person running the plan, the
 * default), the agents, or the client. The same three everywhere a question is
 * shown, so a question reads the same on the task, in the plan's list and in the
 * client's view of it.
 */
export type Audience = "agency" | "agent" | "client";

export const AUDIENCES: readonly Audience[] = ["agency", "agent", "client"];

export const AUDIENCE_LABEL: Record<Audience, string> = {
  agency: "Agency",
  agent: "Agents",
  client: "Client",
};

export const AUDIENCE_HINT: Record<Audience, string> = {
  agency: "For you and the team",
  agent: "An AI agent should answer",
  client: "The client answers, in plain Danish",
};

export function audienceOf(question: { audience?: string | null }): Audience {
  return question.audience === "agent" || question.audience === "client"
    ? question.audience
    : "agency";
}
