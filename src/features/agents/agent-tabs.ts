/** The tabs of the Agents & MCP guide, shared by the dashboard page and the public one. */
export const AGENT_TABS = ["connect", "tools", "skill", "workflow"] as const;
export type AgentTab = (typeof AGENT_TABS)[number];

export const TAB_LABEL: Record<AgentTab, string> = {
  connect: "Connect",
  tools: "Tools",
  skill: "Skill",
  workflow: "Workflow",
};
