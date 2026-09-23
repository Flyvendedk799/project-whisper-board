import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader, ProgressBar, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useDataMutation } from "@/lib/use-server-action";
import { organizationsQuery, projectListQuery } from "@/data/projects";
import {
  deleteOrganization,
  reassignOrganizationProjects,
  updateOrganization,
} from "@/data/mutations";
import { qk } from "@/data/keys";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from "@/data/enums";

export const Route = createFileRoute("/app/organizations/$orgId")({
  component: OrganizationPage,
});

function OrganizationPage() {
  const { orgId } = Route.useParams();
  const { isAdmin, workspaceId } = useAuth();
  const navigate = useNavigate();
  const orgs = useQuery(organizationsQuery(workspaceId));
  const projects = useQuery(projectListQuery(workspaceId));
  const org = (orgs.data ?? []).find((row) => row.id === orgId);

  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [notes, setNotes] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [mergeInto, setMergeInto] = useState("");

  useEffect(() => {
    if (!org) return;
    setName(org.name);
    setWebsite(org.website ?? "");
    setNotes(org.notes ?? "");
    setLogoUrl(org.logo_url ?? "");
  }, [org]);

  const save = useDataMutation("organizations.update", updateOrganization, {
    success: "Saved",
    invalidate: [qk.organizations(workspaceId ?? undefined), qk.projects()],
  });
  const reassign = useDataMutation("organizations.merge", reassignOrganizationProjects, {
    invalidate: [qk.projects(), qk.organizations(workspaceId ?? undefined)],
  });
  const remove = useDataMutation("organizations.delete", deleteOrganization, {
    success: "Client removed",
    invalidate: [qk.organizations(workspaceId ?? undefined), qk.projects()],
    onSuccess: () => {
      void navigate({ to: "/app/organizations" });
    },
  });

  if (!isAdmin) {
    return <PageHeader title="Clients" description="This directory is for the agency." />;
  }

  return (
    <QueryState query={orgs} errorTitle="Couldn't load this client">
      {() => {
        if (!org) {
          return (
            <div className="mx-auto max-w-3xl px-4 py-8">
              <p className="text-sm text-muted-foreground">That client isn't in this workspace.</p>
            </div>
          );
        }
        const owned = (projects.data ?? []).filter((project) => project.organization_id === org.id);
        const others = (orgs.data ?? []).filter((row) => row.id !== org.id);
        return (
          <>
            <div className="flex items-center gap-2 border-b px-4 py-2 text-sm text-muted-foreground md:px-6">
              <Link to="/app/organizations" className="hover:text-foreground">
                Clients
              </Link>
              <span aria-hidden>/</span>
              <span className="truncate text-foreground">{org.name}</span>
            </div>
            <PageHeader title={org.name} description={org.website ?? undefined} />
            <div className="mx-auto grid max-w-5xl gap-8 px-4 py-6 md:grid-cols-[1fr_18rem] md:px-8">
              <div className="space-y-3">
                <h2 className="font-display text-xl">Projects</h2>
                {owned.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No projects under this client yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {owned.map((project) => (
                      <li key={project.id}>
                        <Link
                          to="/app/projects/$projectId"
                          params={{ projectId: project.id }}
                          className="block rounded-lg border p-4 hover:bg-accent/40"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium">{project.title}</span>
                            <StatusPill tone={PROJECT_STATUS_TONE[project.status]}>
                              {PROJECT_STATUS_LABEL[project.status]}
                            </StatusPill>
                          </div>
                          <ProgressBar
                            value={project.progress}
                            label={`${project.title} progress`}
                            className="mt-3"
                          />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <Card className="h-fit space-y-4 p-5">
                <h2 className="font-display text-xl">Details</h2>
                <form
                  className="space-y-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    save.fire({
                      id: org.id,
                      name: name.trim(),
                      website: website.trim() || null,
                      notes: notes.trim() || null,
                      logoUrl: logoUrl.trim() || null,
                    });
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-org-name">Name</Label>
                    <Input
                      id="edit-org-name"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-org-website">Website</Label>
                    <Input
                      id="edit-org-website"
                      value={website}
                      onChange={(event) => setWebsite(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-org-logo">Logo URL</Label>
                    <Input
                      id="edit-org-logo"
                      value={logoUrl}
                      onChange={(event) => setLogoUrl(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-org-notes">Notes</Label>
                    <Textarea
                      id="edit-org-notes"
                      rows={4}
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                    />
                  </div>
                  <Button type="submit" size="sm" disabled={save.busy}>
                    Save
                  </Button>
                </form>

                {others.length > 0 && (
                  <div className="space-y-2 border-t pt-4">
                    <Label>Merge into</Label>
                    <Select value={mergeInto || undefined} onValueChange={setMergeInto}>
                      <SelectTrigger>
                        <SelectValue placeholder="Another client" />
                      </SelectTrigger>
                      <SelectContent>
                        {others.map((row) => (
                          <SelectItem key={row.id} value={row.id}>
                            {row.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!mergeInto || reassign.busy}
                      onClick={() => {
                        void (async () => {
                          await reassign.run({ fromId: org.id, toId: mergeInto });
                          await remove.run({ id: org.id });
                        })();
                      }}
                    >
                      Merge and delete
                    </Button>
                  </div>
                )}

                <div className="border-t pt-4">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={remove.busy}
                    onClick={() => remove.fire({ id: org.id })}
                  >
                    Delete client
                  </Button>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Projects stay. They just lose this client link.
                  </p>
                </div>
              </Card>
            </div>
          </>
        );
      }}
    </QueryState>
  );
}
