import { memo } from "react";
import { Link } from "@tanstack/react-router";
import { Paperclip } from "lucide-react";
import { StatusPill } from "@/components/status-pill";
import { Checkbox } from "@/components/ui/checkbox";
import { SlaBadge } from "./sla-badge";
import { formatRelative } from "@/lib/utils-format";
import { PersonAvatar, personName } from "@/components/person-avatar";
import {
  TICKET_PRIORITY_LABEL,
  TICKET_PRIORITY_TONE,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
} from "@/data/enums";
import type { TicketOrigin } from "@/data/ticket-origin";
import type { PersonRef, TicketListRow } from "@/data/types";

/**
 * Column header for a list of `TicketRow`s. The widths mirror the row so the
 * header sits on the same grid; it lives in the muted surface the design uses
 * for every table.
 */
export function TicketListHeader({
  selectable = false,
  allSelected = false,
  onSelectAll,
  showProject = true,
}: {
  selectable?: boolean;
  allSelected?: boolean;
  onSelectAll?: () => void;
  showProject?: boolean;
}) {
  return (
    <div
      className={`flex items-center gap-3 bg-surface px-4 py-2 text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground max-md:gap-2 max-md:border-b max-md:py-0 ${
        selectable ? "" : "max-md:hidden"
      }`}
    >
      {selectable && (
        <button
          type="button"
          onClick={onSelectAll}
          className="w-[54px] shrink-0 text-left uppercase hover:text-foreground max-md:h-11 max-md:w-auto max-md:pr-4"
        >
          {allSelected ? "Clear" : "Select all"}
        </button>
      )}
      <span className="w-10 shrink-0 max-md:hidden">#</span>
      <span className="min-w-0 flex-1 max-md:hidden">Ticket</span>
      {showProject && <span className="hidden w-24 shrink-0 lg:block">Project</span>}
      <span className="hidden w-[104px] shrink-0 md:block">SLA</span>
      <span className="w-24 shrink-0 max-md:hidden">Status</span>
      <span className="hidden w-6 shrink-0 md:block" />
    </div>
  );
}

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
  origin,
}: {
  ticket: TicketListRow;
  selected?: boolean;
  onSelectedChange?: (next: boolean) => void;
  active?: boolean;
  showProject?: boolean;
  origin?: TicketOrigin;
}) {
  const search: TicketOrigin = origin ?? {};

  return (
    <div
      className={`group flex items-center gap-3 border-t px-4 py-[11px] transition-colors first:border-t-0 max-md:gap-1 max-md:py-2.5 ${
        selected ? "bg-accent/50" : active ? "bg-accent/40" : "hover:bg-surface"
      }`}
    >
      {onSelectedChange && (
        <span className="flex w-[54px] shrink-0 items-center max-md:-ml-3 max-md:w-11 max-md:justify-center max-md:self-stretch">
          <Checkbox
            checked={selected}
            onCheckedChange={(next) => onSelectedChange(next === true)}
            aria-label={`Select ticket #${ticket.ticket_number}`}
          />
        </span>
      )}

      <Link
        to="/app/tickets/$ticketId"
        params={{ ticketId: ticket.id }}
        search={search}
        className="flex min-w-0 flex-1 items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:flex-col max-md:items-stretch max-md:gap-1.5 max-md:py-0.5 max-md:pl-2"
      >
        <span className="w-10 shrink-0 font-mono text-xs text-muted-foreground max-md:hidden">
          #{ticket.ticket_number}
        </span>

        <StatusPill tone={TICKET_PRIORITY_TONE[ticket.priority]} className="shrink-0 max-md:hidden">
          {TICKET_PRIORITY_LABEL[ticket.priority]}
        </StatusPill>

        <span className="min-w-0 flex-1 truncate text-sm font-medium max-md:flex-none max-md:line-clamp-2 max-md:whitespace-normal max-md:text-[15px] max-md:leading-snug">
          {ticket.title}
        </span>

        <span className="flex flex-wrap items-center gap-x-2 gap-y-1.5 md:hidden">
          <span className="font-mono text-xs text-muted-foreground">#{ticket.ticket_number}</span>
          <StatusPill tone={TICKET_PRIORITY_TONE[ticket.priority]}>
            {TICKET_PRIORITY_LABEL[ticket.priority]}
          </StatusPill>
          <StatusPill tone={TICKET_STATUS_TONE[ticket.status]}>
            {TICKET_STATUS_LABEL[ticket.status]}
          </StatusPill>
          <SlaBadge dueAt={ticket.sla_due_at} status={ticket.status} />
          {showProject && ticket.project ? (
            <span className="max-w-[9rem] truncate text-xs text-muted-foreground">
              {ticket.project.title}
            </span>
          ) : null}
          <span className="text-xs text-muted-foreground">{formatRelative(ticket.updated_at)}</span>
          <AssigneeFace assignee={ticket.assignee} className="ml-auto" />
        </span>
      </Link>

      {showProject && (
        <span className="hidden w-24 shrink-0 truncate text-xs text-muted-foreground lg:block">
          {ticket.project ? (
            <Link
              to="/app/projects/$projectId"
              params={{ projectId: ticket.project.id }}
              search={{ tab: "tickets" }}
              className="underline-offset-2 hover:underline"
            >
              {ticket.project.title}
            </Link>
          ) : null}
        </span>
      )}

      <span className="hidden w-[104px] shrink-0 md:block">
        <SlaBadge dueAt={ticket.sla_due_at} status={ticket.status} />
      </span>

      <span className="w-24 shrink-0 max-md:hidden">
        <StatusPill tone={TICKET_STATUS_TONE[ticket.status]}>
          {TICKET_STATUS_LABEL[ticket.status]}
        </StatusPill>
      </span>

      <AssigneeFace assignee={ticket.assignee} className="max-md:hidden" />
    </div>
  );
});

