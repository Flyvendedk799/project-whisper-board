import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link2, Play, Plus, Sparkles, Square, Timer, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/app-shell";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { linkTickets, unlinkTickets, updateTicket } from "@/lib/tickets.functions";
import { notifyTicketChanged } from "@/lib/notifications.functions";
import { autoTriageTicket, summarizeTicket } from "@/lib/ai.functions";
import { startTimer, stopTimer } from "@/lib/time.functions";
import { ticketRelationsQuery } from "@/data/tickets";
import { TicketPlanLink } from "@/features/tickets/ticket-plan-link";
import { LabelEditor } from "@/features/tickets/label-editor";
import { repoWebUrl } from "@/lib/github-url";
import { runningTimerQuery, ticketTimeQuery, formatMinutes, totalMinutes } from "@/data/time";
import { workspacePeopleQuery } from "@/data/projects";
import { qk } from "@/data/keys";
import {
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABEL,
  TICKET_RELATION_LABEL,
  TICKET_STATUSES,
  TICKET_STATUS_LABEL,
  TICKET_TYPES,
  TICKET_TYPE_LABEL,
  type TicketPriority,
  type TicketStatus,
  type TicketType,
} from "@/data/enums";
import type { RelationWithTicket, TicketDetail } from "@/data/types";

