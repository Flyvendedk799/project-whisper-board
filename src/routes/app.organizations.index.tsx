import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Building2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useDataMutation } from "@/lib/use-server-action";
import { organizationsQuery, projectListQuery, workspaceMembersQuery } from "@/data/projects";
import { ROLE_LABEL } from "@/data/enums";
import { createOrganization } from "@/data/mutations";
import { qk } from "@/data/keys";

export const Route = createFileRoute("/app/organizations/")({
  head: () => ({ meta: [{ title: "Clients · Boared" }] }),
  component: OrganizationsPage,
});

function OrganizationsPage() {
  const { isAdmin, workspaceId } = useAuth();
  const orgs = useQuery(organizationsQuery(workspaceId));
  const projects = useQuery(projectListQuery(workspaceId));
  const members = useQuery(workspaceMembersQuery(workspaceId));
  const clientPeople = (members.data ?? []).filter(
    (member) => member.role === "client" || member.role === "client_admin",
  );

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Clients" />
        <div className="mx-auto max-w-3xl px-4 py-8">
          <Card>
            <EmptyState
              icon={Building2}
              title="Client directory is for the agency"
              description="Your projects are listed under Projects."
            />
          </Card>
        </div>
      </>
    );
  }

  const counts = new Map<string, number>();
  for (const project of projects.data ?? []) {
    if (!project.organization_id || project.status === "archived") continue;
    counts.set(project.organization_id, (counts.get(project.organization_id) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader
        title="Clients"
        description="The same client logins as Team, grouped here with their company when you have one."
        action={<NewOrganizationButton />}
      />
      <div className="mx-auto max-w-5xl px-4 py-6 md:px-8">
        {clientPeople.length > 0 && (
          <Card className="mb-4 p-5">
            <h2 className="font-display text-xl">People</h2>
            <ul className="mt-3 divide-y">
              {clientPeople.map((member) => (
                <li
                  key={member.user_id}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {member.profile?.full_name || member.profile?.email || "Client"}
                  </span>
                  <span className="text-xs text-muted-foreground">{ROLE_LABEL[member.role]}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <QueryState
          query={orgs}
          errorTitle="Couldn't load clients"
          empty={
            clientPeople.length > 0 ? (
              <Card>
                <EmptyState
                  icon={Building2}
                  title="No company record yet"
                  description="Those people can already sign in. Add a company if you want projects grouped under it."
                  action={<NewOrganizationButton />}
                />
              </Card>
            ) : (
              <Card>
                <EmptyState
                  icon={Building2}
                  title="No clients yet"
                  description="Invite someone from a project, or add the company they belong to."
                  action={<NewOrganizationButton />}
                />
              </Card>
            )
          }
        >
          {(rows) => (
            <div className="grid gap-3 md:grid-cols-2">
              {rows.map((org) => (
                <Link
                  key={org.id}
                  to="/app/organizations/$orgId"
                  params={{ orgId: org.id }}
                  className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Card className="h-full p-5 transition-shadow hover:shadow-sm">
                    <h2 className="font-display text-xl">{org.name}</h2>
                    {org.website && (
                      <p className="mt-1 truncate text-sm text-muted-foreground">{org.website}</p>
                    )}
                    <p className="mt-3 text-xs text-muted-foreground">
                      {counts.get(org.id) ?? 0} active projects
                    </p>
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

function NewOrganizationButton() {
  const { workspaceId } = useAuth();
  const [open, setOpen] = useState(false);
  const create = useDataMutation("organizations.insert", createOrganization, {
    success: "Client added",
    invalidate: [qk.organizations(workspaceId ?? undefined)],
    onSuccess: () => setOpen(false),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          New client
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New client</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!workspaceId) return;
            const form = new FormData(event.currentTarget);
            create.fire({
              workspaceId,
              name: String(form.get("name")),
              website: String(form.get("website") || "") || null,
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="org-name">Name</Label>
            <Input id="org-name" name="name" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-website">Website</Label>
            <Input id="org-website" name="website" type="url" placeholder="https://" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.busy}>
              {create.busy ? "Saving…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
