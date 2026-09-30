import { useState } from "react";
import { TicketCard } from "@/features/tickets/ticket-row";
import { TICKET_BOARD_ORDER, TICKET_STATUS_LABEL, type TicketStatus } from "@/data/enums";
import type { TicketListRow } from "@/data/types";

/**
 * Drag to change status, with a keyboard equivalent — the columns are listboxes
 * and each card can be moved with the arrow keys, because a board that only
 * works with a mouse is a board half the triage shortcuts cannot reach.
 */
export function TicketBoard({
  tickets,
  onMove,
}: {
  tickets: TicketListRow[];
  onMove: (ticketId: string, status: TicketStatus) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<TicketStatus | null>(null);

  const byStatus = new Map<TicketStatus, TicketListRow[]>();
  for (const status of TICKET_BOARD_ORDER) byStatus.set(status, []);
  for (const ticket of tickets) {
    byStatus.get(ticket.status)?.push(ticket);
  }

  const move = (ticketId: string, direction: -1 | 1, from: TicketStatus) => {
    const index = TICKET_BOARD_ORDER.indexOf(from);
    const next = TICKET_BOARD_ORDER[index + direction];
    if (next) onMove(ticketId, next);
  };

  return (
    <div className="flex h-full items-start gap-3.5 overflow-x-auto px-6 py-5">
      {TICKET_BOARD_ORDER.map((status) => {
        const column = byStatus.get(status) ?? [];
        return (
          <section
            key={status}
            aria-label={TICKET_STATUS_LABEL[status]}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(status);
            }}
            onDragLeave={() => setOver((s) => (s === status ? null : s))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = dragging ?? e.dataTransfer.getData("text/plain");
              if (id) onMove(id, status);
              setDragging(null);
            }}
            className={`flex w-[264px] shrink-0 flex-col gap-2.5 rounded-[14px] border bg-surface p-3 transition-colors ${
              over === status ? "border-primary bg-accent/40" : ""
            }`}
          >
            <header className="flex items-center px-1">
              <h3 className="flex-1 font-display text-xl leading-tight">
                {TICKET_STATUS_LABEL[status]}
              </h3>
              <span className="text-xs tabular-nums text-muted-foreground">{column.length}</span>
            </header>

            <ul className="space-y-2.5">
              {column.map((ticket) => (
                <li
                  key={ticket.id}
                  draggable
                  onDragStart={(e) => {
                    setDragging(ticket.id);
                    e.dataTransfer.setData("text/plain", ticket.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => setDragging(null)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" && e.shiftKey) {
                      e.preventDefault();
                      move(ticket.id, 1, status);
                    } else if (e.key === "ArrowLeft" && e.shiftKey) {
                      e.preventDefault();
                      move(ticket.id, -1, status);
                    }
                  }}
                  tabIndex={0}
                  aria-label={`${ticket.title}. Shift plus arrow keys to change status.`}
                  className={`rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    dragging === ticket.id ? "opacity-40" : ""
                  }`}
                >
                  <TicketCard ticket={ticket} origin={{ from: "triage" }} />
                </li>
              ))}
              {column.length === 0 && (
                <li
                  className="px-2 py-6 text-center text-xs text-muted-foreground"
                  aria-hidden="true"
                >
                  Nothing here
                </li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
