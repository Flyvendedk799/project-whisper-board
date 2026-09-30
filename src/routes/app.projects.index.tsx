import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { EmptyState, ProgressBar, StatusPill } from "@/components/status-pill";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useDataMutation } from "@/lib/use-server-action";
import { organizationsQuery, projectListQuery } from "@/data/projects";
import { createOrganization, createProject } from "@/data/mutations";
import { qk } from "@/data/keys";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from "@/data/enums";
import { formatDate } from "@/lib/utils-format";

export const Route = createFileRoute("/app/projects/")({
  component: ProjectsPage,
});

function ProjectsPage() {
  const { isAdmin, workspaceId } = useAuth();
  const projects = useQuery(projectListQuery(workspaceId));
  const [showArchived, setShowArchived] = useState(false);

  return (
    <>
      <PageHeader
        title="Projects"
        description={isAdmin ? "Every engagement you're running." : "What we're building for you."}
        action={
          isAdmin ? (
            <>
              <Button variant="outline" onClick={() => setShowArchived((value) => !value)}>
                {showArchived ? "Hide archived" : "Show archived"}
              </Button>
              <NewProjectButton />
            </>
          ) : undefined
        }
      />

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
        <QueryState
          query={projects}
          errorTitle="Couldn't load projects"
          empty={
            <div className="rounded-[14px] border bg-card">
              <EmptyState
                title="No projects yet"
                description={
                  isAdmin
                    ? "Create one and invite your client — everything else hangs off it."
                    : "Nothing has been shared with you yet. Once your agency adds you to a project, it will appear here."
                }
                action={
                  isAdmin ? (
                    <NewProjectButton />
                  ) : (
                    <Button variant="outline" asChild>
                      <Link to="/app/inbox">Check your inbox</Link>
                    </Button>
                  )
                }
              />
            </div>
          }
        >
          {(data) => {
            const visible = showArchived
              ? data
              : data.filter((project) => project.status !== "archived");
            if (visible.length === 0) {
              return (
                <div className="rounded-[14px] border bg-card">
                  <EmptyState
                    title="No active projects"
                    description="Archived projects are hidden. Choose “Show archived” to find them."
                    action={
                      isAdmin ? (
                        <Button variant="outline" onClick={() => setShowArchived(true)}>
                          Show archived
                        </Button>
                      ) : undefined
                    }
                  />
                </div>
              );
            }
            return (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {visible.map((project) => (
                  <Link
                    key={project.id}
                    to="/app/projects/$projectId"
                    params={{ projectId: project.id }}
                    search={{ tab: undefined, paid: undefined }}
                    className="rounded-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <article className="flex h-full min-h-[150px] flex-col gap-2 rounded-[14px] border bg-card p-5 transition-all hover:border-foreground/25 hover:shadow-md">
                      <div className="flex items-center justify-between gap-2">
                        <StatusPill tone={PROJECT_STATUS_TONE[project.status]}>
                          {PROJECT_STATUS_LABEL[project.status]}
                        </StatusPill>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {project.progress}%
                        </span>
                      </div>

                      <h2 className="font-display text-2xl leading-tight">{project.title}</h2>
                      <p className="text-xs text-muted-foreground">
                        {project.organization?.name ?? "Internal"}
                      </p>
                      {project.description && (
                        <p className="line-clamp-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                          {project.description}
                        </p>
                      )}

                      <ProgressBar
                        value={project.progress}
                        label={`${project.title} progress`}
                        className="mt-1.5"
                      />
                      {project.end_date && (
                        <p className="text-xs text-muted-foreground">
                          Target {formatDate(project.end_date)}
                        </p>
                      )}
                    </article>
                  </Link>
                ))}
              </div>
            );
          }}
        </QueryState>
      </div>
    </>
  );
}

function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const [orgMode, setOrgMode] = useState<"existing" | "new" | "none">("none");
  const [organizationId, setOrganizationId] = useState<string | undefined>();
  const navigate = useNavigate();
  const { workspaceId } = useAuth();
  const orgs = useQuery(organizationsQuery(workspaceId));

  const createOrg = useDataMutation("organizations.insert", createOrganization, {
    invalidate: [[...qk.all, "organizations", workspaceId ?? "none"]],
  });

  const create = useDataMutation("projects.insert", createProject, {
    success: "Project created",
    invalidate: [qk.projects(), qk.projectList(workspaceId ?? undefined)],
    onSuccess: (project) => {
      setOpen(false);
      setOrgMode("none");
      setOrganizationId(undefined);
      void navigate({ to: "/app/projects/$projectId", params: { projectId: project.id } });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setOrgMode("none");
          setOrganizationId(undefined);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          New project
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">New project</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!workspaceId) return;
            const form = new FormData(event.currentTarget);
            const title = String(form.get("title"));
            const description = String(form.get("description")) || null;

            const finish = (organizationId?: string | null) =>
              void create.run({
                title,
                description,
                workspaceId,
                organizationId: organizationId ?? null,
              });

            if (orgMode === "new") {
              const orgName = String(form.get("orgName")).trim();
              if (!orgName) return;
              void createOrg.run({ name: orgName, workspaceId }).then((org) => finish(org.id));
              return;
            }

            finish(orgMode === "existing" ? organizationId : null);
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

          <div className="space-y-1.5">
            <Label htmlFor="org-mode">Client (optional)</Label>
            <Select
              value={orgMode}
              onValueChange={(value) => {
                setOrgMode(value as "existing" | "new" | "none");
                if (value !== "existing") setOrganizationId(undefined);
              }}
            >
              <SelectTrigger id="org-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {(orgs.data?.length ?? 0) > 0 && (
                  <SelectItem value="existing">Existing client</SelectItem>
                )}
                <SelectItem value="new">Create new client</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {orgMode === "existing" && (
            <div className="space-y-1.5">
              <Label htmlFor="organization">Client</Label>
              <Select value={organizationId} onValueChange={setOrganizationId}>
                <SelectTrigger id="organization">
                  <SelectValue placeholder="Pick a client" />
                </SelectTrigger>
                <SelectContent>
                  {(orgs.data ?? []).map((org) => (
                    <SelectItem key={org.id} value={org.id}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {orgMode === "new" && (
            <div className="space-y-1.5">
              <Label htmlFor="org-name">Client name</Label>
              <Input id="org-name" name="orgName" required placeholder="Acme Inc." />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                create.busy ||
                createOrg.busy ||
                !workspaceId ||
                (orgMode === "existing" && !organizationId)
              }
            >
              {create.busy || createOrg.busy ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
