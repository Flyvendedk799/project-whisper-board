import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataError } from "@/lib/errors";
import { qk } from "./keys";
import { ticketFiltersSchema, type TicketFilters } from "./filters";
import type { SavedView } from "./types";

export function savedViewsQuery() {
  return queryOptions({
    queryKey: qk.savedViews(),
    staleTime: 60_000,
    queryFn: async (): Promise<SavedView[]> => {
      const { data, error } = await supabase
        .from("saved_views")
        .select("*")
        .eq("scope", "tickets")
        .order("position")
        .order("created_at");

      if (error) throw new DataError("saved_views.list", error);
      return data ?? [];
    },
  });
}

/**
 * A saved view stores the route's search params verbatim, so loading one is
 * just `navigate({ search })`. It is still parsed on the way out: a view saved
 * by an older version may name a filter that no longer exists, and a filter
 * object that fails validation should degrade to the defaults rather than
 * throwing inside a render.
 */
export function viewFilters(view: SavedView): TicketFilters {
  const parsed = ticketFiltersSchema.safeParse(view.filters);
  return parsed.success ? parsed.data : ticketFiltersSchema.parse({});
}
