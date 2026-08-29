import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { Paperclip } from "lucide-react";
import { StatusPill } from "@/components/app-shell";
import { Checkbox } from "@/components/ui/checkbox";
import { SlaBadge } from "./sla-badge";
import { formatRelative, initials } from "@/lib/utils-format";
import {
  TICKET_PRIORITY_LABEL,
  TICKET_PRIORITY_TONE,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  TICKET_TYPE_LABEL,
} from "@/data/enums";
import type { TicketListRow } from "@/data/types";

/**
 * Memoised: the queue re-renders on every selection change and every keyboard
 * move, and a page is forty of these. Only the props that affect the row are
 * compared — the callback identity deliberately is not, because the parent
 * recreates it per row.
 */
export const TicketRow = memo(function TicketRow({
  ticket,
  selected,
  onSelectedChange,
  active,
  showProject = true,
}: {
  ticket: TicketListRow;
  selected?: boolean;
  onSelectedChange?: (next: boolean) => void;
  active?: boolean;
  showProject?: boolean;
}) {
  const who = ticket.assignee ?? ticket.reporter;

  return (
    <div
      className={`group flex items-center gap-3 border-b px-3 py-2.5 last:border-b-0 ${
        active ? "bg-accent/60" : "hover:bg-accent/30"
      }`}
    >
      {onSelectedChange && (
        <Checkbox
          checked={selected}
          onCheckedChange={(next) => onSelectedChange(next === true)}
          aria-label={`Select ticket #${ticket.ticket_number}`}
          className="shrink-0"
        />
      )}

      <Link
        to="/app/tickets/$ticketId"
        params={{ ticketId: ticket.id }}
        className="flex min-w-0 flex-1 items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
          #{ticket.ticket_number}
        </span>

        <StatusPill tone={TICKET_PRIORITY_TONE[ticket.priority]} className="shrink-0">
          {TICKET_PRIORITY_LABEL[ticket.priority]}
        </StatusPill>

        <span className="min-w-0 flex-1 truncate text-sm">{ticket.title}</span>

        {ticket.labels.length > 0 && (
          <span className="hidden shrink-0 gap-1 lg:flex">
            {ticket.labels.slice(0, 2).map((label) => (
              <StatusPill key={label}>{label}</StatusPill>
            ))}
          </span>
        )}

        <span className="hidden shrink-0 md:inline">
          <SlaBadge dueAt={ticket.sla_due_at} status={ticket.status} />
        </span>

        {showProject && ticket.project && (
          <span className="hidden w-32 shrink-0 truncate text-xs text-muted-foreground lg:inline">
            {ticket.project.title}
          </span>
        )}

        <span className="hidden w-20 shrink-0 text-xs text-muted-foreground xl:inline">
          {TICKET_TYPE_LABEL[ticket.type]}
        </span>

        <StatusPill tone={TICKET_STATUS_TONE[ticket.status]} className="shrink-0">
          {TICKET_STATUS_LABEL[ticket.status]}
        </StatusPill>

        <span className="hidden w-16 shrink-0 text-right text-xs text-muted-foreground sm:inline">
          {formatRelative(ticket.updated_at)}
        </span>

        <span
          className="hidden h-6 w-6 shrink-0 place-items-center rounded-full bg-accent text-[10px] sm:grid"
          title={who?.full_name ?? who?.email ?? "Unassigned"}
        >
          {ticket.assignee ? initials(ticket.assignee.full_name ?? ticket.assignee.email) : "—"}
        </span>
      </Link>
    </div>
  );
});

/** The same ticket as a card, for the board and for narrow screens. */
export const TicketCard = memo(function TicketCard({ ticket }: { ticket: TicketListRow }) {
  return (
    <Link
      to="/app/tickets/$ticketId"
      params={{ ticketId: ticket.id }}
      className="block rounded-lg border bg-card p-3 transition-colors hover:border-foreground/20"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">#{ticket.ticket_number}</span>
        <StatusPill tone={TICKET_PRIORITY_TONE[ticket.priority]}>
          {TICKET_PRIORITY_LABEL[ticket.priority]}
        </StatusPill>
        <span className="ml-auto">
          <SlaBadge dueAt={ticket.sla_due_at} status={ticket.status} />
        </span>
      </div>
      <p className="line-clamp-2 text-sm">{ticket.title}</p>
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        {ticket.project && <span className="truncate">{ticket.project.title}</span>}
        <span className="ml-auto shrink-0">{formatRelative(ticket.updated_at)}</span>
        {ticket.assignee && (
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent text-[10px]">
            {initials(ticket.assignee.full_name ?? ticket.assignee.email)}
          </span>
        )}
      </div>
      {ticket.labels.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {ticket.labels.map((label) => (
            <StatusPill key={label}>{label}</StatusPill>
          ))}
        </div>
      )}
    </Link>
  );
});

export { Paperclip };
