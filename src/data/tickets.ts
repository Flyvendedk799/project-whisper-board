import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataError } from "@/lib/errors";
import { qk } from "./keys";
import { filterCacheKey, type TicketFilters } from "./filters";
import { CLOSED_TICKET_STATUSES, TICKET_PRIORITIES } from "./enums";
import {
  PAGE_SIZE,
  PERSON_REF_COLUMNS,
  type CommentWithAuthor,
  type EventWithActor,
  type Page,
  type RelationWithTicket,
  type TicketAttachment,
  type TicketDetail,
  type TicketListRow,
  type CaptureContext,
} from "./types";

/**
 * Every read here throws a DataError instead of dropping `error` on the floor,
 * which is what a dozen call sites used to do — a failed fetch and an empty
 * result were indistinguishable, so a broken query rendered as "no tickets".
 */

const LIST_SELECT = `
  id, ticket_number, title, type, priority, status, labels,
  created_at, updated_at, due_date, eta_date, sla_due_at,
  first_response_at, resolved_at, project_id,
  project:projects(id, title, status),
  reporter:profiles!tickets_reporter_id_fkey(${PERSON_REF_COLUMNS}),
  assignee:profiles!tickets_assignee_id_fkey(${PERSON_REF_COLUMNS})
`;

const DETAIL_SELECT = `
  *,
  project:projects(id, title, status),
  reporter:profiles!tickets_reporter_id_fkey(${PERSON_REF_COLUMNS}),
  assignee:profiles!tickets_assignee_id_fkey(${PERSON_REF_COLUMNS})
`;

const AGE_CUTOFF: Record<NonNullable<TicketFilters["age"]>, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

/** Keyset column and direction for each sort, so paging stays stable. */
const SORT: Record<
  NonNullable<TicketFilters["sort"]>,
  { column: keyof TicketListRow & string; ascending: boolean }
> = {
  updated: { column: "updated_at", ascending: false },
  newest: { column: "created_at", ascending: false },
  oldest: { column: "created_at", ascending: true },
  sla: { column: "sla_due_at", ascending: true },
  priority: { column: "priority", ascending: true },
};

const countBuilder = () => supabase.from("tickets").select("id", { count: "exact", head: true });
type CountBuilder = ReturnType<typeof countBuilder>;

/**
 * The slice of a PostgREST builder these filters need, expressed structurally
 * so the same function works on the list select and the head-only count select
 * without either being cast. Every method returns the builder, so `Q` threads
 * through the whole chain.
 */
interface Filterable<Q> {
  eq(column: string, value: unknown): Q;
  in(column: string, values: readonly unknown[]): Q;
  is(column: string, value: null): Q;
  gt(column: string, value: string): Q;
  lt(column: string, value: string): Q;
  lte(column: string, value: string): Q;
  not(column: string, operator: string, value: unknown): Q;
  overlaps(column: string, value: readonly string[]): Q;
  textSearch(column: string, query: string, options: { type: "websearch" }): Q;
}

/**
 * Filters are applied in Postgres, not in the browser. Client-side filtering
 * stops being correct the moment the list is paginated, and search in
 * particular has to reach rows that were never fetched.
 */
function applyFilters<Q extends Filterable<Q>>(
  query: Q,
  filters: TicketFilters,
  viewerId: string,
): Q {
  let q = query;

  if (filters.q) q = q.textSearch("search_tsv", filters.q, { type: "websearch" });
  if (filters.status?.length) q = q.in("status", filters.status);
  if (filters.type?.length) q = q.in("type", filters.type);
  if (filters.priority?.length) q = q.in("priority", filters.priority);
  if (filters.projectId) q = q.eq("project_id", filters.projectId);
  if (filters.labels?.length) q = q.overlaps("labels", filters.labels);

  if (filters.assignee === "unassigned") q = q.is("assignee_id", null);
  else if (filters.assignee === "me") q = q.eq("assignee_id", viewerId);
  else if (filters.assignee) q = q.eq("assignee_id", filters.assignee);

  if (filters.reporter === "me") q = q.eq("reporter_id", viewerId);
  else if (filters.reporter) q = q.eq("reporter_id", filters.reporter);

  if (filters.age) {
    q = q.lte("created_at", new Date(Date.now() - AGE_CUTOFF[filters.age]).toISOString());
  }

  const now = new Date().toISOString();
  const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  if (filters.sla === "breached") {
    q = q.lt("sla_due_at", now).not("status", "in", closedList());
  } else if (filters.sla === "at_risk") {
    // Due inside the next day, but not yet past it.
    q = q.gt("sla_due_at", now).lt("sla_due_at", soon).not("status", "in", closedList());
  } else if (filters.sla === "ok") {
    q = q.gt("sla_due_at", soon);
  }

  // Somebody wrote in and nobody has answered them yet.
  if (filters.awaiting) {
    q = q.is("first_response_at", null).not("status", "in", closedList());
  }

  return q;
}

function closedList() {
  return `(${CLOSED_TICKET_STATUSES.join(",")})`;
}

/**
 * Keyset pagination on the sort column. `.range()` offsets get slower the
 * further you scroll and skip rows when something is inserted mid-scroll.
 */
export function ticketListQuery(filters: TicketFilters, viewerId: string) {
  const sort = SORT[filters.sort ?? "updated"];

  return infiniteQueryOptions({
    queryKey: qk.ticketList(filterCacheKey(filters)),
    initialPageParam: null as string | null,
    getNextPageParam: (last: Page<TicketListRow>) => last.nextCursor,
    queryFn: async ({ pageParam }): Promise<Page<TicketListRow>> => {
      let query = applyFilters(supabase.from("tickets").select(LIST_SELECT), filters, viewerId);

      if (pageParam) {
        query = sort.ascending
          ? query.gt(sort.column, pageParam)
          : query.lt(sort.column, pageParam);
      }

      const { data, error } = await query
        .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(PAGE_SIZE)
        .returns<TicketListRow[]>();

      if (error) throw new DataError("tickets.list", error);

      const rows = data ?? [];
      const last = rows.at(-1);
      const cursorValue = last ? last[sort.column] : null;
      return {
        rows,
        nextCursor:
          rows.length === PAGE_SIZE && typeof cursorValue === "string" ? cursorValue : null,
      };
    },
  });
}

