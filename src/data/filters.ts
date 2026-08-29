import { z } from "zod";
import { Constants } from "@/integrations/supabase/types";

/**
 * The triage queue's filter shape, defined once.
 *
 * This is the route's validated search params, the query key, and the body of a
 * saved view — all the same object. Storing `saved_views.filters` verbatim means
 * loading a view is `navigate({ search: filters })` and there is no separate
 * serialisation format to keep in step.
 */
export const ticketFiltersSchema = z.object({
  q: z.string().trim().min(1).optional(),
  status: z.array(z.enum(Constants.public.Enums.ticket_status)).optional(),
  type: z.array(z.enum(Constants.public.Enums.ticket_type)).optional(),
  priority: z.array(z.enum(Constants.public.Enums.ticket_priority)).optional(),
  projectId: z.string().uuid().optional(),
  /** "me" and "unassigned" are resolved against the signed-in user at query time. */
  assignee: z.union([z.literal("me"), z.literal("unassigned"), z.string().uuid()]).optional(),
  reporter: z.union([z.literal("me"), z.string().uuid()]).optional(),
  labels: z.array(z.string()).optional(),
  age: z.enum(["24h", "3d", "7d", "30d"]).optional(),
  sla: z.enum(["breached", "at_risk", "ok"]).optional(),
  /** Tickets whose last word came from the client and are still waiting on us. */
  awaiting: z.boolean().optional(),
  hasAttachments: z.boolean().optional(),
  sort: z.enum(["sla", "newest", "oldest", "priority", "updated"]).optional().default("updated"),
  view: z.string().uuid().optional(),
  board: z.boolean().optional(),
});

export type TicketFilters = z.infer<typeof ticketFiltersSchema>;

/** Everything except presentation — two filter sets that differ only by
 *  layout or by which saved view is highlighted should share a cache entry. */
export function filterCacheKey(filters: TicketFilters) {
  const { view: _view, board: _board, ...rest } = filters;
  return rest;
}

export function isFiltered(filters: TicketFilters): boolean {
  const key = filterCacheKey(filters);
  return Object.entries(key).some(([field, value]) => {
    if (field === "sort") return value !== "updated";
    if (Array.isArray(value)) return value.length > 0;
    return value !== undefined;
  });
}

export const EMPTY_FILTERS: TicketFilters = { sort: "updated" };
