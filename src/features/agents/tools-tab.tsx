import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/status-pill";
import { searchTools, toolsByGroup, type CatalogTool } from "../../mcp/tool-catalog";

function ToolCard({ tool }: { tool: CatalogTool }) {
  return (
    <details className="group rounded-[14px] border bg-card" data-tool={tool.name}>
      <summary className="flex cursor-pointer list-none flex-col gap-1 px-4 py-3 marker:hidden md:flex-row md:items-baseline md:gap-3">
        <code className="shrink-0 text-sm font-medium">{tool.name}</code>
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">{tool.summary}</span>
      </summary>
      <div className="space-y-3 border-t px-4 py-3 text-sm">
        {tool.description && tool.description !== tool.summary ? (
          <p className="text-muted-foreground">{tool.description}</p>
        ) : null}
        {tool.rest ? (
          <p className="flex flex-wrap items-center gap-2">
            <StatusPill tone={tool.rest.method === "GET" ? "info" : "default"}>
              {tool.rest.method}
            </StatusPill>
            <code className="break-all text-xs">/api/planner/{tool.rest.path}</code>
          </p>
        ) : null}
        {tool.notes ? <p className="text-xs text-muted-foreground">{tool.notes}</p> : null}
        {tool.params.length > 0 ? (
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,12rem)_1fr]">
            {tool.params.map((param) => (
              <div key={param.name} className="contents">
                <dt className="flex flex-wrap items-center gap-1.5">
                  <code className="text-xs">{param.name}</code>
                  <span className="text-xs text-muted-foreground">
                    {param.enum ? param.enum.join(" | ") : param.type}
                  </span>
                  {param.required ? <StatusPill tone="warning">required</StatusPill> : null}
                </dt>
                <dd className="text-muted-foreground">{param.description}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">No parameters.</p>
        )}
      </div>
    </details>
  );
}

export function ToolsTab() {
  const [query, setQuery] = useState("");
  const groups = useMemo(() => toolsByGroup(searchTools(query)), [query]);
  const count = groups.reduce((total, group) => total + group.tools.length, 0);

  return (
    <div className="space-y-5">
      <div className="relative max-w-md">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tools, parameters or paths"
          aria-label="Search tools"
          className="pl-9"
        />
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {count} tool{count === 1 ? "" : "s"}. This list is generated from the same catalog the MCP
        server and the skill are checked against.
      </p>
      {groups.length === 0 ? (
        <div className="rounded-[14px] border bg-card px-6 py-10 text-center text-sm text-muted-foreground">
          No tool matches &ldquo;{query}&rdquo;.
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.group} className="space-y-2">
            <h2 className="font-display text-xl">{group.group}</h2>
            <div className="space-y-2">
              {group.tools.map((tool) => (
                <ToolCard key={tool.name} tool={tool} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
