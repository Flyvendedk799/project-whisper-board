import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FolderKanban, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState, PageHeader, ProgressBar, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useDataMutation } from "@/lib/use-server-action";
import { projectListQuery } from "@/data/projects";
import { createProject } from "@/data/mutations";
import { qk } from "@/data/keys";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from "@/data/enums";
import { formatDate } from "@/lib/utils-format";

export const Route = createFileRoute("/app/projects/")({
  component: ProjectsPage,
});

function ProjectsPage() {
  const { isAdmin } = useAuth();
  const projects = useQuery(projectListQuery());

  return (
    <>
      <PageHeader
        title="Projects"
        description={isAdmin ? "Every engagement you're running." : "What we're building for you."}
        action={isAdmin ? <NewProjectButton /> : undefined}
      />

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <QueryState
          query={projects}
          errorTitle="Couldn't load projects"
          empty={
            <Card>
              <EmptyState
                icon={FolderKanban}
                title="No projects yet"
                description={
                  isAdmin
                    ? "Create one and invite your client — everything else hangs off it."
                    : "Nothing has been shared with you yet."
                }
                action={isAdmin ? <NewProjectButton /> : undefined}
              />
            </Card>
          }
        >
          {(data) => (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {data.map((project) => (
                <Link
                  key={project.id}
                  to="/app/projects/$projectId"
                  params={{ projectId: project.id }}
                >
                  <Card className="flex h-full flex-col p-5 transition-all hover:border-foreground/20 hover:shadow-sm">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <StatusPill tone={PROJECT_STATUS_TONE[project.status]}>
                        {PROJECT_STATUS_LABEL[project.status]}
                      </StatusPill>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {project.progress}%
                      </span>
                    </div>

                    <h2 className="font-display text-xl">{project.title}</h2>
                    {project.organization && (
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {project.organization.name}
                      </p>
                    )}
                    {project.description && (
                      <p className="mt-2 line-clamp-2 flex-1 text-sm text-muted-foreground">
                        {project.description}
                      </p>
                    )}

                    <ProgressBar
                      value={project.progress}
                      label={`${project.title} progress`}
                      className="mt-4"
                    />
                    {project.end_date && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Target {formatDate(project.end_date)}
                      </p>
                    )}
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </QueryState>
      </div>
    </>
  );
}

function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const create = useDataMutation("projects.insert", createProject, {
    success: "Project created",
    invalidate: [qk.projects()],
    onSuccess: (project) => {
      setOpen(false);
      void navigate({ to: "/app/projects/$projectId", params: { projectId: project.id } });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void create.run({
              title: String(form.get("title")),
              description: String(form.get("description")) || null,
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="project-title">Title</Label>
            <Input id="project-title" name="title" required placeholder="Acme storefront" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-description">What is it?</Label>
            <Textarea id="project-description" name="description" rows={3} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.busy}>
              {create.busy ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
