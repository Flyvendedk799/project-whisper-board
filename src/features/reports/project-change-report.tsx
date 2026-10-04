import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { projectListQuery } from "@/data/projects";
import { compileProjectChanges, projectChangesQuery, type ChangeFilters } from "@/data/reports";
import { formatDate } from "@/lib/utils-format";

function dateDaysAgo(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function downloadMarkdown(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function ProjectChangeReport({ workspaceId }: { workspaceId: string | null | undefined }) {
  const projects = useQuery(projectListQuery(workspaceId));
  const [projectId, setProjectId] = useState("");
  const [from, setFrom] = useState(() => dateDaysAgo(30));
  const [to, setTo] = useState(() => dateDaysAgo(0));
  const [filters, setFilters] = useState<ChangeFilters>({
    bugs: true,
    features: true,
    source: "all",
    completedOnly: true,
  });
  const changes = useQuery(projectChangesQuery(workspaceId, projectId, from, to));
  const rows = useMemo(
    () =>
      changes.data
        ? compileProjectChanges(
            changes.data.tickets,
            changes.data.linkedTasks,
            changes.data.standaloneTasks,
            filters,
          )
        : [],
    [changes.data, filters],
  );
  const projectName =
    projects.data?.find((project) => project.id === projectId)?.title ?? "Project";

  const exportReport = () => {
    const header = `# ${projectName} — change report\n\nPeriod: ${from} to ${to}\n`;
    const body = rows
      .map(
        (row) =>
          `- **${row.category}**: ${row.title} (${row.source}, ${row.status}, ${row.date.slice(0, 10)})`,
      )
      .join("\n");
    downloadMarkdown(
      `boared-${projectId}-${from}-${to}.md`,
      `${header}\n${body || "No matching changes."}\n`,
    );
  };

  return (
    <section className="rounded-[14px] border bg-card p-5 max-md:p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-[22px]">Project change report</h2>
          <p className="text-sm text-muted-foreground">
            Compile ticket fixes, improvements, additions and finished plan work.
          </p>
        </div>
        <Button
          variant="outline"
          className="max-md:w-full"
          disabled={!projectId || changes.isLoading}
          onClick={exportReport}
        >
          Export Markdown
        </Button>
      </div>
      <div className="grid gap-3 max-md:grid-cols-2 sm:grid-cols-3">
        <div className="space-y-1 max-md:col-span-2">
          <Label htmlFor="report-project">Project</Label>
          <select
            id="report-project"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm max-md:h-11"
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
          >
            <option value="">Choose project</option>
            {(projects.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.title}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="report-from">From</Label>
          <input
            id="report-from"
            type="date"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm max-md:h-11"
            value={from}
            max={to}
            onChange={(event) => setFrom(event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="report-to">To</Label>
          <input
            id="report-to"
            type="date"
            className="w-full rounded-md border bg-background px-3 py-2 text-sm max-md:h-11"
            value={to}
            min={from}
            onChange={(event) => setTo(event.target.value)}
          />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm max-md:flex-col max-md:items-stretch max-md:gap-0">
        <label className="flex items-center gap-2 max-md:min-h-11 max-md:gap-3">
          <input
            type="checkbox"
            className="max-md:h-5 max-md:w-5"
            checked={filters.bugs}
            onChange={(event) => setFilters({ ...filters, bugs: event.target.checked })}
          />
          Bugs / fixes
        </label>
        <label className="flex items-center gap-2 max-md:min-h-11 max-md:gap-3">
          <input
            type="checkbox"
            className="max-md:h-5 max-md:w-5"
            checked={filters.features}
            onChange={(event) => setFilters({ ...filters, features: event.target.checked })}
          />
          Features / additions
        </label>
        <label className="flex items-center gap-2 max-md:min-h-11 max-md:gap-3">
          <input
            type="checkbox"
            className="max-md:h-5 max-md:w-5"
            checked={filters.completedOnly}
            onChange={(event) => setFilters({ ...filters, completedOnly: event.target.checked })}
          />
          Completed only
        </label>
        <label className="flex items-center gap-2 max-md:flex-col max-md:items-stretch max-md:gap-1.5 max-md:pt-2">
          Source
          <select
            className="rounded-md border bg-background px-2 py-1.5 max-md:h-11 max-md:w-full max-md:px-3"
            value={filters.source}
            onChange={(event) =>
              setFilters({ ...filters, source: event.target.value as ChangeFilters["source"] })
            }
          >
            <option value="all">Tickets and plans</option>
            <option value="with_plan">Tickets with plan + plan work</option>
            <option value="without_plan">Tickets without plan</option>
            <option value="plan_only">Plan work only</option>
          </select>
        </label>
      </div>
      {!projectId ? (
        <p className="mt-5 text-sm text-muted-foreground">
          Choose a project to compile its report.
        </p>
      ) : changes.isLoading ? (
        <p className="mt-5 text-sm text-muted-foreground">Compiling report…</p>
      ) : changes.error ? (
        <p className="mt-5 text-sm text-destructive">Could not load project changes.</p>
      ) : (
        <>
          <p className="mt-5 text-xs text-muted-foreground">
            {rows.length} matching changes
            {changes.data?.limited ? " · Showing the first 500 records per source" : ""}
          </p>
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No changes match these filters.</p>
          ) : (
            <ul className="mt-3 divide-y">
              {rows.map((row) => (
                <li
                  key={row.id}
                  className="flex flex-wrap items-center gap-2 py-3 text-sm max-md:gap-y-1.5"
                >
                  <span className="rounded-full border px-2 py-0.5 text-xs max-md:order-1">
                    {row.category}
                  </span>
                  {row.ticketId ? (
                    <Link
                      to="/app/tickets/$ticketId"
                      params={{ ticketId: row.ticketId }}
                      className="min-w-0 flex-1 break-words font-medium hover:underline max-md:order-3 max-md:basis-full"
                    >
                      {row.title}
                    </Link>
                  ) : (
                    <Link
                      to="/app/planner/$planId"
                      params={{ planId: row.planId! }}
                      search={{}}
                      className="min-w-0 flex-1 break-words font-medium hover:underline max-md:order-3 max-md:basis-full"
                    >
                      {row.title}
                    </Link>
                  )}
                  <span className="text-xs text-muted-foreground max-md:order-2 max-md:ml-auto">
                    {row.withPlan ? "Plan" : "Ticket"} · {formatDate(row.date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
