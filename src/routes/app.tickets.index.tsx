import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Bug, Loader2, Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { TicketRow } from "@/features/tickets/ticket-row";
import { ticketListQuery } from "@/data/tickets";
import { ticketFiltersSchema } from "@/data/filters";
import { OPEN_TICKET_STATUSES } from "@/data/enums";

/**
 * Everything this person has reported, across every project.
 *
 * This route simply did not exist. A client with three projects could only find
 * their tickets by opening each project in turn — there was no answer to "what
 * did I report and where has it got to", which is the single question a client
 * portal exists to answer.
 */
export const Route = createFileRoute("/app/tickets/")({
  validateSearch: ticketFiltersSchema,
  component: MyTicketsPage,
});

function MyTicketsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { user, isAdmin } = useAuth();

  const showClosed = search.status?.includes("done") ?? false;

  const tickets = useInfiniteQuery({
    ...ticketListQuery(
      {
        ...search,
        // Admins get every ticket here; a client sees their own.
        reporter: isAdmin ? search.reporter : "me",
        status: showClosed ? undefined : [...OPEN_TICKET_STATUSES],
      },
      user?.id ?? "",
    ),
    enabled: Boolean(user),
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
              size="sm"
              aria-pressed={showClosed}
              onClick={() =>
                void navigate({
                  search: (prev) => ({ ...prev, status: showClosed ? undefined : ["done"] }),
                })
              }
            >
              {showClosed ? "Show open" : "Show closed"}
            </Button>
            <Button asChild size="sm">
              <Link to="/app/report">
                <Bug className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Report something
              </Link>
            </Button>
          </div>
        }
      />

      <div className="mx-auto max-w-4xl px-4 py-6 md:px-8 md:py-8">
        <QueryState
          query={tickets}
          errorTitle="Couldn't load your tickets"
          empty={
            <div className="rounded-lg border">
              <EmptyState
                icon={Ticket}
                title={showClosed ? "Nothing closed yet" : "Nothing open"}
                description={
                  showClosed
                    ? "Tickets you've had resolved will show up here."
                    : "When something's not right, tell us — a screenshot is usually enough."
                }
                action={
                  !showClosed && (
                    <Button asChild>
                      <Link to="/app/report">
                        <Bug className="mr-1.5 h-4 w-4" aria-hidden="true" />
                        Report something
                      </Link>
                    </Button>
                  )
                }
              />
            </div>
          }
        >
          {() => (
            <>
              <div className="overflow-hidden rounded-lg border">
                <ul>
                  {rows.map((ticket) => (
                    <li key={ticket.id}>
                      <TicketRow ticket={ticket} />
                    </li>
                  ))}
                </ul>
              </div>

              {rows.some((t) => t.eta_date) && (
                <p className="mt-3 text-xs text-muted-foreground">
                  <StatusPill tone="info">ETA</StatusPill> dates are our current estimate, and
                  we&rsquo;ll tell you here if one moves.
                </p>
              )}

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
