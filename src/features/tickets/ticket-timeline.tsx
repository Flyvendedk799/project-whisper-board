import {
  ArrowRight,
  CalendarClock,
  CircleDot,
  MessageSquare,
  Paperclip,
  Plus,
  UserRound,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { StatusPill } from "@/components/app-shell";
import { RichTextView } from "@/components/rich-text-view";
import { formatRelative, initials } from "@/lib/utils-format";
import {
  TICKET_PRIORITY_LABEL,
  TICKET_STATUS_LABEL,
  TICKET_TYPE_LABEL,
  type TicketPriority,
  type TicketStatus,
  type TicketType,
} from "@/data/enums";
import type { CommentWithAuthor, EventWithActor, PersonRef } from "@/data/types";

/**
 * Comments and changes, interleaved.
 *
 * `ticket_events` has existed since the first migration and nothing wrote to it
 * or read it. Triggers fill it now, and this renders it — so "who changed the
 * priority, and when" is answerable without asking anyone.
 */

type Entry =
  | { kind: "comment"; at: string; comment: CommentWithAuthor }
  | { kind: "event"; at: string; event: EventWithActor };

export function TicketTimeline({
  comments,
  events,
  showInternal,
}: {
  comments: CommentWithAuthor[];
  events: EventWithActor[];
  showInternal: boolean;
}) {
  const entries: Entry[] = [
    ...comments
      .filter((comment) => showInternal || !comment.is_internal)
      .map<Entry>((comment) => ({ kind: "comment", at: comment.created_at, comment })),
    // "commented" events would duplicate the comment itself.
    ...events
      .filter((event) => !["commented", "internal_note"].includes(event.kind))
      .map<Entry>((event) => ({ kind: "event", at: event.created_at, event })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">Nothing here yet.</p>;
  }

  return (
    <ol className="space-y-4">
      {entries.map((entry) =>
        entry.kind === "comment" ? (
          <CommentEntry key={`c-${entry.comment.id}`} comment={entry.comment} />
        ) : (
          <EventEntry key={`e-${entry.event.id}`} event={entry.event} />
        ),
      )}
    </ol>
  );
}

function CommentEntry({ comment }: { comment: CommentWithAuthor }) {
  const author = comment.author;
  return (
    <li className="flex gap-3">
      <Avatar person={author} />
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">
            {author?.full_name ?? author?.email ?? "Someone"}
          </span>
          <span aria-hidden="true">·</span>
          <time dateTime={comment.created_at}>{formatRelative(comment.created_at)}</time>
          {comment.is_internal && (
            <StatusPill tone="warning">Internal — client can&rsquo;t see this</StatusPill>
          )}
        </div>
        <Card
          className={`p-3 text-sm ${comment.is_internal ? "border-warning/40 bg-warning/5" : ""}`}
        >
          <RichTextView html={comment.body} />
        </Card>
      </div>
    </li>
  );
}

const EVENT_ICON: Record<string, typeof CircleDot> = {
  created: Plus,
  status_changed: CircleDot,
  priority_changed: CircleDot,
  type_changed: CircleDot,
  assigned: UserRound,
  unassigned: UserRound,
  due_date_changed: CalendarClock,
  eta_changed: CalendarClock,
  estimate_changed: CalendarClock,
  attached: Paperclip,
};

function EventEntry({ event }: { event: EventWithActor }) {
  const Icon = EVENT_ICON[event.kind] ?? MessageSquare;
  const who = event.actor?.full_name ?? event.actor?.email ?? "Someone";

  return (
    <li className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="grid h-8 w-8 shrink-0 place-items-center">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium text-foreground">{who}</span> {describeEvent(event)}
      </span>
      <time dateTime={event.created_at} className="shrink-0">
        {formatRelative(event.created_at)}
      </time>
    </li>
  );
}

function describeEvent(event: EventWithActor): React.ReactNode {
  const from = event.old_value;
  const to = event.new_value;

  switch (event.kind) {
    case "created":
      return "opened this";
    case "status_changed":
      return (
        <>
          moved it from {label(TICKET_STATUS_LABEL, from)} <Arrow />{" "}
          {label(TICKET_STATUS_LABEL, to)}
        </>
      );
    case "priority_changed":
      return (
        <>
          changed priority from {label(TICKET_PRIORITY_LABEL, from)} <Arrow />{" "}
          {label(TICKET_PRIORITY_LABEL, to)}
        </>
      );
    case "type_changed":
      return (
        <>
          re-typed it from {label(TICKET_TYPE_LABEL, from)} <Arrow /> {label(TICKET_TYPE_LABEL, to)}
        </>
      );
    case "assigned":
      return "took this on";
    case "unassigned":
      return "unassigned it";
    case "due_date_changed":
      return to ? `set the due date to ${to}` : "cleared the due date";
    case "eta_changed":
      return to ? `told the client to expect it by ${to}` : "removed the ETA";
    case "estimate_changed":
      return to ? `estimated ${to} hours` : "removed the estimate";
    case "attached":
      return "attached a file";
    default:
      return event.kind.replace(/_/g, " ");
  }
}

function Arrow() {
  return <ArrowRight className="inline h-3 w-3 align-[-1px]" aria-hidden="true" />;
}

/** Enum values arrive as text from the audit columns, so look up defensively. */
function label(map: Record<string, string>, value: string | null): string {
  if (!value) return "nothing";
  return map[value] ?? value.replace(/_/g, " ");
}

function Avatar({ person }: { person: PersonRef | null }) {
  return (
    <span
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent text-xs"
      aria-hidden="true"
    >
      {initials(person?.full_name ?? person?.email)}
    </span>
  );
}

export type { TicketStatus, TicketPriority, TicketType };
