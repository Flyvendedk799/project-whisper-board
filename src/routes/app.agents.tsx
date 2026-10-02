import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AGENT_TABS, AgentsPage, type AgentTab } from "@/features/agents/agents-page";

export const Route = createFileRoute("/app/agents")({
  head: () => ({ meta: [{ title: "Agents & MCP · Boared" }] }),
  validateSearch: z.object({ tab: z.enum(AGENT_TABS).optional() }),
  component: AgentsRoute,
});

function AgentsRoute() {
  const navigate = useNavigate({ from: Route.fullPath });
  const { tab } = Route.useSearch();
  return (
    <AgentsPage
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
