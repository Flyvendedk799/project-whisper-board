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
import { PageHeader } from "@/components/page-header";
import { ProgressBar, StatusPill } from "@/components/status-pill";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useDataMutation, useServerAction } from "@/lib/use-server-action";
import { useServerFn } from "@tanstack/react-start";
import {
  organizationMembersQuery,
  organizationsQuery,
  peopleByOrganization,
  projectListQuery,
  workspaceMembersQuery,
} from "@/data/projects";
import { deleteOrganization, updateOrganization } from "@/data/mutations";
import { mergeOrganizations, setClientOrganization } from "@/lib/admin.functions";
import { initials } from "@/lib/utils-format";
import { qk } from "@/data/keys";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE, ROLE_LABEL } from "@/data/enums";

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
  const members = useQuery(workspaceMembersQuery(workspaceId));
  const links = useQuery(organizationMembersQuery(workspaceId));

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
  const merge = useServerAction(useServerFn(mergeOrganizations), {
    success: "Client merged",
    invalidate: [qk.projects(), qk.organizations(workspaceId ?? undefined)],
    onSuccess: () => {
      void navigate({ to: "/app/organizations" });
    },
  });
  const setCompany = useServerAction(useServerFn(setClientOrganization), {
    label: "organizations.setClientOrganization",
    success: "Company updated",
    invalidate: [qk.organizations(workspaceId ?? undefined)],
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
        const clientPeople = (members.data ?? []).filter(
          (member) => member.role === "client" || member.role === "client_admin",
        );
        const here = peopleByOrganization(links.data ?? [], clientPeople).get(org.id) ?? [];
        const hereIds = new Set(here.map((person) => person.user_id));
        const addable = clientPeople.filter((person) => !hereIds.has(person.user_id));
        return (
          <>
            <PageHeader
              back={
                <Link to="/app/organizations" className="hover:text-foreground">
                  ← Clients
                </Link>
              }
              title={org.name}
              description={org.website ?? undefined}
            />
            <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 md:grid-cols-[1fr_20rem] md:px-8 md:py-7">
              <div className="space-y-6">
                <section>
                  <h2 className="mb-2.5 font-display text-[22px] leading-tight">Projects</h2>
                  {owned.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No projects under this client yet.
                    </p>
                  ) : (
                    <ul className="divide-y overflow-hidden rounded-[14px] border bg-card">
                      {owned.map((project) => (
                        <li key={project.id}>
                          <Link
                            to="/app/projects/$projectId"
                            params={{ projectId: project.id }}
                            search={{ tab: undefined, paid: undefined }}
                            className="block px-4 py-3.5 hover:bg-surface"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium">{project.title}</span>
                              <span className="flex items-center gap-3">
                                <StatusPill tone={PROJECT_STATUS_TONE[project.status]}>
                                  {PROJECT_STATUS_LABEL[project.status]}
                                </StatusPill>
                                <span className="text-xs tabular-nums text-muted-foreground">
                                  {project.progress}%
                                </span>
                              </span>
                            </div>
                            <ProgressBar
                              value={project.progress}
                              label={`${project.title} progress`}
                              className="mt-2.5 h-1"
                            />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section>
                  <div className="mb-2.5 flex items-center justify-between gap-3">
                    <h2 className="font-display text-[22px] leading-tight">People</h2>
                    {addable.length > 0 && (
                      <Select
                        value=""
                        disabled={setCompany.busy}
                        onValueChange={(userId) =>
                          setCompany.fire({
                            workspaceId: workspaceId!,
                            userId,
                            organizationId: org.id,
                          })
                        }
                      >
                        <SelectTrigger className="h-[34px] w-48" aria-label="Add a person">
                          <SelectValue placeholder="Add a person…" />
                        </SelectTrigger>
                        <SelectContent>
                          {addable.map((person) => (
                            <SelectItem key={person.user_id} value={person.user_id}>
                              {person.profile?.full_name || person.profile?.email || "Client"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                  {here.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Nobody is linked to this company yet.
                    </p>
                  ) : (
                    <ul className="divide-y overflow-hidden rounded-[14px] border bg-card">
                      {here.map((person) => (
                        <li key={person.user_id} className="flex items-center gap-3 px-4 py-3">
                          <span
                            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold"
                            aria-hidden="true"
                          >
                            {initials(person.profile?.full_name ?? person.profile?.email)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">
                              {person.profile?.full_name || person.profile?.email || "Client"}
                            </div>
                            <div className="truncate text-xs text-muted-foreground">
                              {person.profile?.email}
                            </div>
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {ROLE_LABEL[person.role]}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={setCompany.busy}
                            onClick={() =>
                              setCompany.fire({
                                workspaceId: workspaceId!,
                                userId: person.user_id,
                                organizationId: null,
                              })
                            }
                          >
                            Remove
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              <Card className="h-fit space-y-4 rounded-[14px] p-5">
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
                      disabled={!mergeInto || merge.busy}
                      onClick={() => merge.fire({ fromId: org.id, toId: mergeInto })}
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
