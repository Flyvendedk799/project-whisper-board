import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueries, useQuery, useInfiniteQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Bug,
  Clock,
  FolderKanban,
  Inbox,
  MessageSquareWarning,
  Receipt,
  Timer,
  UserRound,
} from "lucide-react";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState, PageHeader, ProgressBar, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { SectionBoundary } from "@/components/error-boundary";
import { useAuth } from "@/components/auth-provider";
import { OnboardingWizard, isOnboardingIncomplete } from "@/components/onboarding-wizard";
import { ProjectTimeline } from "@/features/projects/project-timeline";
import { TicketRow } from "@/features/tickets/ticket-row";
import { ticketCountsQuery, ticketListQuery } from "@/data/tickets";
import { projectListQuery, projectMilestonesQuery } from "@/data/projects";
import { projectInvoicesQuery, outstandingCents } from "@/data/billing";
import { projectMeetingsQuery, upcomingMeetingsQuery } from "@/data/meetings";
import { projectTimeQuery, formatMinutes, totalMinutes } from "@/data/time";
import { PROJECT_STATUS_LABEL, PROJECT_STATUS_TONE } from "@/data/enums";
import { formatCents, formatRelative } from "@/lib/utils-format";
import type { TicketFilters } from "@/data/filters";
import type { InvoiceWithLines } from "@/data/types";
import type { TimeEntry } from "@/data/types";

export const Route = createFileRoute("/app/")({
  component: HomePage,
});

function HomePage() {
  const { user, isAdmin } = useAuth();
  const greeting = greet(user?.user_metadata?.full_name || user?.email?.split("@")[0] || "there");

  return (
    <>
      <PageHeader
        title={greeting}
        description={
          isAdmin ? "Where your client work stands." : "Your projects and what's happening."
        }
      />
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-8">
        {isAdmin ? <AdminHome /> : <ClientHome />}
      </div>
    </>
  );
}

/**
 * The cockpit.
 *
 * Home used to be six recent projects and eight open tickets — the same list
 * you would get anywhere. What the person running the workspace needs first is
 * what is late, what nobody has answered, and what is owed. Every tile links
 * into the queue with the filters that produced its number, so a count is
 * always one click from the tickets behind it.
 */
