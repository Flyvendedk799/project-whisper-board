import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader } from "@/components/page-header";
import { EmptyState } from "@/components/status-pill";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useDataMutation, useServerAction } from "@/lib/use-server-action";
import { setClientOrganization } from "@/lib/admin.functions";
import { initials } from "@/lib/utils-format";
import {
  organizationMembersQuery,
  organizationsQuery,
  peopleByOrganization,
  projectListQuery,
  workspaceMembersQuery,
} from "@/data/projects";
import { ROLE_LABEL, type AppRole } from "@/data/enums";
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
  const links = useQuery(organizationMembersQuery(workspaceId));
  const clientPeople = (members.data ?? []).filter(
    (member) => member.role === "client" || member.role === "client_admin",
  );

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Clients" />
        <div className="mx-auto max-w-3xl px-4 py-8">
          <div className="rounded-[14px] border bg-card">
            <EmptyState
              title="Client directory is for the agency"
              description="Your projects are listed under Projects."
            />
          </div>
        </div>
      </>
    );
  }

  const counts = new Map<string, number>();
  for (const project of projects.data ?? []) {
    if (!project.organization_id || project.status === "archived") continue;
    counts.set(project.organization_id, (counts.get(project.organization_id) ?? 0) + 1);
  }
  const peopleByOrg = peopleByOrganization(links.data ?? [], clientPeople);
  const companyOf = new Map<string, string>();
  for (const link of links.data ?? []) {
    if (!companyOf.has(link.user_id)) companyOf.set(link.user_id, link.organization_id);
  }

  return (
    <>
      <PageHeader
        title="Clients"
        description="The same client logins as Team, grouped here with their company when you have one."
        action={<NewOrganizationButton />}
      />
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-4 md:px-8 md:py-7">
        {clientPeople.length > 0 && (
          <section>
            <h2 className="mb-2.5 font-display text-[22px] leading-tight">People</h2>
            <ul className="divide-y overflow-hidden rounded-[14px] border bg-card">
              {clientPeople.map((member) => (
                <PersonRow
                  key={member.user_id}
                  member={member}
                  workspaceId={workspaceId!}
                  orgs={orgs.data ?? []}
                  companyId={companyOf.get(member.user_id)}
                />
              ))}
            </ul>
          </section>
        )}

        <QueryState
          query={orgs}
          errorTitle="Couldn't load clients"
          empty={
            <div className="rounded-[14px] border bg-card">
              <EmptyState
                title={clientPeople.length > 0 ? "No company record yet" : "No clients yet"}
                description={
                  clientPeople.length > 0
                    ? "Those people can already sign in. Add a company if you want projects grouped under it."
                    : "Invite someone from a project, or add the company they belong to."
                }
                action={<NewOrganizationButton />}
              />
            </div>
          }
        >
          {(rows) => (
            <div className="grid gap-3 md:grid-cols-2 md:gap-4">
              {rows.map((org) => (
                <Link
                  key={org.id}
                  to="/app/organizations/$orgId"
                  params={{ orgId: org.id }}
                  className="rounded-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <article className="flex h-full min-h-[120px] flex-col gap-2 rounded-[14px] border bg-card p-5 transition-all hover:border-foreground/25 hover:shadow-md max-md:min-h-0 max-md:p-4 max-md:active:bg-surface">
                    <h2 className="break-words font-display text-2xl leading-tight max-md:text-xl">
                      {org.name}
                    </h2>
                    {org.website && (
                      <p className="truncate text-xs text-muted-foreground">{org.website}</p>
                    )}
                    <p className="mt-auto text-xs text-muted-foreground">
                      {counts.get(org.id) ?? 0} active projects ·{" "}
                      {peopleByOrg.get(org.id)?.length ?? 0} people
                    </p>
                  </article>
                </Link>
              ))}
            </div>
          )}
        </QueryState>
      </div>
    </>
  );
}

function PersonRow({
  member,
  workspaceId,
  orgs,
  companyId,
}: {
  member: {
    user_id: string;
    role: AppRole;
    profile: { full_name: string | null; email: string | null } | null;
  };
  workspaceId: string;
  orgs: Array<{ id: string; name: string }>;
  companyId: string | undefined;
}) {
  const setCompany = useServerAction(useServerFn(setClientOrganization), {
    label: "organizations.setClientOrganization",
    success: "Company updated",
    invalidate: [qk.organizations(workspaceId)],
  });

  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-surface max-md:gap-x-3 max-md:gap-y-2">
      <span
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-semibold"
        aria-hidden="true"
      >
        {initials(member.profile?.full_name ?? member.profile?.email)}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {member.profile?.full_name || member.profile?.email || "Client"}
        </div>
        <div className="truncate text-xs text-muted-foreground">{member.profile?.email}</div>
      </div>
      <Select
        value={companyId ?? "none"}
        disabled={setCompany.busy || orgs.length === 0}
        onValueChange={(value) =>
          setCompany.fire({
            workspaceId,
            userId: member.user_id,
            organizationId: value === "none" ? null : value,
          })
        }
      >
        <SelectTrigger
          className="h-[34px] w-44 max-md:order-last max-md:w-full"
          aria-label="Company"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">No company</SelectItem>
          {orgs.map((org) => (
            <SelectItem key={org.id} value={org.id}>
              {org.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="w-24 text-right text-xs text-muted-foreground max-md:w-auto max-md:shrink-0">
        {ROLE_LABEL[member.role]}
      </span>
    </li>
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
        <Button>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden />
          New client
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">New client</DialogTitle>
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
            <Input
              id="org-name"
              name="name"
              required
              autoComplete="organization"
              enterKeyHint="next"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="org-website">Website</Label>
            <Input
              id="org-website"
              name="website"
              type="url"
              inputMode="url"
              autoComplete="url"
              autoCapitalize="off"
              enterKeyHint="done"
              placeholder="https://"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.busy}>
              {create.busy ? "Saving…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
