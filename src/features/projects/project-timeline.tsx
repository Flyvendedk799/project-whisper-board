import { Link } from "@tanstack/react-router";
import { CalendarClock, CheckCircle2, Circle, CircleDot, Receipt, Video } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ProgressBar, StatusPill } from "@/components/app-shell";
import { MILESTONE_STATUS_LABEL, MILESTONE_STATUS_TONE } from "@/data/enums";
import { formatCents, formatDate } from "@/lib/utils-format";
import { outstandingCents } from "@/data/billing";
import type { InvoiceWithLines, MeetingWithActionItems, Milestone, Project } from "@/data/types";

/**
 * Where the project has got to, and what happens next.
 *
 * This is the view a client actually opens the portal for, and it did not
 * exist: the six tabs each showed one noun and nothing joined them, so there
 * was no answer to "how is it going". Milestones on a line, the next meeting,
 * and anything owed — all in one place.
 */
export function ProjectTimeline({
  project,
  milestones,
  meetings,
  invoices,
}: {
  project: Project;
  milestones: Milestone[];
  meetings: MeetingWithActionItems[];
  invoices: InvoiceWithLines[];
}) {
  const nextMeeting = meetings
    .filter((m) => m.status === "scheduled" && new Date(m.scheduled_at) >= new Date())
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))[0];

  const owed = invoices
    .filter((i) => i.status === "sent" || i.status === "overdue")
    .reduce((total, invoice) => total + outstandingCents(invoice), 0);

  const done = milestones.filter((m) => m.status === "done").length;
  const current =
    milestones.find((m) => m.status === "in_progress") ??
    milestones.find((m) => m.status === "pending");

  return (
    <div className="space-y-6">
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl">Where we are</h2>
          <span className="text-sm text-muted-foreground">
            {milestones.length > 0
              ? `${done} of ${milestones.length} milestones done`
              : "No milestones planned yet"}
          </span>
        </div>

        <ProgressBar value={project.progress} label={`${project.title} progress`} className="h-2" />

        {current && (
          <p className="text-sm">
            <span className="text-muted-foreground">Currently on:</span>{" "}
            <strong>{current.title}</strong>
            {current.due_date && (
              <span className="text-muted-foreground"> · due {formatDate(current.due_date)}</span>
            )}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          {nextMeeting && (
            <div className="flex items-start gap-2.5 rounded-md border p-3">
              <Video className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium">Next call</p>
                <p className="truncate text-xs text-muted-foreground">
                  {nextMeeting.title} · {formatDate(nextMeeting.scheduled_at)}
                </p>
              </div>
            </div>
          )}

          {owed > 0 && (
            <div className="flex items-start gap-2.5 rounded-md border p-3">
              <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {formatCents(owed, project.currency)} outstanding
                </p>
                <Link
                  to="/app/projects/$projectId"
                  params={{ projectId: project.id }}
                  search={{ tab: "billing" }}
                  className="text-xs text-muted-foreground underline underline-offset-2"
                >
                  Open Billing to settle it
                </Link>
              </div>
            </div>
          )}
        </div>
      </Card>

      {milestones.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-4 font-display text-xl">The plan</h2>
          <ol className="relative space-y-4 border-l pl-6">
            {milestones.map((milestone) => (
              <li key={milestone.id} className="relative">
                <span className="absolute -left-[1.85rem] top-0.5 grid h-4 w-4 place-items-center rounded-full bg-background">
                  {milestone.status === "done" ? (
                    <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />
                  ) : milestone.status === "in_progress" ? (
                    <CircleDot className="h-4 w-4 text-info" aria-hidden="true" />
                  ) : (
                    <Circle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  )}
                </span>

                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={
                      milestone.status === "done" ? "text-muted-foreground" : "font-medium"
                    }
                  >
                    {milestone.title}
                  </span>
                  <StatusPill tone={MILESTONE_STATUS_TONE[milestone.status]}>
                    {MILESTONE_STATUS_LABEL[milestone.status]}
                  </StatusPill>
                  {milestone.due_date && milestone.status !== "done" && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <CalendarClock className="h-3 w-3" aria-hidden="true" />
                      {formatDate(milestone.due_date)}
                    </span>
                  )}
                  {milestone.amount_cents ? (
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {formatCents(milestone.amount_cents, project.currency)}
                    </span>
                  ) : null}
                </div>

                {milestone.description && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{milestone.description}</p>
                )}
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
}

export { Link };
