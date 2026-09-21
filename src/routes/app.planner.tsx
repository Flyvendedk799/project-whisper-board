import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BrainCircuit, CheckSquare, LayoutList } from "lucide-react";
import { useState } from "react";
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
import type { Row } from "@/data";
import { planListQuery } from "@/data/planner";
import { projectListQuery } from "@/data/projects";
import { createPlan } from "@/lib/planner.functions";

export const Route = createFileRoute("/app/planner")({
  head: () => ({ meta: [{ title: "AI Planner · Consflow" }] }),
  component: PlannerPage,
});

function PlannerPage() {
  const navigate = useNavigate({ from: Route.fullPath });
  const { workspaceId } = useAuth();
  const plans = useQuery(planListQuery(workspaceId));
  const projects = useQuery(projectListQuery(workspaceId));
  const [isCreating, setIsCreating] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState<string>("");

  const create = useServerAction(useServerFn(createPlan), {
    label: "plans.create",
    invalidate: [qk.plans()],
    onSuccess: (result) => {
      setIsCreating(false);
      setTitle("");
      setDescription("");
      setProjectId("");
      void navigate({ to: "/app/planner/$planId", params: { planId: result.id } });
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

  const rows = plans.data?.plans ?? [];

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="AI Planner"
        description={`${rows.length} plan${rows.length === 1 ? "" : "s"}`}
        action={
          <Button onClick={() => setIsCreating(true)}>
            <BrainCircuit className="mr-2 h-4 w-4" />
            New plan
          </Button>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
        <QueryState
          query={plans}
          errorTitle="Couldn't load plans"
          empty={
            <div className="mt-16">
              <EmptyState
                icon={BrainCircuit}
                title="No AI plans yet"
                description="Create a plan to organize tasks and assign them to AI agents."
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
              {rows.map((plan: Row<"plans">) => (
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

                  <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <LayoutList className="h-3.5 w-3.5" />
                      <span>
                        {(plan as Row<"plans"> & { section_count?: number }).section_count || 0}{" "}
                        sections
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CheckSquare className="h-4 w-4" />
                      <span>
                        {(plan as Row<"plans"> & { task_count?: number }).task_count || 0} tasks
                      </span>
                    </div>
                    {plan.project_id && <div className="ml-auto">Linked project</div>}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </QueryState>
      </div>

      <Dialog open={isCreating} onOpenChange={setIsCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create new plan</DialogTitle>
            <DialogDescription>
              Create an AI plan to organize work into tasks and sections.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={onSubmit} className="space-y-4 py-4">
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
            <div className="space-y-2">
              <Label htmlFor="project">Project (optional)</Label>
              <Select
                value={projectId || "none"}
                onValueChange={(value) => setProjectId(value === "none" ? "" : value)}
              >
                <SelectTrigger id="project">
                  <SelectValue placeholder="Link a project" />
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

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreating(false)}>
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
