import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, PageHeader, ProgressBar, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { qk } from "@/data/keys";
import { PLAN_STATUS_LABEL } from "@/data/enums";
import { planListQuery } from "@/data/planner";
import { projectListQuery } from "@/data/projects";
import { createPlan } from "@/lib/planner.functions";
import { pluralize } from "@/features/planner/plan-model";
import { cn } from "@/lib/utils";
import type { PlanListItem, PlanStatus } from "@/data";

const plannerSearchSchema = z.object({
  project: z.string().uuid().optional(),
  create: z.coerce.boolean().optional(),
});

type PlannerSearch = z.infer<typeof plannerSearchSchema>;

export const Route = createFileRoute("/app/planner/")({
  validateSearch: plannerSearchSchema,
  component: PlannerIndexPage,
});

/** Same tones the status pill uses everywhere: active is the live one. */
const PLAN_TONE = {
  draft: "default",
  active: "info",
  paused: "warning",
  completed: "success",
  archived: "default",
} as const satisfies Record<PlanStatus, "default" | "info" | "warning" | "success">;

function PlannerIndexPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const { project: filterProjectId, create: openCreate } = Route.useSearch();
  const { workspaceId } = useAuth();
  const plans = useQuery(planListQuery(workspaceId, filterProjectId));
  const projects = useQuery(projectListQuery(workspaceId));
  const [isCreating, setIsCreating] = useState(Boolean(openCreate));

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState(filterProjectId ?? "");

  useEffect(() => {
    if (openCreate) {
      setIsCreating(true);
      setProjectId(filterProjectId ?? "");
    }
  }, [openCreate, filterProjectId]);

  useEffect(() => {
    if (filterProjectId) setProjectId(filterProjectId);
  }, [filterProjectId]);

  const projectById = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects.data ?? []) {
      map.set(project.id, project.title);
    }
    return map;
  }, [projects.data]);

  const filterProjectName = filterProjectId
    ? (projectById.get(filterProjectId) ?? "project")
    : null;

  const create = useServerAction(useServerFn(createPlan), {
    label: "plans.create",
    success: "Plan created",
    invalidate: [qk.plans()],
    onSuccess: (result) => {
      setIsCreating(false);
      setTitle("");
      setDescription("");
      setProjectId("");
      void navigate({
        to: "/app/planner/$planId",
        params: { planId: result.id },
        search: {},
      });
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !workspaceId) return;
    create.fire({
      title: title.trim(),
      description,
      projectId: projectId || undefined,
      workspaceId,
    });
  };

  const closeCreate = (open: boolean) => {
    setIsCreating(open);
    if (!open && openCreate) {
      void navigate({
        search: (prev: PlannerSearch) => ({ ...prev, create: undefined }),
        replace: true,
      });
    }
  };

  const rows = plans.data?.plans ?? [];
  const setProjectFilter = (project: string | undefined) =>
    void navigate({ search: (prev: PlannerSearch) => ({ ...prev, project }) });

  return (
    <>
      <PageHeader
        title="AI Planner"
        description={
          filterProjectName
            ? `${pluralize(rows.length, "plan")} for ${filterProjectName} · tasks your team and agents work through together`
            : `${pluralize(rows.length, "plan")} · tasks your team and agents work through together`
        }
        action={<Button onClick={() => setIsCreating(true)}>New plan</Button>}
      />

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
        {(projects.data?.length ?? 0) > 0 ? (
          <div
            role="group"
            aria-label="Filter by project"
            className="-mt-1 mb-5 flex flex-wrap gap-1.5"
          >
            <FilterChip active={!filterProjectId} onClick={() => setProjectFilter(undefined)}>
              All
            </FilterChip>
            {(projects.data ?? [])
              .filter((project) => project.status !== "archived" || project.id === filterProjectId)
              .map((project) => (
                <FilterChip
                  key={project.id}
                  active={filterProjectId === project.id}
                  onClick={() => setProjectFilter(project.id)}
                >
                  {project.title}
                </FilterChip>
              ))}
          </div>
        ) : null}

        <QueryState
          query={plans}
          errorTitle="Couldn't load plans"
          empty={
            <div className="rounded-[14px] border bg-card">
              <EmptyState
                title={filterProjectName ? `No plans for ${filterProjectName}` : "No AI plans yet"}
                description={
                  filterProjectName
                    ? "Create a plan linked to this project to organize agent work."
                    : "Create a plan to organize tasks and assign them to AI agents."
                }
                action={<Button onClick={() => setIsCreating(true)}>Create a plan</Button>}
              />
            </div>
          }
        >
          {() => (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((plan: PlanListItem) => {
                const total = plan.task_count ?? 0;
                const done = plan.done_task_count ?? 0;
                const percent = total ? (done / total) * 100 : 0;
                const projectTitle =
                  plan.project?.title ??
                  (plan.project_id ? projectById.get(plan.project_id) : null);
                const status = (plan.status ?? "draft") as PlanStatus;

                return (
                  <Link
                    key={plan.id}
                    to="/app/planner/$planId"
                    params={{ planId: plan.id }}
                    search={{}}
                    className="group rounded-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <article className="flex h-full min-h-[150px] flex-col gap-2 rounded-[14px] border bg-card p-5 transition-all group-hover:border-foreground/25 group-hover:shadow-md">
                      <div className="flex items-center justify-between gap-2">
                        <StatusPill tone={PLAN_TONE[status]}>
                          {PLAN_STATUS_LABEL[status]}
                        </StatusPill>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {Math.round(percent)}%
                        </span>
                      </div>
                      <h2 className="font-display text-2xl leading-tight">{plan.title}</h2>
                      <p className="text-xs text-muted-foreground">
                        {projectTitle ?? "No project"}
                      </p>
                      {plan.description ? (
                        <p className="line-clamp-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                          {plan.description}
                        </p>
                      ) : (
                        <span className="flex-1" />
                      )}
                      <ProgressBar
                        value={percent}
                        label={`${plan.title} progress`}
                        className="mt-1.5"
                      />
                      <p className="text-xs text-muted-foreground">
                        {pluralize(plan.section_count ?? 0, "section")} · {done}/{total} tasks
                      </p>
                    </article>
                  </Link>
                );
              })}
            </div>
          )}
        </QueryState>
      </div>

      <Dialog open={isCreating} onOpenChange={closeCreate}>
        <DialogContent className="sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle className="font-display text-[26px] font-normal leading-tight tracking-normal">
              Create new plan
            </DialogTitle>
            <DialogDescription>
              Link a project so the plan shows up on that project&rsquo;s AI Plans tab.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="project" className="text-xs text-muted-foreground">
                Project
              </Label>
              <Select
                value={projectId || "none"}
                onValueChange={(value) => setProjectId(value === "none" ? "" : value)}
              >
                <SelectTrigger id="project">
                  <SelectValue placeholder="Choose a project" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No project</SelectItem>
                  {(projects.data ?? []).map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="title" className="text-xs text-muted-foreground">
                Title
              </Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Implement authentication"
                required
                autoFocus
                maxLength={200}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="description" className="text-xs text-muted-foreground">
                Description
              </Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this plan about?"
                rows={3}
              />
            </div>

            <DialogFooter className="gap-2 sm:space-x-0">
              <Button type="button" variant="outline" onClick={() => closeCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.busy || !title.trim()}>
                {create.busy ? "Creating…" : "Create plan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-[30px] rounded-full border px-3.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "border-primary bg-accent" : "bg-card hover:bg-muted/60",
      )}
    >
      {children}
    </button>
  );
}
