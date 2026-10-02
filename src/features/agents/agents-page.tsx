import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/status-pill";
import { useAuth } from "@/components/auth-provider";
import { AGENT_TABS, TAB_LABEL, type AgentTab } from "./agent-tabs";
import { ConnectTab } from "./connect-tab";
import { SkillTab } from "./skill-tab";
import { ToolsTab } from "./tools-tab";
import { WorkflowTab } from "./workflow-tab";

/** Everything an admin needs to put an AI agent on the board: connect it, see its tools, give it the skill. */
export function AgentsPage({
  tab,
  onTabChange,
}: {
  tab: AgentTab;
  onTabChange: (tab: AgentTab) => void;
}) {
  const { isAdmin } = useAuth();

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Agents & MCP" />
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="rounded-[14px] border bg-card">
            <EmptyState
              title="Admins set up agents"
              description="Ask an admin to connect an agent, or to share an API key with you."
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Agents & MCP"
        description="Connect an AI agent to your plans, and tell it how to work. Anyone can read the same guide, without an account, at /mcp."
        maxWidth="max-w-4xl"
        tabs={AGENT_TABS.map((key) => ({
          id: key,
          label: TAB_LABEL[key],
          active: tab === key,
          onSelect: () => onTabChange(key),
        }))}
      />
      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-7">
        {tab === "connect" && <ConnectTab />}
        {tab === "tools" && <ToolsTab />}
        {tab === "skill" && <SkillTab />}
        {tab === "workflow" && <WorkflowTab />}
      </div>
    </>
  );
}
