import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Bug, Ticket, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { SectionBoundary } from "@/components/error-boundary";
import { useAuth } from "@/components/auth-provider";
import { MeetingsTab } from "@/components/meetings-tab";
import { UpdatesTab } from "@/components/updates-tab";
import { BillingTab } from "@/components/billing-tab";
import { ProjectTimeline } from "@/features/projects/project-timeline";
import { ProjectAiPlansTab } from "@/features/projects/project-ai-plans";
import { ProjectRepoControl } from "@/features/projects/project-repo";
import { ProjectSettingsDialog } from "@/features/projects/project-settings-dialog";
import { MilestonesPanel } from "@/features/projects/project-milestones";
import { ProjectClientCard } from "@/features/projects/project-client-card";
import { ProjectPlanProgress } from "@/features/projects/project-plan-progress";
import { TimeSheet } from "@/features/time/time-sheet";
import { TicketRow } from "@/features/tickets/ticket-row";
import { useServerAction } from "@/lib/use-server-action";
import {
  addProjectMember,
  inviteClient,
  listInviteFollowUps,
  removeProjectMember,
  sendInviteFollowUp,
  setProjectMemberRole,
} from "@/lib/admin.functions";
import { setProjectStatus } from "@/lib/tickets.functions";
import {
  projectMembersQuery,
  projectMilestonesQuery,
  projectQuery,
  workspaceMembersQuery,
} from "@/data/projects";
import { projectInvoicesQuery } from "@/data/billing";
import { projectMeetingsQuery } from "@/data/meetings";
import { ticketListQuery } from "@/data/tickets";
import { qk } from "@/data/keys";
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
  ROLE_LABEL,
  type ProjectStatus,
} from "@/data/enums";
import { formatDate, formatRelative } from "@/lib/utils-format";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { PersonAvatar } from "@/components/person-avatar";

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

  const setTab = (next: string) =>
    void navigate({
      search: (prev: { tab?: string; paid?: string }) => ({ ...prev, tab: next }),
    });

  const tabDefs: Array<{ id: string; label: string }> = [
    ...(!isAdmin ? [{ id: "overview", label: "Overview" }] : []),
    { id: "tickets", label: "Tickets" },
    { id: "plans", label: "AI Plans" },
    { id: "updates", label: "Updates" },
    { id: "meetings", label: "Meetings" },
    { id: "milestones", label: "Milestones" },
    { id: "billing", label: "Billing" },
    ...(isAdmin ? [{ id: "time", label: "Time" }] : []),
    { id: "people", label: "People" },
  ];

  return (
    <QueryState query={project} errorTitle="Couldn't load this project">
      {(p) => (
        <>
          <PageHeader
            back={
              <Link
                to="/app/projects"
                className="hover:text-foreground max-md:inline-flex max-md:min-h-11 max-md:items-center"
              >
                ← Projects
              </Link>
            }
            title={p.title}
            description={p.description ?? undefined}
            meta={
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-muted-foreground max-md:gap-x-3 max-md:text-sm">
                {isAdmin ? (
                  <ProjectStatusSelect projectId={projectId} status={p.status} />
                ) : (
                  <StatusPill tone={PROJECT_STATUS_TONE[p.status]}>
                    {PROJECT_STATUS_LABEL[p.status]}
                  </StatusPill>
                )}
                <span className="min-w-0 truncate">{p.organization?.name ?? "Internal"}</span>
                <span
                  className="flex items-center gap-2 max-md:w-full"
                  title="Share of plan tasks or milestones finished. Not the same as project stage."
                >
                  <ProgressBar
                    value={p.progress}
                    label={`${p.title} work finished`}
                    className="w-[120px] max-md:w-auto max-md:flex-1"
                  />
                  <span className="tabular-nums">{p.progress}%</span>
                </span>
                {p.end_date && <span>Target {formatDate(p.end_date)}</span>}
                <ProjectPlanProgress projectId={projectId} linked />
                {isAdmin && p.budget_cents != null && (
                  <span>
                    Budget {p.currency} {(p.budget_cents / 100).toLocaleString()}
                  </span>
                )}
                {isAdmin && (
                  <ProjectRepoControl
                    projectId={projectId}
                    repo={p.github_repo}
                    branch={p.github_default_branch}
                  />
                )}
              </div>
            }
            action={
              <>
                {isAdmin && (
                  <ProjectSettingsDialog
                    project={p}
                    className="max-md:h-11 max-md:flex-1 max-md:text-sm"
                  />
                )}
                {(isAdmin || isClientAdmin) && (
                  <InviteClientButton
                    projectId={projectId}
                    canChooseRole={isAdmin}
                    className="max-md:flex-1"
                    onInvited={(email) => {
                      setPendingInvite(email);
                      if (tab !== "people") setTab("people");
                    }}
                  />
                )}
                <Button asChild className="max-md:order-first max-md:w-full">
                  <Link to="/app/report" search={{ project: projectId, url: undefined }}>
                    <Bug className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    Report something
                  </Link>
                </Button>
              </>
            }
            tabs={tabDefs.map((t) => ({
              id: t.id,
              label: t.label,
              active: tab === t.id,
              onSelect: () => setTab(t.id),
            }))}
          />

          <div className="mx-auto max-w-6xl px-4 py-4 md:px-8 md:py-8">
            {isAdmin &&
              p.progress >= 100 &&
              (p.status === "discovery" || p.status === "proposal") && (
                <p className="mb-4 text-xs text-muted-foreground">
                  Plan work is finished — update the stage when the engagement moves past{" "}
                  {PROJECT_STATUS_LABEL[p.status].toLowerCase()}.
                  {!p.github_repo ? " Repository is optional and separate." : ""}
                </p>
              )}

            {/* Each panel only mounts when it is the active tab. */}
            {!isAdmin && tab === "overview" && (
              <SectionBoundary label="project-overview">
                <OverviewPanel projectId={projectId} project={p} />
              </SectionBoundary>
            )}

            {tab === "tickets" && (
              <SectionBoundary label="project-tickets">
                <TicketsPanel
                  projectId={projectId}
                  viewerId={user?.id ?? ""}
                  workspaceId={workspaceId}
                />
              </SectionBoundary>
            )}

            {tab === "plans" && (
              <SectionBoundary label="project-plans">
                <ProjectAiPlansTab projectId={projectId} />
              </SectionBoundary>
            )}

            {tab === "updates" && (
              <SectionBoundary label="project-updates">
                <UpdatesTab projectId={projectId} />
              </SectionBoundary>
            )}

            {tab === "meetings" && (
              <SectionBoundary label="project-meetings">
                <MeetingsTab projectId={projectId} />
              </SectionBoundary>
            )}

            {tab === "milestones" && (
              <SectionBoundary label="project-milestones">
                <MilestonesPanel projectId={projectId} canEdit={isAdmin} currency={p.currency} />
              </SectionBoundary>
            )}

            {tab === "billing" && (
              <SectionBoundary label="project-billing">
                <BillingTab projectId={projectId} currency={p.currency} />
              </SectionBoundary>
            )}

            {isAdmin && tab === "time" && (
              <SectionBoundary label="project-time">
                <TimeSheet projectId={projectId} />
              </SectionBoundary>
            )}

            {tab === "people" && (
              <SectionBoundary label="project-people">
                <PeoplePanel
                  projectId={projectId}
                  canInvite={isAdmin || isClientAdmin}
                  canManageRoles={isAdmin}
                  pendingInvite={pendingInvite}
                  onPendingInviteChange={setPendingInvite}
                />
              </SectionBoundary>
            )}
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
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <ProjectTimeline
        project={project}
        milestones={milestones.data ?? []}
        meetings={meetings.data ?? []}
        invoices={invoices.data ?? []}
      />
      <ProjectClientCard project={project} />
    </div>
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
        <div className="overflow-hidden rounded-[14px] border bg-card">
          <ul className="divide-y">
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
  const { user, workspaceId } = useAuth();
  const members = useQuery(projectMembersQuery(projectId));
  const workspaceMembers = useQuery(workspaceMembersQuery(workspaceId));
  const fetchFollowUps = useServerFn(listInviteFollowUps);
  // Under the members key, so anything that refreshes the list refreshes this too.
  const followUps = useQuery({
    queryKey: [...qk.projectMembers(projectId), "follow-ups"],
    enabled: canInvite && Boolean(workspaceId),
    queryFn: () => fetchFollowUps({ data: { workspaceId: workspaceId!, projectId } }),
  });
  const followUpByUser = new Map((followUps.data ?? []).map((row) => [row.userId, row] as const));

  const setRole = useServerAction(useServerFn(setProjectMemberRole), {
    label: "admin.setProjectMemberRole",
    success: "Role updated",
    invalidate: [qk.projectMembers(projectId), qk.workspacePeople(workspaceId ?? undefined)],
  });

  const addMember = useServerAction(useServerFn(addProjectMember), {
    label: "admin.addProjectMember",
    success: "Added to this project",
    invalidate: [qk.projectMembers(projectId)],
  });

  const onProject = new Set((members.data ?? []).map((member) => member.user_id));
  const inviteStatusByUser = new Map(
    (workspaceMembers.data ?? []).map((member) => [member.user_id, member.pending] as const),
  );
  const workspaceClients = (workspaceMembers.data ?? []).filter(
    (member) =>
      (member.role === "client" || member.role === "client_admin") &&
      !onProject.has(member.user_id),
  );

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

      {canInvite && workspaceClients.length > 0 && (
        <Card className="space-y-3 border-primary/20 bg-primary/5 p-4">
          <div>
            <p className="text-sm font-medium">
              {members.data && members.data.length === 0
                ? "Add a client to this project"
                : "Clients in this workspace, not on this project"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              They&rsquo;re already on Team / Clients. Add them here so they can report and follow
              this project.
            </p>
          </div>
          <ul className="space-y-2">
            {workspaceClients.map((member) => (
              <li key={member.user_id} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2 truncate">
                  <span className="truncate">
                    {member.profile?.full_name || member.profile?.email || "Client"}
                  </span>
                  {member.pending ? (
                    <StatusPill tone="warning">Pending</StatusPill>
                  ) : (
                    <StatusPill tone="success">Accepted</StatusPill>
                  )}
                </span>
                <Button
                  size="sm"
                  disabled={addMember.busy || !workspaceId}
                  onClick={() =>
                    workspaceId &&
                    addMember.fire({
                      workspaceId,
                      projectId,
                      userId: member.user_id,
                    })
                  }
                >
                  Add to project
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <QueryState
        query={members}
        errorTitle="Couldn't load people"
        empty={
          workspaceClients.length > 0 ? (
            <Card className="p-4">
              <p className="text-sm text-muted-foreground">
                Nobody is on this project yet. Use Add to project above for a workspace client, or
                invite someone new.
              </p>
              {canInvite && (
                <div className="mt-3">
                  <InviteClientButton
                    projectId={projectId}
                    canChooseRole={canManageRoles}
                    onInvited={(email) => onPendingInviteChange(email)}
                  />
                </div>
              )}
            </Card>
          ) : (
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
          )
        }
      >
        {(data) => {
          const hasClient = data.some(
            (member) => member.role === "client" || member.role === "client_admin",
          );

          return (
            <div className="space-y-3">
              {canInvite && !hasClient && !pendingInvite && (
                <Card className="flex flex-wrap items-center justify-between gap-3 border-dashed p-4 max-md:[&_button]:w-full">
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
                    className="max-md:w-full"
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
                  const pending = inviteStatusByUser.get(member.user_id) ?? false;
                  const followUp = followUpByUser.get(member.user_id);
                  const displayName =
                    member.profile?.full_name || member.profile?.email || "this person";

                  return (
                    <div key={member.id} className="flex items-center gap-3 p-4 max-md:flex-wrap">
                      <PersonAvatar
                        person={member.profile ?? { id: member.user_id }}
                        pending={pending}
                      />
                      <div className="min-w-0 flex-1 max-md:basis-32">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {member.profile?.full_name ?? member.profile?.email}
                          </span>
                          {pending ? (
                            <StatusPill tone="warning">Pending</StatusPill>
                          ) : (
                            <StatusPill tone="success">Accepted</StatusPill>
                          )}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {member.profile?.email}
                          {pending && followUp
                            ? ` · Opfølgning sendt ${formatRelative(followUp.lastSentAt)}${
                                followUp.count > 1 ? ` (${followUp.count}×)` : ""
                              }`
                            : ""}
                        </div>
                      </div>
                      <StatusPill>
                        {ROLE_LABEL[member.role as keyof typeof ROLE_LABEL] ?? member.role}
                      </StatusPill>
                      {canInvite && pending && workspaceId && (
                        <FollowUpButton
                          workspaceId={workspaceId}
                          projectId={projectId}
                          userId={member.user_id}
                          name={displayName}
                          lastSentAt={followUp?.lastSentAt}
                        />
                      )}
                      {canToggle && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="max-md:order-last max-md:w-full"
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
                      {canInvite && workspaceId && member.user_id !== user?.id && (
                        <RemoveMemberButton
                          workspaceId={workspaceId}
                          projectId={projectId}
                          userId={member.user_id}
                          name={displayName}
                          pending={pending}
                        />
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

/** A polite reminder email to someone invited to the project who hasn't signed in yet. */
function FollowUpButton({
  workspaceId,
  projectId,
  userId,
  name,
  lastSentAt,
}: {
  workspaceId: string;
  projectId: string;
  userId: string;
  name: string;
  lastSentAt?: string;
}) {
  const followUp = useServerAction(useServerFn(sendInviteFollowUp), {
    label: "admin.sendInviteFollowUp",
    success: `Opfølgning sendt til ${name}`,
    invalidate: [qk.projectMembers(projectId)],
  });
  // Mirrors the server's cooldown: one reminder per person per project a day.
  const recentlySent = lastSentAt
    ? Date.now() - new Date(lastSentAt).getTime() < FOLLOW_UP_COOLDOWN_MS
    : false;

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="max-md:order-last max-md:w-full"
      disabled={followUp.busy || recentlySent}
      title={recentlySent ? "Opfølgning er sendt inden for de seneste 24 timer" : undefined}
      aria-label={`Send opfølgning til ${name}`}
      onClick={() => followUp.fire({ workspaceId, projectId, userId })}
    >
      {followUp.busy ? "Sender…" : recentlySent ? "Opfølgning sendt" : "Send opfølgning"}
    </Button>
  );
}

const FOLLOW_UP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Cancels a pending invite to the project, or takes a joined person off it. */
function RemoveMemberButton({
  workspaceId,
  projectId,
  userId,
  name,
  pending,
}: {
  workspaceId: string;
  projectId: string;
  userId: string;
  name: string;
  pending: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const remove = useServerAction(useServerFn(removeProjectMember), {
    label: "admin.removeProjectMember",
    success: pending ? "Invite cancelled" : "Removed from this project",
    invalidate: [qk.projectMembers(projectId), qk.workspacePeople(workspaceId)],
    onSuccess: () => setConfirming(false),
  });

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="max-md:order-last max-md:w-full"
        disabled={remove.busy}
        aria-label={`${pending ? "Cancel invite for" : "Remove"} ${name}`}
        onClick={() => setConfirming(true)}
      >
        {pending ? "Cancel invite" : "Remove"}
      </Button>
      <ConfirmDeleteDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={pending ? `Cancel ${name}'s invite?` : `Remove ${name} from this project?`}
        confirmLabel={pending ? "Cancel invite" : "Remove"}
        busyLabel={pending ? "Cancelling…" : "Removing…"}
        busy={remove.busy}
        onConfirm={() => remove.fire({ workspaceId, projectId, userId })}
      >
        {pending
          ? "They are taken off this project and can no longer open it. They stay on the Team page as pending until you revoke the invite there."
          : "They lose access to this project's tickets and updates. They stay in the workspace and can be added back at any time."}
      </ConfirmDeleteDialog>
    </>
  );
}

function ProjectStatusSelect({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  const { workspaceId } = useAuth();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const update = useServerAction(useServerFn(setProjectStatus), {
    label: "projects.setStatus",
    invalidate: [qk.project(projectId), qk.projectList(workspaceId ?? undefined)],
  });

  const apply = (value: ProjectStatus) => {
    if (value === "archived" && status !== "archived") {
      setConfirmArchive(true);
      return;
    }
    update.fire({ projectId, status: value });
  };

  return (
    <>
      <Select value={status} onValueChange={(value) => apply(value as ProjectStatus)}>
        <SelectTrigger className="h-8 w-40 max-md:w-full" aria-label="Project status">
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
      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive this project?</AlertDialogTitle>
            <AlertDialogDescription>
              It drops off the project list until you choose to show archived work. Tickets and
              invoices stay where they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it active</AlertDialogCancel>
            <AlertDialogAction onClick={() => update.fire({ projectId, status: "archived" })}>
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function InviteClientButton({
  projectId,
  canChooseRole = false,
  className,
  onInvited,
}: {
  projectId: string;
  canChooseRole?: boolean;
  className?: string;
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
        <Button variant="outline" className={className}>
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
            <Input
              id="invite-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="off"
              autoCorrect="off"
              enterKeyHint="next"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Name (optional)</Label>
            <Input id="invite-name" name="name" autoComplete="name" enterKeyHint="done" />
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
