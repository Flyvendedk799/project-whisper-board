import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, ProgressBar, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { SectionBoundary } from "@/components/error-boundary";
import { Section, SectionAction, SectionRow, RowCard } from "@/components/section-list";
import { useAuth } from "@/components/auth-provider";
import { OnboardingWizard, isOnboardingIncomplete } from "@/components/onboarding-wizard";
import { GettingStartedGuide } from "@/components/getting-started";
import { QUEUE_VIEWS, queueSearch, type QueueViewId } from "@/features/triage/queue-views";
import { ticketCountsQuery, ticketListQuery } from "@/data/tickets";
import { projectListQuery, workspaceMembersQuery } from "@/data/projects";
import { comingUpQuery, dashboardSummaryQuery } from "@/data/dashboard";
import { formatMinutes } from "@/data/time";
import {
  OPEN_TICKET_STATUSES,
  PROJECT_STATUS_LABEL,
  PROJECT_STATUS_TONE,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
} from "@/data/enums";
import { formatCents, formatDate, formatRelative } from "@/lib/utils-format";
import type { TicketListRow } from "@/data/types";

export const Route = createFileRoute("/app/")({
  validateSearch: z.object({
    project: z.string().uuid().optional(),
  }),
  component: HomePage,
});

function HomePage() {
  const { user, isAdmin } = useAuth();
  const name = (user?.user_metadata?.full_name || user?.email?.split("@")[0] || "there")
    .toString()
    .split(" ")[0];
  const greeting = greet(name);

  return (
    <>
      <PageHeader
        title={greeting}
        description={
          isAdmin ? "Where your client work stands." : "Your projects and what's happening."
        }
        action={
          !isAdmin && (
            <Button asChild>
              <Link to="/app/report">Report something</Link>
            </Button>
          )
        }
      />
      <div className="mx-auto max-w-[1120px] px-4 py-6 md:px-8 md:py-7">
        {isAdmin ? <AdminHome /> : <ClientHome />}
      </div>
    </>
  );
}

/**
 * The cockpit.
 *
 * What the person running the workspace needs first is what is late, what
 * nobody has answered, and what is owed. Every tile links into the queue with
 * the filters that produced its number (see `QUEUE_VIEWS`), so a count is
 * always one click from the tickets behind it.
 */
function AdminHome() {
  const { user, workspaceId } = useAuth();
  const viewerId = user?.id ?? "";

  const counts = useQuery(ticketCountsQuery(viewerId, workspaceId));
  const projects = useQuery(projectListQuery(workspaceId));
  const members = useQuery(workspaceMembersQuery(workspaceId));

  const recent = useInfiniteQuery({
    ...ticketListQuery({ sort: "updated" }, viewerId, workspaceId),
    enabled: Boolean(viewerId && workspaceId),
  });
  const recentRows = (recent.data?.pages[0]?.rows ?? []).slice(0, 6);

  const noProjects = projects.isSuccess && projects.data.length === 0;
  const resumeOnboarding = isOnboardingIncomplete(workspaceId);
  if (noProjects || resumeOnboarding) return <OnboardingWizard />;

  const hasClient = (members.data ?? []).some(
    (member) => member.role === "client" || member.role === "client_admin",
  );
  const hasTickets = recentRows.length > 0 || (counts.data?.needsTriage ?? 0) > 0;

  return (
    <div className="space-y-6">
      <GettingStartedGuide
        hasClient={hasClient}
        hasProject={(projects.data ?? []).length > 0}
        hasTickets={hasTickets}
        firstProjectId={projects.data?.[0]?.id}
        loading={members.isPending || projects.isPending || recent.isPending}
      />

      <section aria-label="Needs you">
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <Tile
            id="breached"
            label="Overdue"
            value={counts.data?.breached}
            loading={counts.isPending}
          />
          <Tile
            id="atRisk"
            label="Due soon"
            value={counts.data?.atRisk}
            loading={counts.isPending}
          />
          <Tile
            id="awaiting"
            label="Awaiting a first reply"
            value={counts.data?.awaiting}
            loading={counts.isPending}
          />
          <Tile
            id="unassigned"
            label="Unassigned"
            value={counts.data?.unassigned}
            loading={counts.isPending}
          />
        </div>
      </section>

      <div className="flex flex-wrap items-start gap-7">
        <div className="min-w-0 flex-1 basis-[560px]">
          <Section
            id="recent-activity"
            title="Latest activity"
            action={
              <Link to="/app/triage" search={queueSearch("allOpen")}>
                <SectionAction>Open the queue</SectionAction>
              </Link>
            }
          >
            <QueryState
              query={recent}
              errorTitle="Couldn't load recent tickets"
              empty={
                <div className="rounded-[14px] border bg-card">
                  <EmptyState
                    title="Nothing yet"
                    description="Tickets your clients open will land here. Seed the queue yourself, or invite a client so they can report."
                    action={
                      <Button asChild>
                        <Link to="/app/report">Report something</Link>
                      </Button>
                    }
                  />
                </div>
              }
            >
              {() => (
                <RowCard>
                  {recentRows.map((ticket) => (
                    <TicketActivityRow key={ticket.id} ticket={ticket} />
                  ))}
                </RowCard>
              )}
            </QueryState>
          </Section>
        </div>

        <div className="flex min-w-0 flex-1 basis-[320px] flex-col gap-6 lg:max-w-[420px]">
          <SectionBoundary label="money">
            <MoneyAndTime workspaceId={workspaceId} projects={projects.data ?? []} />
          </SectionBoundary>
          <SectionBoundary label="coming-up">
            <ComingUp workspaceId={workspaceId} />
          </SectionBoundary>
          <Section id="active-projects" title="Projects">
            <RowCard>
              {(projects.data ?? [])
                .filter((project) => project.status !== "archived")
                .slice(0, 5)
                .map((project) => (
                  <SectionRow
                    key={project.id}
                    compact
                    title={project.title}
                    right={`${project.progress}%`}
                    progress={project.progress}
                    link={(p) => (
                      <Link
                        to="/app/projects/$projectId"
                        params={{ projectId: project.id }}
                        {...p}
                      />
                    )}
                  />
                ))}
            </RowCard>
          </Section>
        </div>
      </div>
    </div>
  );
}

