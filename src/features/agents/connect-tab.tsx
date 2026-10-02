import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CodeBlock } from "./code-block";
import { mcpSnippets, type McpSnippets } from "./connect-snippets";

type Client = "claude" | "cursor" | "antigravity" | "rest";

const CLIENTS: Array<{ id: Client; label: string }> = [
  { id: "claude", label: "Claude Code" },
  { id: "cursor", label: "Cursor" },
  { id: "antigravity", label: "Antigravity" },
  { id: "rest", label: "No MCP (REST)" },
];

function Step({
  number,
  title,
  children,
}: {
  number: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[14px] border bg-card p-4 md:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-medium text-primary">
          {number}
        </span>
        <div className="min-w-0 flex-1 space-y-3">
          <h2 className="font-display text-xl leading-7">{title}</h2>
          {children}
        </div>
      </div>
    </section>
  );
}

function clientSnippet(client: Client, snippets: McpSnippets) {
  switch (client) {
    case "claude":
      return {
        caption: "Run in a terminal",
        code: snippets.claudeCode,
        hint: "Adds the server for every project. Use --scope project to share it through .mcp.json instead.",
      };
    case "cursor":
      return {
        caption: "~/.cursor/mcp.json (or .cursor/mcp.json in a project)",
        code: snippets.cursor,
        hint: "Restart Cursor, then enable the server under Settings -> MCP.",
      };
    case "antigravity":
      return {
        caption: "Run in a terminal",
        code: snippets.antigravity,
        hint: "Antigravity reads the key from ~/.boared.env, so save the file from the next step too.",
      };
    case "rest":
      return {
        caption: "Any agent that can run curl",
        code: snippets.curl,
        hint: "Every tool is one HTTP request. The Tools tab lists the path of each.",
      };
  }
}

/** The origin Boared is running at, known only in the browser. */
function useOrigin() {
  const [origin, setOrigin] = useState("https://boared.online");
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

export function ConnectTab() {
  const origin = useOrigin();
  const [client, setClient] = useState<Client>("claude");
  const [repoPath, setRepoPath] = useState("");
  const snippets = useMemo(() => mcpSnippets({ origin, repoPath }), [origin, repoPath]);
  const shown = clientSnippet(client, snippets);

  return (
    <div className="space-y-4">
      <Step number={1} title="Create an API key">
        <p className="text-sm text-muted-foreground">
          The key decides which workspace an agent can see. Make one per agent or machine so you can
          revoke it on its own. It starts with <code className="text-xs">cpk_</code> and is shown
          once.
        </p>
        <Button asChild size="sm">
          <Link to="/app/settings" search={{ tab: "api" }}>
            <KeyRound className="h-4 w-4" aria-hidden />
            Open Settings &rarr; API keys
          </Link>
        </Button>
      </Step>

      <Step number={2} title="Add the MCP server to your agent">
        <p className="text-sm text-muted-foreground">
          The server is a small program in the Boared repository. Clone it, run{" "}
          <code className="text-xs">npm install</code> once, and tell the snippet where it lives.
        </p>
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="agents-repo-path">Path to your Boared checkout</Label>
          <Input
            id="agents-repo-path"
            value={repoPath}
            onChange={(event) => setRepoPath(event.target.value)}
            placeholder="/home/you/boared"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div role="tablist" aria-label="Agent" className="flex flex-wrap gap-1.5">
          {CLIENTS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={client === entry.id}
              onClick={() => setClient(entry.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                client === entry.id
                  ? "border-primary bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <CodeBlock code={shown.code} caption={shown.caption} />
        <p className="text-xs text-muted-foreground">{shown.hint}</p>
      </Step>

      <Step number={3} title="Keep the key out of your shell history">
        <p className="text-sm text-muted-foreground">
          The server also reads <code className="text-xs">~/.boared.env</code>, so you can leave the
          key out of any config file. Replace <code className="text-xs">cpk_...</code> with your
          key.
        </p>
        <CodeBlock code={snippets.env} caption="~/.boared.env" />
      </Step>

      <Step number={4} title="Try it">
        <p className="text-sm text-muted-foreground">
          Ask your agent:{" "}
          <em>
            &ldquo;Use the planner to list my active plans, then read the workflow with
            agent_guide.&rdquo;
          </em>{" "}
          It should answer with your plans. The skill (Skill tab) teaches it the rest.
        </p>
      </Step>
    </div>
  );
}
