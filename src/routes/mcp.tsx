import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AGENT_TABS, type AgentTab } from "@/features/agents/agent-tabs";
import { PublicAgentsPage } from "@/features/agents/public-agents-page";

const TITLE = "Boared for AI agents: MCP server and skill";
const DESCRIPTION =
  "Connect Claude Code, Cursor or Antigravity to Boared. Download the skill, set up the MCP server and read what every tool does.";

/** Open to everyone. The dashboard's Agents & MCP page (`/app/agents`) is the one for signed-in admins. */
export const Route = createFileRoute("/mcp")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
    ],
  }),
  validateSearch: z.object({ tab: z.enum(AGENT_TABS).optional() }),
  component: PublicAgentsRoute,
});

function PublicAgentsRoute() {
  const navigate = useNavigate({ from: Route.fullPath });
  const { tab } = Route.useSearch();
  return (
    <PublicAgentsPage
      tab={tab ?? "connect"}
      onTabChange={(next: AgentTab) =>
        void navigate({
          search: (prev: { tab?: AgentTab }) => ({ ...prev, tab: next }),
          replace: true,
        })
      }
    />
  );
}