function TicketActivityRow({ ticket }: { ticket: TicketListRow }) {
  return (
    <SectionRow
      title={ticket.title}
      pill={
        <StatusPill tone={TICKET_STATUS_TONE[ticket.status]}>
          {TICKET_STATUS_LABEL[ticket.status]}
        </StatusPill>
      }
      sub={`#${ticket.ticket_number}${ticket.project ? ` · ${ticket.project.title}` : ""}`}
      right={formatRelative(ticket.updated_at)}
      link={(p) => (
        <Link
          to="/app/tickets/$ticketId"
          params={{ ticketId: ticket.id }}
          search={{ from: "home" }}
          {...p}
        />
      )}
    />
  );
}

function MoneyAndTime({
  workspaceId,
  projects,
}: {
  workspaceId: string | null | undefined;
  projects: Array<{ id: string }>;
}) {
  const summary = useQuery(dashboardSummaryQuery(workspaceId));

  if (summary.isPending) {
    return (
      <Section title="Money and time">
        <Skeleton className="h-24 w-full rounded-[14px]" />
      </Section>
    );
  }
  if (summary.isError) {
    return (
      <Section title="Money and time">
        <p className="rounded-[14px] border bg-card p-4 text-sm text-muted-foreground">
          Couldn&rsquo;t load this right now.
        </p>
      </Section>
    );
  }

  const { outstanding, weekMinutes, weekBillableMinutes } = summary.data;
  const invoiceCount = outstanding.reduce((n, o) => n + o.invoices, 0);
  const amounts = outstanding.map((o) => formatCents(o.cents, o.currency)).join(" · ");
  // Billing lives on each project; land on the first one until there is a workspace-wide view.
  const billingTarget = projects[0]?.id;

  return (
    <Section id="money" title="Money and time">
      <RowCard>
        <SectionRow
          title={
            invoiceCount === 0
              ? "Nothing outstanding"
              : `${invoiceCount} ${invoiceCount === 1 ? "invoice" : "invoices"} outstanding`
          }
          sub={invoiceCount === 0 ? undefined : amounts}
          link={
            invoiceCount > 0 && billingTarget
              ? (p) => (
                  <Link
                    to="/app/projects/$projectId"
                    params={{ projectId: billingTarget }}
                    search={{ tab: "billing" }}
                    {...p}
                  />
                )
              : undefined
          }
        />
        <SectionRow
          title={`${formatMinutes(weekMinutes)} logged this week`}
          sub={`${formatMinutes(weekBillableMinutes)} billable`}
          link={(p) => <Link to="/app/time" {...p} />}
        />
      </RowCard>
    </Section>
  );
}

