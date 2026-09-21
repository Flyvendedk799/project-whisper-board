import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BrainCircuit, CheckSquare, FolderKanban, LayoutList, X } from "lucide-react";
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
import { EmptyState, PageHeader, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { qk } from "@/data/keys";
import { planListQuery } from "@/data/planner";
import { projectListQuery } from "@/data/projects";
import { createPlan } from "@/lib/planner.functions";
import type { PlanListItem } from "@/data";

const plannerSearchSchema = z.object({
  project: z.string().uuid().optional(),
  create: z.coerce.boolean().optional(),
});

type PlannerSearch = z.infer<typeof plannerSearchSchema>;

export const Route = createFileRoute("/app/planner/")({
  validateSearch: plannerSearchSchema,
  component: PlannerIndexPage,
});

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
      title,
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

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="AI Planner"
        description={
          filterProjectName
            ? `Plans for ${filterProjectName}`
            : `${rows.length} plan${rows.length === 1 ? "" : "s"}`
        }
        action={
          <div className="flex items-center gap-2">
            {filterProjectId && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigate({
                    search: (prev: PlannerSearch) => ({ ...prev, project: undefined }),
                  })
                }
              >
                <X className="mr-1.5 h-3.5 w-3.5" />
                Clear project filter
              </Button>
            )}
            <Button onClick={() => setIsCreating(true)}>
              <BrainCircuit className="mr-2 h-4 w-4" />
              New plan
            </Button>
          </div>
        }
      />

      {(projects.data?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-3 md:px-6 lg:px-8">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Project
          </span>
          <Button
            size="sm"
            variant={!filterProjectId ? "secondary" : "ghost"}
            onClick={() =>
              void navigate({
                search: (prev: PlannerSearch) => ({ ...prev, project: undefined }),
              })
            }
          >
            All
          </Button>
          {(projects.data ?? []).map((project) => (
            <Button
              key={project.id}
              size="sm"
              variant={filterProjectId === project.id ? "secondary" : "ghost"}
              onClick={() =>
                void navigate({
                  search: (prev: PlannerSearch) => ({ ...prev, project: project.id }),
                })
              }
            >
              <FolderKanban className="mr-1.5 h-3.5 w-3.5" />
              {project.title}
            </Button>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <QueryState
          query={plans}
          errorTitle="Couldn't load plans"
          empty={
            <div className="mt-16">
              <EmptyState
                icon={BrainCircuit}
                title={filterProjectName ? `No plans for ${filterProjectName}` : "No AI plans yet"}
                description={
                  filterProjectName
                    ? "Create a plan linked to this project to organize agent work."
                    : "Create a plan to organize tasks and assign them to AI agents."
                }
                action={
                  <Button onClick={() => setIsCreating(true)}>
                    <BrainCircuit className="mr-2 h-4 w-4" />
                    Create a plan
                  </Button>
                }
              />
            </div>
          }
        >
          {() => (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((plan: PlanListItem) => {
                const projectTitle =
                  plan.project?.title ??
                  (plan.project_id ? projectById.get(plan.project_id) : null);

                return (
                  <Link
                    key={plan.id}
                    to="/app/planner/$planId"
                    params={{ planId: plan.id }}
                    className="group flex flex-col justify-between rounded-lg border bg-card p-5 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-4">
                        <h3 className="font-semibold leading-none tracking-tight group-hover:text-primary">
                          {plan.title}
                        </h3>
                        <StatusPill
                          tone={
                            plan.status === "completed"
                              ? "success"
                              : plan.status === "active"
                                ? "info"
                                : "default"
                          }
                        >
                          {plan.status || "draft"}
                        </StatusPill>
                      </div>
                      {plan.description && (
                        <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                          {plan.description}
                        </p>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <LayoutList className="h-3.5 w-3.5" />
                        <span>{plan.section_count ?? 0} sections</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CheckSquare className="h-4 w-4" />
                        <span>
                          {plan.done_task_count ?? 0}/{plan.task_count ?? 0} tasks
                        </span>
                      </div>
                      {projectTitle && (
                        <div className="ml-auto flex max-w-[50%] items-center gap-1 truncate">
                          <FolderKanban className="h-3.5 w-3.5 shrink-0" />
                          <span className="truncate">{projectTitle}</span>
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </QueryState>
      </div>

      <Dialog open={isCreating} onOpenChange={closeCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create new plan</DialogTitle>
            <DialogDescription>
              Link a project so the plan shows up on that project's AI Plans tab and stays in
              context while you work.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="project">Project</Label>
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
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Implement authentication"
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this plan about?"
                rows={3}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => closeCreate(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.busy || !title.trim()}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
