import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Inbox, LayoutGrid, List, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { SectionBoundary } from "@/components/error-boundary";
import { useAuth } from "@/components/auth-provider";
import { FilterBar } from "@/features/triage/filter-bar";
import { TicketBoard } from "@/features/triage/ticket-board";
import { BulkBar } from "@/features/triage/bulk-bar";
import { ViewsRail } from "@/features/triage/views-rail";
import { TicketRow } from "@/features/tickets/ticket-row";
import { useServerAction } from "@/lib/use-server-action";
import { bulkUpdateTickets, deleteView, saveView } from "@/lib/tickets.functions";
import { ticketFiltersSchema, type TicketFilters } from "@/data/filters";
import { ticketCountsQuery, ticketListQuery } from "@/data/tickets";
import { projectListQuery, workspacePeopleQuery } from "@/data/projects";
import { savedViewsQuery } from "@/data/views";
import { qk } from "@/data/keys";
import type { TicketPriority, TicketStatus } from "@/data/enums";

/**
 * The queue.
 *
 * This route did not exist. Tickets could only be reached by opening a project
 * first, which is the wrong shape for the person whose job is every client at
 * once — there was no way to ask "what is overdue" or "what has nobody
 * answered" without visiting each project in turn.
 *
 * Filter state lives entirely in the URL. That makes a filtered queue a link
 * you can send, makes the back button undo a filter, lets the loader prefetch
 * before the component mounts, and makes a saved view nothing more than these
 * search params stored in a row.
 */
export const Route = createFileRoute("/app/triage")({
  validateSearch: ticketFiltersSchema,
  component: TriagePage,
});

function TriagePage() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const viewerId = user?.id ?? "";

  const setFilters = useCallback(
    (next: Partial<TicketFilters>, viewId?: string) => {
      setSelected(new Set());
      void navigate({
        search: (prev) => ({ ...prev, ...next, ...(viewId !== undefined ? { view: viewId } : {}) }),
      });
    },
    [navigate],
  );

  const tickets = useInfiniteQuery({
    ...ticketListQuery(search, viewerId),
    enabled: Boolean(viewerId),
  });
  const counts = useQuery({ ...ticketCountsQuery(viewerId), enabled: Boolean(viewerId) });
  const projects = useQuery(projectListQuery());
  const people = useQuery(workspacePeopleQuery());
  const views = useQuery(savedViewsQuery());

  const rows = useMemo(
    () => tickets.data?.pages.flatMap((page) => page.rows) ?? [],
    [tickets.data],
  );

  const invalidateQueue = () => [qk.tickets()];

  const bulk = useServerAction(useServerFn(bulkUpdateTickets), {
    label: "tickets.bulkUpdate",
    invalidate: invalidateQueue,
    success: (result) =>
      result.failed.length
        ? `${result.updated.length} updated, ${result.failed.length} couldn't be`
        : `${result.updated.length} tickets updated`,
    onSuccess: () => setSelected(new Set()),
  });

  const persistView = useServerAction(useServerFn(saveView), {
    label: "views.save",
    success: "View saved",
    invalidate: [qk.savedViews()],
  });

  const removeView = useServerAction(useServerFn(deleteView), {
    label: "views.delete",
    success: "View deleted",
    invalidate: [qk.savedViews()],
    onSuccess: () => {
      if (search.view) setFilters({}, undefined);
    },
  });

  const moveOnBoard = (ticketId: string, status: TicketStatus) => {
    // Optimistic: dropping a card should land instantly. useServerAction rolls
    // the cache back and explains if the write is rejected.
    queryClient.setQueriesData<typeof tickets.data>({ queryKey: qk.tickets() }, (old) =>
      old
        ? {
            ...old,
            pages: old.pages.map((page) => ({
              ...page,
              rows: page.rows.map((row) => (row.id === ticketId ? { ...row, status } : row)),
            })),
          }
        : old,
    );
    bulk.fire({ ticketIds: [ticketId], status });
  };

  if (!isAdmin) {
    return (
      <>
        <PageHeader title="Triage" />
        <div className="mx-auto max-w-3xl px-4 py-16">
          <EmptyState
            icon={Inbox}
            title="This is the admin queue"
            description="Your own tickets are on the My tickets page."
          />
        </div>
      </>
    );
  }

  const toggleSelected = (id: string, next: boolean) => {
    setSelected((prev) => {
      const copy = new Set(prev);
      if (next) copy.add(id);
      else copy.delete(id);
      return copy;
    });
  };

  return (
    <div className="flex h-screen flex-col">
      <PageHeader
        title="Triage"
        description={`${rows.length}${tickets.hasNextPage ? "+" : ""} tickets`}
        action={
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilters({ board: !search.board })}
            aria-pressed={Boolean(search.board)}
          >
            {search.board ? (
              <>
                <List className="mr-1.5 h-4 w-4" aria-hidden="true" />
                List
              </>
            ) : (
              <>
                <LayoutGrid className="mr-1.5 h-4 w-4" aria-hidden="true" />
                Board
              </>
            )}
          </Button>
        }
      />

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-56 shrink-0 border-r lg:block">
          <SectionBoundary label="views-rail">
            <ViewsRail
              counts={counts.data}
              views={views.data ?? []}
              activeViewId={search.view}
              currentFilters={search}
              canSave={Boolean(search.q || search.status?.length || search.projectId || search.sla)}
              onApply={setFilters}
              onSave={(name) =>
                persistView.fire({ name, filters: { ...search, view: undefined }, isShared: false })
              }
              onDelete={(viewId) => removeView.fire({ viewId })}
            />
          </SectionBoundary>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <FilterBar
            filters={search}
            onChange={(next) => setFilters(next, undefined)}
            projects={projects.data ?? []}
            people={people.data ?? []}
          />

          <BulkBar
            count={selected.size}
            busy={bulk.busy}
            people={people.data ?? []}
            onStatus={(status: TicketStatus) => bulk.fire({ ticketIds: [...selected], status })}
            onPriority={(priority: TicketPriority) =>
              bulk.fire({ ticketIds: [...selected], priority })
            }
            onAssignee={(assigneeId) => bulk.fire({ ticketIds: [...selected], assigneeId })}
            onClear={() => setSelected(new Set())}
          />

          <div className="min-h-0 flex-1 overflow-y-auto">
            <QueryState
              query={tickets}
              errorTitle="Couldn't load the queue"
              empty={
                <EmptyState
                  icon={Inbox}
                  title="Nothing here"
                  description="No tickets match these filters. Try clearing one."
                />
              }
            >
              {() =>
                search.board ? (
                  <TicketBoard tickets={rows} onMove={moveOnBoard} />
                ) : (
                  <>
                    <ul>
                      {rows.map((ticket) => (
                        <li key={ticket.id}>
                          <TicketRow
                            ticket={ticket}
                            selected={selected.has(ticket.id)}
                            onSelectedChange={(next) => toggleSelected(ticket.id, next)}
                          />
                        </li>
                      ))}
                    </ul>

                    {tickets.hasNextPage && (
                      <div className="p-4 text-center">
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
                )
              }
            </QueryState>
          </div>
        </div>
      </div>
    </div>
  );
}
