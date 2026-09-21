import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Bug, GripVertical, Plus, Ticket, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { EmptyState, PageHeader, ProgressBar, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { SectionBoundary } from "@/components/error-boundary";
import { useAuth } from "@/components/auth-provider";
import { MeetingsTab } from "@/components/meetings-tab";
import { UpdatesTab } from "@/components/updates-tab";
import { BillingTab } from "@/components/billing-tab";
import { ProjectTimeline } from "@/features/projects/project-timeline";
import { ProjectAiPlansTab } from "@/features/projects/project-ai-plans";
import { TicketRow } from "@/features/tickets/ticket-row";
import { useServerAction } from "@/lib/use-server-action";
import { inviteClient, setProjectMemberRole } from "@/lib/admin.functions";
import { setMilestoneStatus, setProjectStatus } from "@/lib/tickets.functions";
import { projectMembersQuery, projectMilestonesQuery, projectQuery } from "@/data/projects";
import { projectInvoicesQuery } from "@/data/billing";
import { projectMeetingsQuery } from "@/data/meetings";
import { ticketListQuery } from "@/data/tickets";
import { qk } from "@/data/keys";
import { createMilestone } from "@/data/mutations";
import {
  MILESTONE_STATUSES,
  MILESTONE_STATUS_LABEL,
  MILESTONE_STATUS_TONE,
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
  ROLE_LABEL,
  type MilestoneStatus,
  type ProjectStatus,
} from "@/data/enums";
import { initials } from "@/lib/utils-format";
import { useDataMutation } from "@/lib/use-server-action";

/**
 * The project page. Tabs are lazy: previously all six mounted their queries at
 * once, so opening a project cost eight round trips, five of them for panels
 * nobody was looking at.
 */
export const Route = createFileRoute("/app/projects/$projectId")({
  validateSearch: z.object({ tab: z.string().optional(), paid: z.string().optional() }),
  component: ProjectPage,
});

function ProjectPage() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { user, isAdmin, isClientAdmin, workspaceId } = useAuth();
  const [pendingInvite, setPendingInvite] = useState<string | null>(null);

  const project = useQuery(projectQuery(projectId));
  const requestedTab = search.tab ?? (isAdmin ? "tickets" : "overview");
  const tab =
    !isAdmin && requestedTab === "overview"
      ? "overview"
      : isAdmin && requestedTab === "overview"
        ? "tickets"
        : requestedTab;

  useEffect(() => {
    if (isAdmin && search.tab === "overview") {
      void navigate({
        search: (prev: { tab?: string; paid?: string }) => ({ ...prev, tab: "tickets" }),
        replace: true,
      });
    }
  }, [isAdmin, search.tab, navigate]);

  useEffect(() => {
    if (search.paid !== "1") return;
    toast.success("Payment received — thank you.");
    void navigate({
      search: (prev: { tab?: string; paid?: string }) => ({
        ...prev,
        paid: undefined,
        tab: prev.tab ?? "billing",
      }),
      replace: true,
    });
  }, [search.paid, navigate]);

  return (
    <QueryState query={project} errorTitle="Couldn't load this project">
      {(p) => (
        <>
          <div className="flex items-center gap-2 border-b px-4 py-2 text-sm text-muted-foreground md:px-6 lg:px-8">
            <Link to="/app/projects" className="hover:text-foreground">
              Projects
            </Link>
            <span aria-hidden>/</span>
            <span className="truncate text-foreground">{p.title}</span>
          </div>
          <PageHeader
            title={p.title}
            description={p.description ?? p.organization?.name ?? undefined}
            action={
              <div className="flex flex-wrap gap-2">
                {(isAdmin || isClientAdmin) && (
                  <InviteClientButton
                    projectId={projectId}
                    canChooseRole={isAdmin}
                    onInvited={(email) => {
                      setPendingInvite(email);
                      if (tab !== "people") {
                        void navigate({
                          search: (prev: { tab?: string; paid?: string }) => ({
                            ...prev,
                            tab: "people",
                          }),
                        });
                      }
                    }}
                  />
                )}
                <Button asChild>
                  <Link to="/app/report" search={{ project: projectId, url: undefined }}>
                    <Bug className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Report something
                  </Link>
                </Button>
              </div>
            }
          />

          <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
            <div className="mb-6 flex flex-wrap items-center gap-3 text-sm">
              {isAdmin ? (
                <ProjectStatusSelect projectId={projectId} status={p.status} />
              ) : (
                <StatusPill tone={PROJECT_STATUS_TONE[p.status]}>
                  {PROJECT_STATUS_LABEL[p.status]}
                </StatusPill>
              )}
              <span className="text-muted-foreground">{p.progress}% complete</span>
              <ProgressBar
                value={p.progress}
                label={`${p.title} progress`}
                className="max-w-xs flex-1"
              />
            </div>

            <Tabs
              value={tab}
              onValueChange={(next) =>
                void navigate({
                  search: (prev: { tab?: string; paid?: string }) => ({ ...prev, tab: next }),
                })
              }
            >
              <TabsList className="flex-wrap">
                {!isAdmin && <TabsTrigger value="overview">Overview</TabsTrigger>}
                <TabsTrigger value="tickets">Tickets</TabsTrigger>
                <TabsTrigger value="plans">AI Plans</TabsTrigger>
                <TabsTrigger value="updates">Updates</TabsTrigger>
                <TabsTrigger value="meetings">Meetings</TabsTrigger>
                <TabsTrigger value="milestones">Milestones</TabsTrigger>
                <TabsTrigger value="billing">Billing</TabsTrigger>
                <TabsTrigger value="people">People</TabsTrigger>
              </TabsList>

              {/* Each panel only mounts when it is the active tab. */}
              {!isAdmin && tab === "overview" && (
                <TabsContent value="overview" className="mt-6" forceMount>
                  <SectionBoundary label="project-overview">
                    <OverviewPanel projectId={projectId} project={p} />
                  </SectionBoundary>
                </TabsContent>
              )}

              {tab === "tickets" && (
                <TabsContent value="tickets" className="mt-6" forceMount>
                  <SectionBoundary label="project-tickets">
                    <TicketsPanel
                      projectId={projectId}
                      viewerId={user?.id ?? ""}
                      workspaceId={workspaceId}
                    />
                  </SectionBoundary>
                </TabsContent>
              )}

              {tab === "plans" && (
                <TabsContent value="plans" className="mt-6" forceMount>
                  <SectionBoundary label="project-plans">
                    <ProjectAiPlansTab projectId={projectId} />
                  </SectionBoundary>
                </TabsContent>
              )}

              {tab === "updates" && (
                <TabsContent value="updates" className="mt-6" forceMount>
                  <SectionBoundary label="project-updates">
                    <UpdatesTab projectId={projectId} />
                  </SectionBoundary>
                </TabsContent>
              )}

              {tab === "meetings" && (
                <TabsContent value="meetings" className="mt-6" forceMount>
                  <SectionBoundary label="project-meetings">
                    <MeetingsTab projectId={projectId} />
                  </SectionBoundary>
                </TabsContent>
              )}

              {tab === "milestones" && (
                <TabsContent value="milestones" className="mt-6" forceMount>
                  <SectionBoundary label="project-milestones">
                    <MilestonesPanel projectId={projectId} canEdit={isAdmin} />
                  </SectionBoundary>
                </TabsContent>
              )}

              {tab === "billing" && (
                <TabsContent value="billing" className="mt-6" forceMount>
                  <SectionBoundary label="project-billing">
                    <BillingTab projectId={projectId} currency={p.currency} />
                  </SectionBoundary>
                </TabsContent>
              )}

              {tab === "people" && (
                <TabsContent value="people" className="mt-6" forceMount>
                  <SectionBoundary label="project-people">
                    <PeoplePanel
                      projectId={projectId}
                      canInvite={isAdmin || isClientAdmin}
                      canManageRoles={isAdmin}
                      pendingInvite={pendingInvite}
                      onPendingInviteChange={setPendingInvite}
                    />
                  </SectionBoundary>
                </TabsContent>
              )}
            </Tabs>
          </div>
        </>
      )}
    </QueryState>
  );
}