function ComingUp({ workspaceId }: { workspaceId: string | null | undefined }) {
  const upcoming = useQuery(comingUpQuery(workspaceId));
  const items = upcoming.data ?? [];

  return (
    <Section id="upcoming" title="Coming up">
      {items.length === 0 ? (
        <p className="rounded-[14px] border bg-card p-4 text-sm text-muted-foreground">
          {upcoming.isPending ? "Loading…" : "Nothing scheduled."}
        </p>
      ) : (
        <RowCard>
          {items.map((item) => (
            <SectionRow
              key={item.id}
              compact
              title={item.title}
              sub={`${item.kind === "meeting" ? formatWhen(item.at) : `Milestone due ${formatDate(item.at)}`}${item.projectTitle ? ` · ${item.projectTitle}` : ""}`}
              pill={item.overdue ? <StatusPill tone="destructive">Overdue</StatusPill> : undefined}
              link={(p) => (
                <Link
                  to="/app/projects/$projectId"
                  params={{ projectId: item.projectId }}
                  search={{ tab: item.kind === "meeting" ? "meetings" : "milestones" }}
                  {...p}
                />
              )}
            />
          ))}
        </RowCard>
      )}
    </Section>
  );
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * The client's home: their projects, and what is being worked on for them with
 * an ETA where one has been set. RLS already limits both to projects they
 * belong to.
 */
function ClientHome() {
  const { user, workspaceId } = useAuth();
  const projects = useQuery(projectListQuery(workspaceId));
  const open = useInfiniteQuery({
    ...ticketListQuery(
      { sort: "updated", status: [...OPEN_TICKET_STATUSES] },
      user?.id ?? "",
      workspaceId,
    ),
    enabled: Boolean(user && workspaceId),
  });
  const openRows = (open.data?.pages[0]?.rows ?? []).slice(0, 5);

  return (
    <QueryState
      query={projects}
      errorTitle="Couldn't load your projects"
      empty={
        <div className="rounded-[14px] border bg-card">
          <EmptyState
            title="Nothing shared with you yet"
            description="Ask your agency to invite you to a project. It'll show up here with tickets, meetings and progress."
            action={
              <Button variant="outline" asChild>
                <Link to="/app/inbox">Open inbox</Link>
              </Button>
            }
          />
        </div>
      }
    >
      {(data) => (
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {data
              .filter((project) => project.status !== "archived")
              .map((project) => (
                <Link
                  key={project.id}
                  to="/app/projects/$projectId"
                  params={{ projectId: project.id }}
                  search={{ tab: "overview" }}
                  className="flex min-h-[150px] flex-col gap-2 rounded-[14px] border bg-card p-5 transition-all hover:border-foreground/25 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex items-center">
                    <StatusPill tone={PROJECT_STATUS_TONE[project.status]}>
                      {PROJECT_STATUS_LABEL[project.status]}
                    </StatusPill>
                    <span className="flex-1" />
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {project.progress}%
                    </span>
                  </div>
                  <h3 className="font-display text-2xl leading-tight">{project.title}</h3>
                  {project.organization?.name && (
                    <div className="text-xs text-muted-foreground">{project.organization.name}</div>
                  )}
                  {project.description && (
                    <p className="line-clamp-3 flex-1 text-[13px] leading-normal text-muted-foreground">
                      {project.description}
                    </p>
                  )}
                  <ProgressBar
                    value={project.progress}
                    label={`${project.title} progress`}
                    className="mt-1.5"
                  />
                  {project.end_date && (
                    <div className="text-xs text-muted-foreground">
                      Target {formatDate(project.end_date)}
                    </div>
                  )}
                </Link>
              ))}
          </div>

          <Section
            id="working-on"
            title="What we are working on for you"
            action={
              <Link to="/app/tickets">
                <SectionAction>All my tickets</SectionAction>
              </Link>
            }
          >
            {openRows.length === 0 ? (
              <p className="rounded-[14px] border bg-card p-4 text-sm text-muted-foreground">
                {open.isPending
                  ? "Loading…"
                  : "Nothing open right now. If something isn't right, tell us."}
              </p>
            ) : (
              <RowCard>
                {openRows.map((ticket) => (
                  <SectionRow
                    key={ticket.id}
                    title={ticket.title}
                    pill={
                      <StatusPill tone={TICKET_STATUS_TONE[ticket.status]}>
                        {TICKET_STATUS_LABEL[ticket.status]}
                      </StatusPill>
                    }
                    sub={`#${ticket.ticket_number}${ticket.project ? ` · ${ticket.project.title}` : ""}`}
                    right={
                      ticket.eta_date
                        ? `ETA ${formatDate(ticket.eta_date)}`
                        : formatRelative(ticket.updated_at)
                    }
                    link={(p) => (
                      <Link
                        to="/app/tickets/$ticketId"
                        params={{ ticketId: ticket.id }}
                        search={{ from: "home" }}
                        {...p}
                      />
                    )}
                  />
                ))}
              </RowCard>
            )}
          </Section>
        </div>
      )}
    </QueryState>
  );
}

function Tile({
  id,
  label,
  value,
  loading,
}: {
  id: QueueViewId;
  label: string;
  value: number | undefined;
  loading: boolean;
}) {
  const view = QUEUE_VIEWS.find((v) => v.id === id)!;
  const ink =
    value && view.tone === "danger"
      ? "text-destructive"
      : value && view.tone === "warning"
        ? "text-[color-mix(in_oklab,var(--warning),black_35%)]"
        : "text-foreground";

  return (
    <Link
      to="/app/triage"
      search={queueSearch(id)}
      className="rounded-[14px] border bg-card px-[18px] py-4 transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      {loading ? (
        <Skeleton className="mt-2 h-9 w-12" />
      ) : (
        <div className={`mt-1 font-display text-[40px] leading-[1.1] tabular-nums ${ink}`}>
          {value ?? 0}
        </div>
      )}
    </Link>
  );
}

function greet(name: string) {
  const hour = new Date().getHours();
  const prefix =
    hour < 5
      ? "Still up"
      : hour < 12
        ? "Good morning"
        : hour < 18
          ? "Good afternoon"
          : "Good evening";
  return `${prefix}, ${name}`;
}