function AdminHome() {
  const { user, workspaceId } = useAuth();
  const viewerId = user?.id ?? "";

  const counts = useQuery(ticketCountsQuery(viewerId, workspaceId));
  const projects = useQuery(projectListQuery(workspaceId));
  const meetings = useQuery(upcomingMeetingsQuery());

  const recent = useInfiniteQuery({
    ...ticketListQuery({ sort: "updated" }, viewerId, workspaceId),
    enabled: Boolean(viewerId && workspaceId),
  });
  const recentRows = (recent.data?.pages[0]?.rows ?? []).slice(0, 6);

  const noProjects = projects.isSuccess && projects.data.length === 0;
  const resumeOnboarding = isOnboardingIncomplete(workspaceId);
  if (noProjects || resumeOnboarding) return <OnboardingWizard />;

  return (
    <div className="space-y-8">
      <section aria-labelledby="needs-you">
        <h2 id="needs-you" className="mb-3 font-display text-xl">
          Needs you
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile
            label="Overdue"
            value={counts.data?.breached}
            loading={counts.isPending}
            icon={AlertTriangle}
            tone={counts.data?.breached ? "destructive" : "default"}
            to={{ sla: "breached", sort: "sla" }}
          />
          <Tile
            label="Due soon"
            value={counts.data?.atRisk}
            loading={counts.isPending}
            icon={Clock}
            tone={counts.data?.atRisk ? "warning" : "default"}
            to={{ sla: "at_risk", sort: "sla" }}
          />
          <Tile
            label="Awaiting a first reply"
            value={counts.data?.awaiting}
            loading={counts.isPending}
            icon={MessageSquareWarning}
            to={{ awaiting: true, sort: "oldest" }}
          />
          <Tile
            label="Unassigned"
            value={counts.data?.unassigned}
            loading={counts.isPending}
            icon={UserRound}
            to={{ assignee: "unassigned" }}
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section aria-labelledby="recent-activity">
          <div className="mb-3 flex items-center justify-between">
            <h2 id="recent-activity" className="font-display text-xl">
              Latest activity
            </h2>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/app/triage">
                Open the queue
                <ArrowRight className="ml-1 h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <QueryState
            query={recent}
            errorTitle="Couldn't load recent tickets"
            empty={
              <Card>
                <EmptyState
                  icon={Inbox}
                  title="Nothing yet"
                  description="Tickets your clients open will land here. Seed the queue yourself, or invite a client so they can report."
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      <Button asChild>
                        <Link to="/app/report">
                          <Bug className="mr-1.5 h-4 w-4" aria-hidden="true" />
                          Report something
                        </Link>
                      </Button>
                      <Button variant="outline" asChild>
                        <Link to="/app/triage">Open the queue</Link>
                      </Button>
                    </div>
                  }
                />
              </Card>
            }
          >
            {() => (
              <div className="overflow-hidden rounded-lg border">
                <ul>
                  {recentRows.map((ticket) => (
                    <li key={ticket.id}>
                      <TicketRow ticket={ticket} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </QueryState>
        </section>

        <div className="space-y-6">
          <SectionBoundary label="money">
            <MoneyCard projects={projects.data ?? []} />
          </SectionBoundary>

          <section aria-labelledby="upcoming">
            <h2 id="upcoming" className="mb-3 font-display text-xl">
              Coming up
            </h2>
            <Card className="divide-y">
              {(meetings.data ?? []).length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">Nothing scheduled.</p>
              ) : (
                (meetings.data ?? []).map((meeting) => (
                  <Link
                    key={meeting.id}
                    to="/app/projects/$projectId"
                    params={{ projectId: meeting.project_id }}
                    search={{ tab: "meetings", paid: undefined }}
                    className="block p-3 hover:bg-accent/40"
                  >
                    <p className="truncate text-sm font-medium">{meeting.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatRelative(meeting.scheduled_at)}
                      {meeting.project?.title ? ` · ${meeting.project.title}` : ""}
                    </p>
                  </Link>
                ))
              )}
            </Card>
          </section>

          <section aria-labelledby="active-projects">
            <h2 id="active-projects" className="mb-3 font-display text-xl">
              Projects
            </h2>
            <Card className="divide-y">
              {(projects.data ?? []).slice(0, 6).map((project) => (
                <Link
                  key={project.id}
                  to="/app/projects/$projectId"
                  params={{ projectId: project.id }}
                  className="block p-3 hover:bg-accent/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm">{project.title}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {project.progress}%
                    </span>
                  </div>
                  <ProgressBar
                    value={project.progress}
                    label={`${project.title} progress`}
                    className="mt-1.5"
                  />
                </Link>
              ))}
            </Card>
          </section>
        </div>
      </div>
    </div>
  );
}

function MoneyCard({ projects }: { projects: Array<{ id: string; currency: string }> }) {
  const invoiceQueries = useQueries({
    queries: projects.map((project) => ({
      ...projectInvoicesQuery(project.id),
      enabled: Boolean(project.id),
    })),
  });
  const timeQueries = useQueries({
    queries: projects.map((project) => ({
      ...projectTimeQuery(project.id),
      enabled: Boolean(project.id),
    })),
  });

  const currency = projects[0]?.currency ?? "USD";
  const weekAgo = useMemo(() => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), []);

  const owed = invoiceQueries.reduce((total, query) => {
    const invoices = (query.data ?? []) as InvoiceWithLines[];
    return (
      total +
      invoices
        .filter((invoice) => invoice.status === "sent" || invoice.status === "overdue")
        .reduce((sum, invoice) => sum + outstandingCents(invoice), 0)
    );
  }, 0);

  const thisWeekMinutes = timeQueries.reduce((total, query) => {
    const entries = (query.data ?? []) as TimeEntry[];
    return total + totalMinutes(entries.filter((entry) => new Date(entry.started_at) >= weekAgo));
  }, 0);

  const loading = invoiceQueries.some((q) => q.isPending) || timeQueries.some((q) => q.isPending);

  if (projects.length === 0) return null;

  return (
    <section aria-labelledby="money">
      <h2 id="money" className="mb-3 font-display text-xl">
        Money and time
      </h2>
      <Card className="space-y-3 p-4">
        <div className="flex items-center gap-2.5">
          <Receipt className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm">
            {loading ? (
              <Skeleton className="inline-block h-4 w-24" />
            ) : (
              <>
                <strong className="tabular-nums">{formatCents(owed, currency)}</strong>{" "}
                <span className="text-muted-foreground">outstanding</span>
              </>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <Timer className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm">
            {loading ? (
              <Skeleton className="inline-block h-4 w-24" />
            ) : (
              <>
                <strong className="tabular-nums">{formatMinutes(thisWeekMinutes)}</strong>{" "}
                <span className="text-muted-foreground">logged this week</span>
              </>
            )}
          </span>
        </div>
      </Card>
    </section>
  );
}

function ClientHome() {
  const { workspaceId } = useAuth();
  const projects = useQuery(projectListQuery(workspaceId));
  const first = projects.data?.[0];

  const milestones = useQuery({
    ...projectMilestonesQuery(first?.id ?? ""),
    enabled: Boolean(first),
  });
  const meetings = useQuery({ ...projectMeetingsQuery(first?.id ?? ""), enabled: Boolean(first) });
  const invoices = useQuery({ ...projectInvoicesQuery(first?.id ?? ""), enabled: Boolean(first) });

  return (
    <QueryState
      query={projects}
      errorTitle="Couldn't load your projects"
      empty={
        <Card>
          <EmptyState
            icon={FolderKanban}
            title="Nothing shared with you yet"
            description="Ask your agency to invite you to a project — it'll show up here with tickets, meetings and progress. Check your inbox if you're waiting on an invite."
            action={
              <Button variant="outline" asChild>
                <Link to="/app/inbox">
                  <Inbox className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Open inbox
                </Link>
              </Button>
            }
          />
        </Card>
      }
    >
      {(data) => (
        <div className="space-y-8">
          {first && (
            <SectionBoundary label="client-timeline">
              <ProjectTimeline
                project={first}
                milestones={milestones.data ?? []}
                meetings={meetings.data ?? []}
                invoices={invoices.data ?? []}
              />
            </SectionBoundary>
          )}

          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-xl">
                {data.length > 1 ? "Your projects" : "Your project"}
              </h2>
              <Button size="sm" asChild>
                <Link to="/app/report">
                  <Bug className="mr-1.5 h-4 w-4" aria-hidden="true" />
                  Report something
                </Link>
              </Button>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {data.map((project) => (
                <Link
                  key={project.id}
                  to="/app/projects/$projectId"
                  params={{ projectId: project.id }}
                >
                  <Card className="h-full p-5 transition-all hover:border-foreground/20 hover:shadow-sm">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <StatusPill tone={PROJECT_STATUS_TONE[project.status]}>
                        {PROJECT_STATUS_LABEL[project.status]}
                      </StatusPill>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {project.progress}%
                      </span>
                    </div>
                    <h3 className="font-display text-xl">{project.title}</h3>
                    <ProgressBar
                      value={project.progress}
                      label={`${project.title} progress`}
                      className="mt-4"
                    />
                  </Card>
                </Link>
              ))}
            </div>
          </section>
        </div>
      )}
    </QueryState>
  );
}

function Tile({
  label,
  value,
  loading,
  icon: Icon,
  tone = "default",
  to,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  icon: typeof AlertTriangle;
  tone?: "default" | "warning" | "destructive";
  to: Partial<TicketFilters>;
}) {
  const colour =
    tone === "destructive"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning"
        : "text-foreground";

  return (
    <Link to="/app/triage" search={{ sort: "updated", ...to }}>
      <Card className="h-full p-4 transition-colors hover:border-foreground/20">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
          {label}
        </div>
        {loading ? (
          <Skeleton className="mt-2 h-8 w-12" />
        ) : (
          <p className={`mt-1 font-display text-3xl tabular-nums ${value ? colour : ""}`}>
            {value ?? 0}
          </p>
        )}
      </Card>
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
