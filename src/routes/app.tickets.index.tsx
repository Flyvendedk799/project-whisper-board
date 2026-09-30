import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { ticketListQuery } from "@/data/tickets";
import { ticketFiltersSchema, type TicketFilters } from "@/data/filters";
import {
  CLOSED_TICKET_STATUSES,
  OPEN_TICKET_STATUSES,
  TICKET_STATUS_LABEL,
  TICKET_STATUS_TONE,
  type TicketStatus,
} from "@/data/enums";
import { SlaBadge } from "@/features/tickets/sla-badge";
import { formatDate, formatRelative } from "@/lib/utils-format";
import type { TicketListRow } from "@/data/types";

/**
 * Everything this person has reported, across every project.
 *
 * A client with three projects could only find their tickets by opening each
 * project in turn — there was no answer to "what did I report and where has it
 * got to", which is the single question a client portal exists to answer.
 */
export const Route = createFileRoute("/app/tickets/")({
  validateSearch: ticketFiltersSchema,
  component: MyTicketsPage,
});

function MyTicketsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { user, isAdmin, workspaceId } = useAuth();

  const showClosed =
    search.status?.some((s: TicketStatus) => CLOSED_TICKET_STATUSES.includes(s)) ?? false;

  const tickets = useInfiniteQuery({
    ...ticketListQuery(
      {
        ...search,
        // Admins get every ticket here; a client sees their own.
        reporter: isAdmin ? search.reporter : "me",
        status: showClosed ? [...CLOSED_TICKET_STATUSES] : [...OPEN_TICKET_STATUSES],
      },
      user?.id ?? "",
      workspaceId,
    ),
    enabled: Boolean(user && workspaceId),
  });

  const rows = tickets.data?.pages.flatMap((page) => page.rows) ?? [];

  return (
    <>
      <PageHeader
        title="My tickets"
        description="Everything you've reported, and where it's got to."
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              aria-pressed={showClosed}
              onClick={() =>
                void navigate({
                  search: (prev: TicketFilters) => ({
                    ...prev,
                    status: showClosed ? undefined : [...CLOSED_TICKET_STATUSES],
                  }),
                })
              }
            >
              {showClosed ? "Show open" : "Show closed"}
            </Button>
            <Button asChild>
              <Link to="/app/report">
                <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                Report something
              </Link>
            </Button>
          </div>
        }
      />

      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-7">
        <QueryState
          query={tickets}
          errorTitle="Couldn't load your tickets"
          empty={
            <div className="rounded-[14px] border bg-card">
              <EmptyState
                title={showClosed ? "Nothing closed yet" : "Nothing open"}
                description={
                  showClosed
                    ? "Tickets you've had resolved will show up here."
                    : "When something's not right, tell us. A screenshot is usually enough."
                }
                action={
                  !showClosed && (
                    <Button asChild>
                      <Link to="/app/report">Report something</Link>
                    </Button>
                  )
                }
              />
            </div>
          }
        >
          {() => (
            <>
              <TicketsTable rows={rows} />

              <p className="mt-3 text-xs text-muted-foreground">
                ETA dates are our current estimate, and we&rsquo;ll tell you here if one moves.
              </p>

              {tickets.hasNextPage && (
                <div className="mt-4 text-center">
                  <Button
                    variant="outline"
                    onClick={() => void tickets.fetchNextPage()}
                    disabled={tickets.isFetchingNextPage}
                  >
                    {tickets.isFetchingNextPage ? (
                      <>
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                        Loading
                      </>
                    ) : (
                      "Load more"
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </QueryState>
      </div>
    </>
  );
}

function TicketsTable({ rows }: { rows: TicketListRow[] }) {
  return (
    <div className="overflow-hidden rounded-[14px] border bg-card">
      <div className="flex gap-3 bg-surface px-4 py-2.5 text-xs text-muted-foreground">
        <span className="w-12 shrink-0">#</span>
        <span className="min-w-0 flex-[4]">Ticket</span>
        <span className="hidden min-w-0 flex-[1.6] md:block">Project</span>
        <span className="min-w-0 flex-[1.2]">Status</span>
        <span className="hidden min-w-0 flex-[0.8] sm:block">ETA</span>
        <span className="hidden min-w-0 flex-[0.9] text-right sm:block">Updated</span>
      </div>
      <ul>
        {rows.map((ticket) => (
          <li key={ticket.id} className="border-t">
            <Link
              to="/app/tickets/$ticketId"
              params={{ ticketId: ticket.id }}
              search={{ from: "tickets" }}
              className="flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="w-12 shrink-0 font-mono text-xs text-muted-foreground">
                #{ticket.ticket_number}
              </span>
              <span className="flex min-w-0 flex-[4] items-center gap-2">
                <span className="truncate font-medium">{ticket.title}</span>
                <SlaBadge dueAt={ticket.sla_due_at} status={ticket.status} />
              </span>
              <span className="hidden min-w-0 flex-[1.6] truncate text-muted-foreground md:block">
                {ticket.project?.title ?? ""}
              </span>
              <span className="min-w-0 flex-[1.2]">
                <StatusPill tone={TICKET_STATUS_TONE[ticket.status]}>
                  {TICKET_STATUS_LABEL[ticket.status]}
                </StatusPill>
              </span>
              <span className="hidden min-w-0 flex-[0.8] text-muted-foreground sm:block">
                {ticket.eta_date ? formatDate(ticket.eta_date) : "—"}
              </span>
              <span className="hidden min-w-0 flex-[0.9] text-right text-muted-foreground sm:block">
                {formatRelative(ticket.updated_at)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
