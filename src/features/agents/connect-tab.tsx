import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Download, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CodeBlock, type CodeDownload } from "./code-block";
import { hostedMcpSnippets, mcpSnippets, REPO_ZIP_URL, type McpSnippets } from "./connect-snippets";

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
      <div className="flex items-start gap-3 max-md:grid max-md:grid-cols-[auto_minmax(0,1fr)] max-md:items-center max-md:gap-y-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent text-sm font-medium text-primary">
          {number}
        </span>
        <div className="min-w-0 flex-1 space-y-3 max-md:contents max-md:space-y-0">
          <h2 className="font-display text-xl leading-7">{title}</h2>
          <div className="space-y-3 max-md:col-span-2 max-md:min-w-0 max-md:[&_code]:break-all">
            {children}
          </div>
        </div>
      </div>
    </section>
  );
}

function clientSnippet(
  client: Client,
  snippets: McpSnippets,
): { caption: string; code: string; hint: string; download?: CodeDownload } {
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
        download: { filename: "mcp.json", type: "application/json" },
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

/** What step 1 says to someone who is signed in: the keys live in their own settings. */
function SignedInKeyStep() {
  return (
    <Button asChild size="sm" className="max-md:h-11 max-md:w-full">
      <Link to="/app/settings" search={{ tab: "api" }}>
        <KeyRound className="h-4 w-4" aria-hidden />
        Open Settings &rarr; API keys
      </Link>
    </Button>
  );
}

/**
 * The four steps that put an agent on the board.
 *
 * `keyAction` is what step 1 offers for getting a key. In the dashboard that is a link into
 * Settings; the public page, where nobody is signed in yet, passes sign-in and sign-up instead.
 */
export function ConnectTab({ keyAction = <SignedInKeyStep /> }: { keyAction?: React.ReactNode }) {
  const origin = useOrigin();
  const [client, setClient] = useState<Client>("claude");
  const [repoPath, setRepoPath] = useState("");
  const snippets = useMemo(() => mcpSnippets({ origin, repoPath }), [origin, repoPath]);
  const shown = clientSnippet(client, snippets);

  const hosted = hostedMcpSnippets(origin);

  return (
    <div className="space-y-4">
      <section className="rounded-[14px] border bg-card p-4 md:p-5">
        <h2 className="font-display text-xl">Hosted MCP</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect over Streamable HTTP at <code className="text-xs">{origin}/api/mcp</code>. Your
          agent opens Boared login in a browser; approve as a workspace admin. No API key goes in
          the config file.
        </p>
        <CodeBlock
          code={hosted.cursor}
          caption="Cursor / clients that support remote MCP URLs"
          download={{ filename: "mcp-hosted.json", type: "application/json" }}
        />
        <p className="mt-2 text-xs text-muted-foreground">{hosted.note}</p>
        <CodeBlock code={hosted.claudeCode} caption="Claude Code (HTTP transport)" />
      </section>

      <Step number={1} title="Local stdio: create an API key">
        <p className="text-sm text-muted-foreground">
          The key decides which workspace an agent can see. Make one per agent or machine so you can
          revoke it on its own. It starts with <code className="text-xs">cpk_</code> and is shown
          once.
        </p>
        <p className="text-sm text-muted-foreground">
          An <strong className="font-medium text-foreground">account</strong> key reaches plans,
          projects and tickets, so an agent can pick up the tickets people file. A{" "}
          <strong className="font-medium text-foreground">planner</strong> key reaches plans only.
        </p>
        {keyAction}
      </Step>

      <Step number={2} title="Add the MCP server to your agent">
        <p className="text-sm text-muted-foreground">
          The server is a small program in the public Boared repository. Clone it and install once.
        </p>
        <CodeBlock code={snippets.install} caption="Run in a terminal" />
        <Button asChild variant="outline" size="sm" className="max-md:h-11 max-md:w-full">
          <a href={REPO_ZIP_URL} rel="noreferrer">
            <Download className="h-3.5 w-3.5" aria-hidden />
            Download as a zip instead
          </a>
        </Button>
        <p className="text-sm text-muted-foreground">
          Then tell the snippet below where you put it.
        </p>
        <div className="max-w-md space-y-1.5">
          <Label htmlFor="agents-repo-path">Path to your Boared checkout</Label>
          <Input
            id="agents-repo-path"
            value={repoPath}
            onChange={(event) => setRepoPath(event.target.value)}
            placeholder="/home/you/boared"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="done"
            spellCheck={false}
          />
        </div>
        <div
          role="tablist"
          aria-label="Agent"
          className="no-scrollbar flex flex-wrap gap-1.5 max-md:-mx-4 max-md:flex-nowrap max-md:overflow-x-auto max-md:px-4"
        >
          {CLIENTS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={client === entry.id}
              onClick={() => setClient(entry.id)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors max-md:h-11 max-md:shrink-0 max-md:whitespace-nowrap max-md:px-4",
                client === entry.id
                  ? "border-primary bg-accent text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <CodeBlock code={shown.code} caption={shown.caption} download={shown.download} />
        <p className="text-xs text-muted-foreground">{shown.hint}</p>
      </Step>

      <Step number={3} title="Keep the key out of your shell history">
        <p className="text-sm text-muted-foreground">
          The server also reads <code className="text-xs">~/.boared.env</code>, so you can leave the
          key out of any config file. Replace <code className="text-xs">cpk_...</code> with your
          key.
        </p>
        <CodeBlock
          code={snippets.env}
          caption="~/.boared.env"
          download={{ filename: ".boared.env" }}
        />
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
