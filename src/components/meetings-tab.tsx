import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarPlus, Check, ExternalLink, Sparkles, Ticket, Video, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { EmptyState, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { createMeeting, saveMeetingNotes, commitActionItems } from "@/lib/meetings.functions";
import { proposeActionItems, type ProposedActionItem } from "@/lib/ai.functions";
import { projectMeetingsQuery } from "@/data/meetings";
import { qk } from "@/data/keys";
import { ACTION_ITEM_STATUS_LABEL, MEETING_STATUS_LABEL, MEETING_STATUS_TONE } from "@/data/enums";
import { formatDate } from "@/lib/utils-format";
import type { MeetingWithActionItems } from "@/data/types";

export function MeetingsTab({ projectId }: { projectId: string }) {
  const { isAdmin } = useAuth();
  const meetings = useQuery(projectMeetingsQuery(projectId));

  return (
    <div className="space-y-3">
      {isAdmin && <NewMeetingButton projectId={projectId} />}

      <QueryState
        query={meetings}
        errorTitle="Couldn't load meetings"
        empty={
          <Card>
            <EmptyState
              icon={CalendarPlus}
              title="No meetings yet"
              description={
                isAdmin
                  ? "Schedule one and the notes, decisions and follow-ups all land here."
                  : "When a call is booked it'll show up here with the agenda."
              }
            />
          </Card>
        }
      >
        {(data) => (
          <div className="space-y-3">
            {data.map((meeting) => (
              <MeetingCard
                key={meeting.id}
                meeting={meeting}
                projectId={projectId}
                canEdit={isAdmin}
              />
            ))}
          </div>
        )}
      </QueryState>
    </div>
  );
}

function NewMeetingButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const create = useServerAction(useServerFn(createMeeting), {
    label: "meetings.create",
    success: "Meeting scheduled",
    invalidate: [qk.projectMeetings(projectId), qk.meetings()],
    onSuccess: () => setOpen(false),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <CalendarPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Schedule meeting
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New meeting</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void create.run({
              projectId,
              title: String(form.get("title")),
              scheduledAt: new Date(String(form.get("when"))).toISOString(),
              durationMinutes: Number(form.get("duration")) || 30,
              agenda: String(form.get("agenda")) || undefined,
              meetingUrl: String(form.get("url")) || undefined,
            });
          }}
          className="space-y-3"
        >
          <div className="space-y-1.5">
            <Label htmlFor="m-title">Title</Label>
            <Input id="m-title" name="title" required placeholder="Sprint review" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="m-when">When</Label>
              <Input id="m-when" name="when" type="datetime-local" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="m-duration">Minutes</Label>
              <Input id="m-duration" name="duration" type="number" min={5} defaultValue={30} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-url">Meeting link</Label>
            <Input id="m-url" name="url" type="url" placeholder="https://meet.google.com/…" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="m-agenda">Agenda</Label>
            <Textarea id="m-agenda" name="agenda" rows={3} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={create.busy}>
              {create.busy ? "Scheduling…" : "Schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MeetingCard({
  meeting,
  projectId,
  canEdit,
}: {
  meeting: MeetingWithActionItems;
  projectId: string;
  canEdit: boolean;
}) {
  const [notes, setNotes] = useState(meeting.notes ?? "");
  const [proposal, setProposal] = useState<ProposedActionItem[] | null>(null);
  const [chosen, setChosen] = useState<Set<number>>(new Set());

  const invalidate = [qk.projectMeetings(projectId), qk.tickets(), qk.projectUpdates(projectId)];

  const save = useServerAction(useServerFn(saveMeetingNotes), {
    label: "meetings.saveNotes",
    success: "Notes saved",
    invalidate,
  });

  const propose = useServerAction(useServerFn(proposeActionItems), {
    label: "ai.proposeActionItems",
    errorMessage: "Couldn't pull action items out of those notes.",
    onSuccess: (result) => {
      setProposal(result.items);
      setChosen(new Set(result.items.map((_, i) => i)));
    },
  });

  const commit = useServerAction(useServerFn(commitActionItems), {
    label: "meetings.commitActionItems",
    success: (result) => `${result.created} ticket${result.created === 1 ? "" : "s"} created`,
    invalidate,
    onSuccess: (result) => {
      setProposal(null);
      setChosen(new Set());
      const firstId = result.ticketIds?.[0];
      if (firstId) {
        toast.message("Action items are tickets now", {
          action: {
            label: "Open first",
            onClick: () => {
              window.location.href = `/app/tickets/${firstId}`;
            },
          },
        });
      }
    },
  });

  const scheduled = new Date(meeting.scheduled_at);

  return (
    <Card className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-medium">{meeting.title}</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDate(scheduled)} ·{" "}
            {scheduled.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} ·{" "}
            {meeting.duration_minutes} min
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill tone={MEETING_STATUS_TONE[meeting.status]}>
            {MEETING_STATUS_LABEL[meeting.status]}
          </StatusPill>
          {meeting.meeting_url && (
            <Button variant="ghost" size="sm" asChild>
              <a href={meeting.meeting_url} target="_blank" rel="noreferrer">
                <Video className="mr-1 h-4 w-4" aria-hidden="true" />
                Join
                <ExternalLink className="ml-1 h-3 w-3" aria-hidden="true" />
              </a>
            </Button>
          )}
        </div>
      </div>

      {meeting.agenda && (
        <p className="whitespace-pre-wrap text-sm text-muted-foreground">{meeting.agenda}</p>
      )}

      {meeting.meeting_action_items.length > 0 && (
        <div className="rounded-md border p-3">
          <h5 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            What we agreed
          </h5>
          <ul className="space-y-1.5">
            {meeting.meeting_action_items.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-sm">
                <Ticket
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  {item.ticket_id ? (
                    <Link
                      to="/app/tickets/$ticketId"
                      params={{ ticketId: item.ticket_id }}
                      className="underline underline-offset-2"
                    >
                      {item.title}
                    </Link>
                  ) : (
                    item.title
                  )}
                </span>
                <StatusPill>{ACTION_ITEM_STATUS_LABEL[item.status]}</StatusPill>
              </li>
            ))}
          </ul>
        </div>
      )}

      {canEdit ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={`notes-${meeting.id}`} className="sr-only">
              Meeting notes
            </Label>
            <Textarea
              id={`notes-${meeting.id}`}
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was decided, and who's doing what."
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={save.busy}
              onClick={() => save.fire({ meetingId: meeting.id, notes })}
            >
              {save.busy ? "Saving…" : "Save notes"}
            </Button>
            {meeting.status !== "completed" && (
              <Button
                size="sm"
                variant="outline"
                disabled={save.busy}
                onClick={() => save.fire({ meetingId: meeting.id, notes, markCompleted: true })}
              >
                Mark completed
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={propose.busy || !notes.trim()}
              onClick={() => propose.fire({ meetingId: meeting.id })}
            >
              <Sparkles className="mr-1 h-4 w-4" aria-hidden="true" />
              {propose.busy ? "Reading…" : "Find action items"}
            </Button>
          </div>

          {/*
            The previous version handed the model's output straight to the
            tickets table with no confirmation, and then never rendered the
            action items it created — so you could not see what it had done.
            Nothing is created here until it has been read and ticked.
          */}
          {proposal && (
            <div className="space-y-3 rounded-md border bg-accent/30 p-3">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
                <h5 className="text-sm font-medium">
                  {proposal.length} action item{proposal.length === 1 ? "" : "s"} — pick the real
                  ones
                </h5>
                <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto h-6 w-6"
                  aria-label="Dismiss suggestions"
                  onClick={() => setProposal(null)}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>

              <ul className="space-y-2">
                {proposal.map((item, index) => (
                  <li key={index} className="flex items-start gap-2 rounded bg-background p-2">
                    <Checkbox
                      id={`item-${meeting.id}-${index}`}
                      checked={chosen.has(index)}
                      onCheckedChange={(next) =>
                        setChosen((prev) => {
                          const copy = new Set(prev);
                          if (next === true) copy.add(index);
                          else copy.delete(index);
                          return copy;
                        })
                      }
                      className="mt-0.5"
                    />
                    <label
                      htmlFor={`item-${meeting.id}-${index}`}
                      className="min-w-0 flex-1 cursor-pointer"
                    >
                      <span className="block text-sm font-medium">{item.title}</span>
                      {item.description && (
                        <span className="block text-xs text-muted-foreground">
                          {item.description}
                        </span>
                      )}
                    </label>
                  </li>
                ))}
              </ul>

              <Button
                size="sm"
                disabled={commit.busy || chosen.size === 0}
                onClick={() =>
                  commit.fire({
                    meetingId: meeting.id,
                    items: [...chosen].sort().map((i) => proposal[i]),
                  })
                }
              >
                <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Create {chosen.size} ticket{chosen.size === 1 ? "" : "s"}
              </Button>
            </div>
          )}

          {meeting.ai_summary && (
            <p className="border-l-2 border-primary/40 pl-3 text-sm italic text-muted-foreground">
              {meeting.ai_summary}
            </p>
          )}
        </>
      ) : (
        meeting.notes && <p className="whitespace-pre-wrap text-sm">{meeting.notes}</p>
      )}
    </Card>
  );
}