/** The same ticket as a card, for the board. */
export const TicketCard = memo(function TicketCard({
  ticket,
  origin,
}: {
  ticket: TicketListRow;
  origin?: TicketOrigin;
}) {
  return (
    <Link
      to="/app/tickets/$ticketId"
      params={{ ticketId: ticket.id }}
      search={origin ?? {}}
      className="flex flex-col gap-2 rounded-xl border bg-card p-3 transition-colors hover:border-primary/50 max-md:gap-2.5 max-md:p-3.5"
    >
      <div className="flex items-center gap-2 text-xs max-md:pr-9">
        <span className="font-mono text-muted-foreground">#{ticket.ticket_number}</span>
        <StatusPill tone={TICKET_PRIORITY_TONE[ticket.priority]}>
          {TICKET_PRIORITY_LABEL[ticket.priority]}
        </StatusPill>
      </div>
      <p className="line-clamp-3 text-sm font-medium leading-snug max-md:text-[15px]">
        {ticket.title}
      </p>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {ticket.project?.title ?? formatRelative(ticket.updated_at)}
        </span>
        <SlaBadge dueAt={ticket.sla_due_at} status={ticket.status} />
        <AssigneeFace assignee={ticket.assignee} />
      </div>
    </Link>
  );
});

/** The assignee's face, or a dash. Named for screen readers and on hover. */
function AssigneeFace({ assignee, className }: { assignee: PersonRef | null; className?: string }) {
  if (!assignee) {
    return (
      <span
        role="img"
        aria-label="Unassigned"
        title="Unassigned"
        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border border-dashed text-[10px] text-muted-foreground ${className ?? ""}`}
      >
        —
      </span>
    );
  }
  const name = personName(assignee);
  return (
    <PersonAvatar person={assignee} size="sm" label={`Assigned to ${name}`} className={className} />
  );
}

export { Paperclip };
