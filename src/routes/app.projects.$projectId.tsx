import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { Bug, GripVertical, Plus, Ticket, UserPlus } from "lucide-react";
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
import { TicketRow } from "@/features/tickets/ticket-row";
import { useServerAction } from "@/lib/use-server-action";
import { inviteClient } from "@/lib/admin.functions";
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
  const { user, isAdmin } = useAuth();

  const project = useQuery(projectQuery(projectId));
  const tab = search.tab ?? (isAdmin ? "tickets" : "overview");

  return (
    <QueryState query={project} errorTitle="Couldn't load this project">
      {(p) => (
        <>
          <PageHeader
            title={p.title}
            description={p.description ?? p.organization?.name ?? undefined}
            action={
              <div className="flex flex-wrap gap-2">
                {isAdmin && <InviteClientButton projectId={projectId} />}
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
                void navigate({ search: (prev) => ({ ...prev, tab: next }) })
              }
            >
              <TabsList className="flex-wrap">
                {!isAdmin && <TabsTrigger value="overview">Overview</TabsTrigger>}
                <TabsTrigger value="tickets">Tickets</TabsTrigger>
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
                    <TicketsPanel projectId={projectId} viewerId={user?.id ?? ""} />
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
                    <PeoplePanel projectId={projectId} canInvite={isAdmin} />
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

function TicketsPanel({ projectId, viewerId }: { projectId: string; viewerId: string }) {
  const tickets = useInfiniteQuery({
    ...ticketListQuery({ projectId, sort: "updated" }, viewerId),
    enabled: Boolean(viewerId),
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
                <TicketRow ticket={ticket} showProject={false} />
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

function PeoplePanel({ projectId, canInvite }: { projectId: string; canInvite: boolean }) {
  const members = useQuery(projectMembersQuery(projectId));

  return (
    <QueryState
      query={members}
      errorTitle="Couldn't load people"
      empty={
        <Card>
          <EmptyState
            icon={UserPlus}
            title="Nobody here yet"
            description={canInvite ? "Invite your client above." : "You're the first."}
          />
        </Card>
      }
    >
      {(data) => (
        <Card className="divide-y">
          {data.map((member) => (
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
            </div>
          ))}
        </Card>
      )}
    </QueryState>
  );
}

function ProjectStatusSelect({ projectId, status }: { projectId: string; status: ProjectStatus }) {
  const update = useServerAction(useServerFn(setProjectStatus), {
    label: "projects.setStatus",
    invalidate: [qk.project(projectId), qk.projectList()],
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

function InviteClientButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);

  const invite = useServerAction(useServerFn(inviteClient), {
    label: "admin.inviteClient",
    success: "Invitation sent",
    invalidate: [qk.projectMembers(projectId), qk.workspacePeople()],
    onSuccess: () => setOpen(false),
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
            const form = new FormData(event.currentTarget);
            void invite.run({
              projectId,
              email: String(form.get("email")),
              fullName: String(form.get("name")) || undefined,
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
          <p className="text-xs text-muted-foreground">
            They&rsquo;ll get an email with a sign-in link and immediate access to this project.
          </p>
          <DialogFooter>
            <Button type="submit" disabled={invite.busy}>
              {invite.busy ? "Inviting…" : "Send invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