/**
 * The counts beside each saved view in the queue rail. `head: true` means
 * Postgres returns the count without any rows, so six of these is cheaper than
 * fetching one page of tickets.
 */
export function ticketCountsQuery(viewerId: string) {
  return queryOptions({
    queryKey: qk.ticketCounts(),
    queryFn: async () => {
      const now = new Date().toISOString();
      const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const open = closedList();

      const bucket = async (label: string, build: (q: CountBuilder) => CountBuilder) => {
        const { count, error } = await build(countBuilder());
        if (error) throw new DataError(`tickets.count.${label}`, error);
        return count ?? 0;
      };

      const [needsTriage, unassigned, awaiting, breached, atRisk, mine] = await Promise.all([
        bucket("needs_triage", (q) => q.eq("status", "open")),
        bucket("unassigned", (q) => q.is("assignee_id", null).not("status", "in", open)),
        bucket("awaiting", (q) => q.is("first_response_at", null).not("status", "in", open)),
        bucket("breached", (q) => q.lt("sla_due_at", now).not("status", "in", open)),
        bucket("at_risk", (q) =>
          q.gt("sla_due_at", now).lt("sla_due_at", soon).not("status", "in", open),
        ),
        bucket("mine", (q) => q.eq("assignee_id", viewerId).not("status", "in", open)),
      ]);

      return { needsTriage, unassigned, awaiting, breached, atRisk, mine };
    },
  });
}

export function ticketQuery(ticketId: string) {
  return queryOptions({
    queryKey: qk.ticket(ticketId),
    queryFn: async (): Promise<TicketDetail> => {
      const { data, error } = await supabase
        .from("tickets")
        .select(DETAIL_SELECT)
        .eq("id", ticketId)
        .maybeSingle()
        .returns<TicketDetail | null>();

      if (error) throw new DataError("tickets.get", error);
      if (!data) throw new DataError("tickets.get", { message: "Not found", code: "PGRST116" });
      return data;
    },
  });
}

export function ticketCommentsQuery(ticketId: string) {
  return queryOptions({
    queryKey: qk.ticketComments(ticketId),
    queryFn: async (): Promise<CommentWithAuthor[]> => {
      const { data, error } = await supabase
        .from("ticket_comments")
        .select(`*, author:profiles(${PERSON_REF_COLUMNS})`)
        .eq("ticket_id", ticketId)
        .order("created_at")
        .returns<CommentWithAuthor[]>();

      if (error) throw new DataError("ticket_comments.list", error);
      return data ?? [];
    },
  });
}

export function ticketEventsQuery(ticketId: string) {
  return queryOptions({
    queryKey: qk.ticketEvents(ticketId),
    queryFn: async (): Promise<EventWithActor[]> => {
      const { data, error } = await supabase
        .from("ticket_events")
        .select(`*, actor:profiles(${PERSON_REF_COLUMNS})`)
        .eq("ticket_id", ticketId)
        .order("created_at")
        .returns<EventWithActor[]>();

      if (error) throw new DataError("ticket_events.list", error);
      return data ?? [];
    },
  });
}

export function ticketAttachmentsQuery(ticketId: string) {
  return queryOptions({
    queryKey: qk.ticketAttachments(ticketId),
    queryFn: async (): Promise<TicketAttachment[]> => {
      const { data, error } = await supabase
        .from("ticket_attachments")
        .select("*")
        .eq("ticket_id", ticketId)
        .order("created_at");

      if (error) throw new DataError("ticket_attachments.list", error);
      return data ?? [];
    },
  });
}

export function ticketRelationsQuery(ticketId: string) {
  return queryOptions({
    queryKey: qk.ticketRelations(ticketId),
    queryFn: async (): Promise<RelationWithTicket[]> => {
      const { data, error } = await supabase
        .from("ticket_relations")
        .select(
          "*, to_ticket:tickets!ticket_relations_to_ticket_id_fkey(id, ticket_number, title, status)",
        )
        .eq("from_ticket_id", ticketId)
        .returns<RelationWithTicket[]>();

      if (error) throw new DataError("ticket_relations.list", error);
      return data ?? [];
    },
  });
}

export function ticketContextQuery(ticketId: string) {
  return queryOptions({
    queryKey: qk.ticketContext(ticketId),
    queryFn: async (): Promise<CaptureContext | null> => {
      const { data, error } = await supabase
        .from("ticket_capture_context")
        .select("*")
        .eq("ticket_id", ticketId)
        .maybeSingle();

      if (error) throw new DataError("ticket_capture_context.get", error);
      return data;
    },
  });
}

/** Type-ahead for the command palette and relation picker. */
export function ticketSearchQuery(term: string) {
  return queryOptions({
    queryKey: [...qk.tickets(), "search", term] as const,
    enabled: term.trim().length >= 2,
    queryFn: async (): Promise<TicketListRow[]> => {
      const { data, error } = await supabase
        .from("tickets")
        .select(LIST_SELECT)
        .textSearch("search_tsv", term, { type: "websearch" })
        .order("updated_at", { ascending: false })
        .limit(8)
        .returns<TicketListRow[]>();

      if (error) throw new DataError("tickets.search", error);
      return data ?? [];
    },
  });
}

export { TICKET_PRIORITIES };