/** Everything an admin does to a ticket, in the order they usually do it. */
export function TicketSidebar({ ticket, userId }: { ticket: TicketDetail; userId: string }) {
  const { workspaceId } = useAuth();
  const invalidate = [qk.ticket(ticket.id), qk.tickets()];

  const notify = useServerFn(notifyTicketChanged);

  const update = useServerAction(useServerFn(updateTicket), {
    label: "tickets.update",
    invalidate,
    onSuccess: (result) => {
      // Only a change the client would want to hear about, and never at the
      // cost of the update itself if the notification cannot be delivered.
      for (const summary of result.notable ?? []) {
        void notify({ data: { ticketId: ticket.id, summary } }).catch(() => {});
      }
    },
  });

  const people = useQuery(workspacePeopleQuery(workspaceId));
  const relations = useQuery(ticketRelationsQuery(ticket.id));
  const timeEntries = useQuery(ticketTimeQuery(ticket.id));
  const running = useQuery(runningTimerQuery(userId));

  const start = useServerAction(useServerFn(startTimer), {
    label: "time.start",
    success: "Timer started",
    invalidate: [qk.timer(), qk.ticketTime(ticket.id)],
  });
  const stop = useServerAction(useServerFn(stopTimer), {
    label: "time.stop",
    success: (result) => (result.minutes ? `Logged ${formatMinutes(result.minutes)}` : "Stopped"),
    invalidate: [qk.timer(), qk.ticketTime(ticket.id)],
  });

  const summarize = useServerAction(useServerFn(summarizeTicket), {
    label: "ai.summarize",
    success: "Summarised",
    errorMessage: "Couldn't summarise this thread.",
    invalidate,
  });
  const triage = useServerAction(useServerFn(autoTriageTicket), {
    label: "ai.triage",
    success: (result) =>
      `Suggests ${TICKET_TYPE_LABEL[result.type]} · ${TICKET_PRIORITY_LABEL[result.priority]}`,
    errorMessage: "Couldn't triage this one.",
    invalidate,
  });

  const isRunningHere = running.data?.ticket_id === ticket.id;
  const logged = totalMinutes(timeEntries.data ?? []);

  return (
    <div className="space-y-4">
      <LabelEditor ticket={ticket} />
      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-medium">Manage</h2>

        <Field label="Status" id="status">
          <Select
            value={ticket.status}
            onValueChange={(value) =>
              update.fire({ ticketId: ticket.id, status: value as TicketStatus })
            }
          >
            <SelectTrigger id="status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TICKET_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {TICKET_STATUS_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Priority" id="priority">
          <Select
            value={ticket.priority}
            onValueChange={(value) =>
              update.fire({ ticketId: ticket.id, priority: value as TicketPriority })
            }
          >
            <SelectTrigger id="priority">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TICKET_PRIORITIES.map((value) => (
                <SelectItem key={value} value={value}>
                  {TICKET_PRIORITY_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Type" id="type">
          <Select
            value={ticket.type}
            onValueChange={(value) =>
              update.fire({ ticketId: ticket.id, type: value as TicketType })
            }
          >
            <SelectTrigger id="type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TICKET_TYPES.map((value) => (
                <SelectItem key={value} value={value}>
                  {TICKET_TYPE_LABEL[value]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Assignee" id="assignee">
          <Select
            value={ticket.assignee_id ?? "none"}
            onValueChange={(value) =>
              update.fire({ ticketId: ticket.id, assigneeId: value === "none" ? null : value })
            }
          >
            <SelectTrigger id="assignee">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Nobody yet</SelectItem>
              {(people.data ?? []).map((person) => (
                <SelectItem key={person.id} value={person.id}>
                  {person.full_name ?? person.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-medium">Dates</h2>

        <Field label="Due" id="due">
          <Input
            id="due"
            type="date"
            defaultValue={ticket.due_date ?? ""}
            onChange={(e) => update.fire({ ticketId: ticket.id, dueDate: e.target.value || null })}
          />
        </Field>

        <Field label="ETA the client sees" id="eta">
          <Input
            id="eta"
            type="date"
            defaultValue={ticket.eta_date ?? ""}
            onChange={(e) => update.fire({ ticketId: ticket.id, etaDate: e.target.value || null })}
          />
        </Field>

        <Field label="Estimate (hours)" id="estimate">
          <Input
            id="estimate"
            type="number"
            min={0}
            step={0.5}
            defaultValue={ticket.estimate_hours ?? ""}
            onChange={(e) =>
              update.fire({
                ticketId: ticket.id,
                estimateHours: e.target.value ? Number(e.target.value) : null,
              })
            }
          />
        </Field>
      </Card>

      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Time</h2>
          {logged > 0 && <StatusPill>{formatMinutes(logged)} logged</StatusPill>}
        </div>

        {isRunningHere ? (
          <Button
            variant="destructive"
            className="w-full"
            disabled={stop.busy}
            onClick={() => stop.fire({})}
          >
            <Square className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Stop timer
          </Button>
        ) : (
          <Button
            variant="outline"
            className="w-full"
            disabled={start.busy}
            onClick={() => start.fire({ ticketId: ticket.id })}
          >
            {running.data ? (
              <>
                <Timer className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Switch timer to this
              </>
            ) : (
              <>
                <Play className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Start timer
              </>
            )}
          </Button>
        )}

        {(timeEntries.data?.length ?? 0) > 0 && (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {timeEntries.data!.slice(0, 5).map((entry) => (
              <li key={entry.id} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">{entry.user?.full_name ?? "Someone"}</span>
                <span className="shrink-0 tabular-nums">
                  {entry.duration_minutes ? formatMinutes(entry.duration_minutes) : "running"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="space-y-3 p-4">
        <h2 className="text-sm font-medium">AI</h2>
        <Button
          variant="outline"
          className="w-full"
          disabled={summarize.busy}
          onClick={() => summarize.fire({ ticketId: ticket.id })}
        >
          <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {summarize.busy ? "Summarising…" : "Summarise the thread"}
        </Button>
        <Button
          variant="outline"
          className="w-full"
          disabled={triage.busy}
          onClick={() => triage.fire({ ticketId: ticket.id })}
        >
          <Wand2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
          {triage.busy ? "Thinking…" : "Suggest type and priority"}
        </Button>

        {ticket.ai_suggested_type && (
          <p className="text-xs text-muted-foreground">
            Suggested: <strong>{TICKET_TYPE_LABEL[ticket.ai_suggested_type]}</strong> ·{" "}
            <strong>
              {ticket.ai_suggested_priority
                ? TICKET_PRIORITY_LABEL[ticket.ai_suggested_priority]
                : "—"}
            </strong>
          </p>
        )}
        {ticket.ai_screenshot_analysis && (
          <p className="border-l-2 border-primary/40 pl-2 text-xs italic text-muted-foreground">
            {ticket.ai_screenshot_analysis}
          </p>
        )}
      </Card>

      <ProjectRepoCard repo={ticket.project?.github_repo ?? null} projectId={ticket.project_id} />
      <RelationsCard ticketId={ticket.id} relations={relations.data ?? []} />
      <TicketPlanLink ticketId={ticket.id} projectId={ticket.project_id} />
    </div>
  );
}

function ProjectRepoCard({ repo, projectId }: { repo: string | null; projectId: string }) {
  const href = repo ? repoWebUrl(repo) : null;
  return (
    <Card className="space-y-2 p-4">
      <h2 className="text-sm font-medium">Repository</h2>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-sm underline underline-offset-2"
        >
          {repo}
        </a>
      ) : (
        <p className="text-xs text-muted-foreground">
          This project has no repository yet.{" "}
          <Link
            to="/app/projects/$projectId"
            params={{ projectId }}
            search={{ tab: "tickets" }}
            className="underline underline-offset-2"
          >
            Connect one
          </Link>
          .
        </p>
      )}
    </Card>
  );
}

function RelationsCard({
  ticketId,
  relations,
}: {
  ticketId: string;
  relations: RelationWithTicket[];
}) {
  const [adding, setAdding] = useState(false);
  const [number, setNumber] = useState("");

  const link = useServerAction(useServerFn(linkTickets), {
    label: "tickets.link",
    success: "Linked",
    invalidate: [qk.ticketRelations(ticketId)],
    onSuccess: () => {
      setAdding(false);
      setNumber("");
    },
  });

  const unlink = useServerAction(useServerFn(unlinkTickets), {
    label: "tickets.unlink",
    success: "Unlinked",
    invalidate: [qk.ticketRelations(ticketId)],
  });

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Related</h2>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          aria-label="Link another ticket"
          onClick={() => setAdding((value) => !value)}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>

      {relations.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground">Nothing linked.</p>
      )}

      <ul className="space-y-1.5">
        {relations.map((relation) => (
          <li key={relation.id} className="group flex items-center gap-2 text-sm">
            <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="shrink-0 text-xs text-muted-foreground">
              {TICKET_RELATION_LABEL[relation.kind]}
            </span>
            {relation.to_ticket && (
              <Link
                to="/app/tickets/$ticketId"
                params={{ ticketId: relation.to_ticket.id }}
                className="min-w-0 flex-1 truncate underline underline-offset-2"
              >
                #{relation.to_ticket.ticket_number}
                {relation.to_ticket.title ? ` · ${relation.to_ticket.title}` : ""}
              </Link>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              aria-label="Remove link"
              onClick={() => unlink.fire({ relationId: relation.id })}
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
            </Button>
          </li>
        ))}
      </ul>

      {adding && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            // Linking by number would need a lookup; paste the id for now.
            link.fire({ fromTicketId: ticketId, toTicketId: number.trim(), kind: "relates_to" });
          }}
          className="flex gap-1.5"
        >
          <Input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="Ticket id"
            aria-label="Ticket to link"
            className="h-8"
          />
          <Button type="submit" size="sm" disabled={link.busy || !number.trim()}>
            Link
          </Button>
        </form>
      )}
    </Card>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}
