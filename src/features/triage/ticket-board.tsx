import { useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { TicketCard } from "@/features/tickets/ticket-row";
import { TICKET_BOARD_ORDER, TICKET_STATUS_LABEL, type TicketStatus } from "@/data/enums";
import type { TicketListRow } from "@/data/types";

/** Phone gutter of the snap scroller; column offsets are measured against it. */
const MOBILE_GUTTER = 16;

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
  const [moving, setMoving] = useState<TicketListRow | null>(null);
  const [activeColumn, setActiveColumn] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

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

  const trackColumn = () => {
    const el = scroller.current;
    if (!el) return;
    const columns = Array.from(el.children) as HTMLElement[];
    let best = 0;
    let bestDistance = Infinity;
    columns.forEach((column, index) => {
      const distance = Math.abs(column.offsetLeft - MOBILE_GUTTER - el.scrollLeft);
      if (distance < bestDistance) {
        best = index;
        bestDistance = distance;
      }
    });
    setActiveColumn(best);
  };

  const showColumn = (index: number) => {
    const el = scroller.current;
    const column = el?.children[index] as HTMLElement | undefined;
    if (!el || !column) return;
    setActiveColumn(index);
    el.scrollTo({ left: column.offsetLeft - MOBILE_GUTTER, behavior: "smooth" });
  };

  return (
    <>
      <div
        role="tablist"
        aria-label="Board columns"
        className="no-scrollbar sticky top-[calc(var(--mobile-topbar-h)+3.75rem)] z-10 flex gap-2 overflow-x-auto border-b bg-background/95 px-4 py-2 backdrop-blur md:hidden"
      >
        {TICKET_BOARD_ORDER.map((status, index) => (
          <button
            key={status}
            type="button"
            role="tab"
            aria-selected={activeColumn === index}
            onClick={() => showColumn(index)}
            className={`flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors ${
              activeColumn === index
                ? "border-primary bg-accent font-medium"
                : "bg-card text-muted-foreground"
            }`}
          >
            {TICKET_STATUS_LABEL[status]}
            <span className="text-xs tabular-nums text-muted-foreground">
              {byStatus.get(status)?.length ?? 0}
            </span>
          </button>
        ))}
      </div>

      <div
        ref={scroller}
        onScroll={isMobile ? trackColumn : undefined}
        className="relative flex h-full items-start gap-3.5 overflow-x-auto px-6 py-5 max-md:snap-x max-md:snap-mandatory max-md:gap-3 max-md:overscroll-x-contain max-md:px-4 max-md:py-3 max-md:pb-6"
      >
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
              className={`flex w-[264px] shrink-0 flex-col gap-2.5 rounded-[14px] border bg-surface p-3 transition-colors max-md:w-[calc(100vw-3.5rem)] max-md:snap-start ${
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
                    draggable={!isMobile}
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
                    className={`relative rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      dragging === ticket.id ? "opacity-40" : ""
                    }`}
                  >
                    <TicketCard ticket={ticket} origin={{ from: "triage" }} />
                    <button
                      type="button"
                      aria-label={`Move #${ticket.ticket_number} to another status`}
                      onClick={() => setMoving(ticket)}
                      className="absolute right-0.5 top-0.5 grid h-11 w-11 place-items-center rounded-full text-muted-foreground active:bg-accent md:hidden"
                    >
                      <ChevronsUpDown className="h-4 w-4" aria-hidden="true" />
                    </button>
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

      <Sheet open={moving !== null} onOpenChange={(open) => !open && setMoving(null)}>
        <SheetContent side="bottom" className="px-0 pt-9 md:hidden">
          <SheetHeader className="px-5 text-left">
            <SheetTitle>Move to</SheetTitle>
            <SheetDescription className="line-clamp-2">
              {moving ? `#${moving.ticket_number} ${moving.title}` : ""}
            </SheetDescription>
          </SheetHeader>
          <ul className="mt-3">
            {TICKET_BOARD_ORDER.map((status) => {
              const current = moving?.status === status;
              return (
                <li key={status}>
                  <button
                    type="button"
                    disabled={current}
                    onClick={() => {
                      if (moving && !current) onMove(moving.id, status);
                      setMoving(null);
                    }}
                    className="flex h-12 w-full items-center gap-3 px-5 text-left text-[15px] active:bg-accent disabled:text-muted-foreground"
                  >
                    <Check
                      className={`h-4 w-4 shrink-0 ${current ? "opacity-100" : "opacity-0"}`}
                      aria-hidden="true"
                    />
                    {TICKET_STATUS_LABEL[status]}
                  </button>
                </li>
              );
            })}
          </ul>
        </SheetContent>
      </Sheet>
    </>
  );
}
