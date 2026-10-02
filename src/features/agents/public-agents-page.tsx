import { Link } from "@tanstack/react-router";
import { Download, Github } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TOOL_CATALOG, TOOL_GROUPS } from "../../mcp/tool-catalog";
import { AGENT_TABS, TAB_LABEL, type AgentTab } from "./agent-tabs";
import { ConnectTab } from "./connect-tab";
import { REPO_URL } from "./connect-snippets";
import { downloadSkill } from "./skill-file";
import { SkillTab } from "./skill-tab";
import { ToolsTab } from "./tools-tab";
import { WorkflowTab } from "./workflow-tab";

/**
 * The MCP server and the skill, for anyone: no account needed to read how it works, download the
 * skill or see what the tools do. Only getting a key needs one, so step 1 offers sign-in and
 * sign-up. The dashboard's Agents & MCP page stays as it is, for the people already inside.
 */
export function PublicAgentsPage({
  tab,
  onTabChange,
}: {
  tab: AgentTab;
  onTabChange: (tab: AgentTab) => void;
}) {
  const { user } = useAuth();

  return (
    <div className="min-h-screen">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 md:px-6">
        <Link to="/" className="font-display text-2xl">
          Boared
        </Link>
        <div className="flex items-center gap-1 md:gap-2">
          {user ? (
            <Button asChild>
              <Link to="/app/agents">Open the dashboard</Link>
            </Button>
          ) : (
            <>
              <Button variant="ghost" asChild>
                <Link to="/login">Sign in</Link>
              </Button>
              <Button asChild>
                <Link to="/signup">Get started</Link>
              </Button>
            </>
          )}
        </div>
      </nav>

      <header className="mx-auto max-w-4xl px-4 pb-10 pt-10 text-center md:px-6 md:pb-14 md:pt-16">
        <p className="mb-5 text-xs uppercase tracking-widest text-muted-foreground md:text-sm">
          MCP server · Skill · REST API
        </p>
        <h1 className="font-display text-4xl leading-[1.05] tracking-[-0.02em] md:text-7xl">
          Put an AI agent on your board.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl px-2 text-base text-muted-foreground md:text-lg">
          Connect Claude Code, Cursor or Antigravity to Boared. An agent reads your plans, claims
          and works tasks, picks up the tickets people file, asks when it is unsure, and opens the
          pull request. You watch the card move.
        </p>
        <div className="mx-auto mt-8 flex w-full max-w-md flex-col items-stretch justify-center gap-3 sm:max-w-none sm:flex-row sm:items-center">
          <Button
            size="lg"
            className="w-full sm:w-auto sm:min-w-[12rem]"
            onClick={() => onTabChange("connect")}
          >
            Connect an agent
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="w-full sm:w-auto sm:min-w-[12rem]"
            onClick={downloadSkill}
          >
            <Download className="h-4 w-4" aria-hidden />
            Download the skill
          </Button>
          <Button size="lg" variant="ghost" asChild className="w-full sm:w-auto">
            <a href={REPO_URL} rel="noreferrer">
              <Github className="h-4 w-4" aria-hidden />
              MCP server on GitHub
            </a>
          </Button>
        </div>
        <dl className="mx-auto mt-10 grid max-w-2xl grid-cols-2 gap-4 text-center">
          <Fact term="Tools" value={String(TOOL_CATALOG.length)} />
          <Fact term="Groups" value={String(TOOL_GROUPS.length)} />
        </dl>
      </header>

      <main className="border-t bg-surface">
        <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-10">
          <div
            role="tablist"
            aria-label="Documentation"
            className="mb-6 flex flex-wrap gap-1.5 border-b pb-3"
          >
            {AGENT_TABS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => onTabChange(key)}
                className={cn(
                  "rounded-full border px-3.5 py-1.5 text-sm transition-colors",
                  tab === key
                    ? "border-primary bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {TAB_LABEL[key]}
              </button>
            ))}
          </div>

          {tab === "connect" && <ConnectTab keyAction={<PublicKeyAction signedIn={!!user} />} />}
          {tab === "tools" && <ToolsTab />}
          {tab === "skill" && <SkillTab />}
          {tab === "workflow" && <WorkflowTab />}
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-8 text-sm text-muted-foreground md:px-6">
          <Link to="/" className="font-display text-lg text-foreground">
            Boared
          </Link>
          <span>© {new Date().getFullYear()}</span>
        </div>
      </footer>
    </div>
  );
}

function Fact({ term, value }: { term: string; value: string }) {
  return (
    <div>
      <dd className="font-display text-2xl leading-tight md:text-3xl">{value}</dd>
      <dt className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">{term}</dt>
    </div>
  );
}

/** Getting a key needs an account, so this is where the page asks for one. */
function PublicKeyAction({ signedIn }: { signedIn: boolean }) {
  if (signedIn) {
    return (
      <Button asChild size="sm">
        <Link to="/app/settings" search={{ tab: "api" }}>
          Open Settings &rarr; API keys
        </Link>
      </Button>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm">
          <Link to="/signup">Create an account</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link to="/login">Sign in</Link>
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Then open Settings &rarr; API keys and make a key. Everything else on this page works
        without an account.
      </p>
    </div>
  );
}