function OverviewPanel({
  projectId,
  project,
}: {
  projectId: string;
  project: Parameters<typeof ProjectTimeline>[0]["project"];
}) {
  const milestones = useQuery(projectMilestonesQuery(projectId));
  const meetings = useQuery(projectMeetingsQuery(projectId));
  const invoices = useQuery(projectInvoicesQuery(projectId));

  return (
    <ProjectTimeline
      project={project}
      milestones={milestones.data ?? []}
      meetings={meetings.data ?? []}
      invoices={invoices.data ?? []}
    />
  );
}

function TicketsPanel({
  projectId,
  viewerId,
  workspaceId,
}: {
  projectId: string;
  viewerId: string;
  workspaceId: string | null;
}) {
  const tickets = useInfiniteQuery({
    ...ticketListQuery({ projectId, sort: "updated" }, viewerId, workspaceId),
    enabled: Boolean(viewerId && workspaceId),
  });
  const rows = tickets.data?.pages.flatMap((page) => page.rows) ?? [];

  return (
    <QueryState
      query={tickets}
      errorTitle="Couldn't load tickets"
      empty={
        <Card>
          <EmptyState
            icon={Ticket}
            title="No tickets yet"
            description="Anything you report against this project shows up here."
            action={
              <Button asChild>
                <Link to="/app/report" search={{ project: projectId, url: undefined }}>
                  <Bug className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Report something
                </Link>
              </Button>
            }
          />
        </Card>
      }
    >
      {() => (
        <div className="overflow-hidden rounded-lg border">
          <ul>
            {rows.map((ticket) => (
              <li key={ticket.id}>
                <TicketRow
                  ticket={ticket}
                  showProject={false}
                  origin={{ from: "project", projectId }}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </QueryState>
  );
}

function MilestonesPanel({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const milestones = useQuery(projectMilestonesQuery(projectId));
  const [title, setTitle] = useState("");

  const invalidate = [
    qk.projectMilestones(projectId),
    qk.project(projectId),
    qk.projectUpdates(projectId),
  ];

  const add = useDataMutation(
    "milestones.insert",
    (input: { title: string }) => createMilestone({ project_id: projectId, title: input.title }),
    { success: "Milestone added", invalidate, onSuccess: () => setTitle("") },
  );

  const setStatus = useServerAction(useServerFn(setMilestoneStatus), {
    label: "milestones.setStatus",
    invalidate,
  });

  return (
    <div className="space-y-3">
      {canEdit && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim()) add.fire({ title: title.trim() });
          }}
          className="flex gap-2"
        >
          <Label htmlFor="new-milestone" className="sr-only">
            New milestone
          </Label>
          <Input
            id="new-milestone"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add a milestone…"
          />
          <Button type="submit" disabled={add.busy || !title.trim()}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">Add</span>
          </Button>
        </form>
      )}

      <QueryState
        query={milestones}
        errorTitle="Couldn't load milestones"
        empty={
          <Card>
            <EmptyState
              icon={GripVertical}
              title="No milestones yet"
              description={
                canEdit
                  ? "Add them here, or accept a quote and its line items become the plan."
                  : "Once the plan is agreed you'll see it here."
              }
            />
          </Card>
        }
      >
        {(data) => (
          <Card className="divide-y">
            {data.map((milestone) => (
              <div key={milestone.id} className="flex flex-wrap items-center gap-3 p-4">
                <span className="min-w-0 flex-1">{milestone.title}</span>
                {milestone.due_date && (
                  <span className="text-xs text-muted-foreground">due {milestone.due_date}</span>
                )}
                {canEdit ? (
                  <Select
                    value={milestone.status}
                    onValueChange={(value) =>
                      setStatus.fire({
                        milestoneId: milestone.id,
                        status: value as MilestoneStatus,
                      })
                    }
                  >
                    <SelectTrigger className="h-8 w-40" aria-label={`Status of ${milestone.title}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MILESTONE_STATUSES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {MILESTONE_STATUS_LABEL[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <StatusPill tone={MILESTONE_STATUS_TONE[milestone.status]}>
                    {MILESTONE_STATUS_LABEL[milestone.status]}
                  </StatusPill>
                )}
              </div>
            ))}
          </Card>
        )}
      </QueryState>
    </div>
  );
}

function PeoplePanel({
  projectId,
  canInvite,
  canManageRoles,
  pendingInvite,
  onPendingInviteChange,
}: {
  projectId: string;
  canInvite: boolean;
  canManageRoles: boolean;
  pendingInvite: string | null;
  onPendingInviteChange: (email: string | null) => void;
}) {
  const { workspaceId } = useAuth();
  const members = useQuery(projectMembersQuery(projectId));

  const setRole = useServerAction(useServerFn(setProjectMemberRole), {
    label: "admin.setProjectMemberRole",
    success: "Role updated",
    invalidate: [qk.projectMembers(projectId), qk.workspacePeople(workspaceId ?? undefined)],
  });

  return (
    <div className="space-y-3">
      {pendingInvite && (
        <Card className="border-dashed p-4">
          <p className="text-sm font-medium">Invite sent to {pendingInvite}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Waiting for them to accept — they&rsquo;ll appear here once they sign in.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 px-0"
            onClick={() => onPendingInviteChange(null)}
          >
            Dismiss
          </Button>
        </Card>
      )}

      <QueryState
        query={members}
        errorTitle="Couldn't load people"
        empty={
          <Card>
            <EmptyState
              icon={UserPlus}
              title="Nobody here yet"
              description={
                canInvite
                  ? "Invite your client so they can report issues and follow progress."
                  : "You're the first."
              }
              action={
                canInvite ? (
                  <InviteClientButton
                    projectId={projectId}
                    canChooseRole={canManageRoles}
                    onInvited={(email) => onPendingInviteChange(email)}
                  />
                ) : undefined
              }
            />
          </Card>
        }
      >
        {(data) => {
          const hasClient = data.some(
            (member) => member.role === "client" || member.role === "client_admin",
          );

          return (
            <div className="space-y-3">
              {canInvite && !hasClient && !pendingInvite && (
                <Card className="flex flex-wrap items-center justify-between gap-3 border-dashed p-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">No client on this project yet</p>
                    <p className="text-sm text-muted-foreground">
                      Invite them so they can report issues and follow progress.
                    </p>
                  </div>
                  <InviteClientButton
                    projectId={projectId}
                    canChooseRole={canManageRoles}
                    onInvited={(email) => onPendingInviteChange(email)}
                  />
                </Card>
              )}

              {canInvite && hasClient && (
                <div className="flex justify-end">
                  <InviteClientButton
                    projectId={projectId}
                    canChooseRole={canManageRoles}
                    onInvited={(email) => onPendingInviteChange(email)}
                  />
                </div>
              )}

              <Card className="divide-y">
                {data.map((member) => {
                  const role = member.role;
                  const canToggle =
                    canManageRoles && (role === "client" || role === "client_admin") && workspaceId;

                  return (
                    <div key={member.id} className="flex items-center gap-3 p-4">
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-sm"
                        aria-hidden="true"
                      >
                        {initials(member.profile?.full_name ?? member.profile?.email)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {member.profile?.full_name ?? member.profile?.email}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {member.profile?.email}
                        </div>
                      </div>
                      <StatusPill>
                        {ROLE_LABEL[member.role as keyof typeof ROLE_LABEL] ?? member.role}
                      </StatusPill>
                      {canToggle && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={setRole.busy}
                          onClick={() =>
                            setRole.fire({
                              workspaceId: workspaceId!,
                              userId: member.user_id,
                              projectId,
                              role: role === "client_admin" ? "client" : "client_admin",
                            })
                          }
                        >
                          {role === "client_admin" ? "Make client" : "Make lead"}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </Card>
            </div>
          );
        }}
      </QueryState>
    </div>
  );
}

function ProjectStatusSelect({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  const { workspaceId } = useAuth();
  const update = useServerAction(useServerFn(setProjectStatus), {
    label: "projects.setStatus",
    invalidate: [qk.project(projectId), qk.projectList(workspaceId ?? undefined)],
  });

  return (
    <Select
      value={status}
      onValueChange={(value) => update.fire({ projectId, status: value as ProjectStatus })}
    >
      <SelectTrigger className="h-8 w-40" aria-label="Project status">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PROJECT_STATUSES.map((value) => (
          <SelectItem key={value} value={value}>
            {PROJECT_STATUS_LABEL[value]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function InviteClientButton({
  projectId,
  canChooseRole = false,
  onInvited,
}: {
  projectId: string;
  canChooseRole?: boolean;
  onInvited?: (email: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<"client" | "client_admin">("client");
  const { workspaceId } = useAuth();

  const invite = useServerAction(useServerFn(inviteClient), {
    label: "admin.inviteClient",
    success: "Invitation sent",
    invalidate: [qk.projectMembers(projectId), qk.workspacePeople(workspaceId ?? undefined)],
    onSuccess: (_result, vars) => {
      setOpen(false);
      const email =
        vars && typeof vars === "object" && "email" in vars
          ? String((vars as { email: string }).email)
          : "";
      if (email) onInvited?.(email);
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Invite client
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite to this project</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!workspaceId) return;
            const form = new FormData(event.currentTarget);
            void invite.run({
              projectId,
              workspaceId,
              email: String(form.get("email")),
              fullName: String(form.get("name")) || undefined,
              role: canChooseRole ? role : "client",
            });
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" name="email" type="email" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Name (optional)</Label>
            <Input id="invite-name" name="name" />
          </div>
          {canChooseRole && (
            <div className="space-y-1.5">
              <Label htmlFor="invite-role">Role</Label>
              <Select
                value={role}
                onValueChange={(value) => setRole(value as "client" | "client_admin")}
              >
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="client">Client</SelectItem>
                  <SelectItem value="client_admin">Client lead</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            They&rsquo;ll get an email with a sign-in link and immediate access to this project.
          </p>
          <DialogFooter>
            <Button type="submit" disabled={invite.busy || !workspaceId}>
              {invite.busy ? "Inviting…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
