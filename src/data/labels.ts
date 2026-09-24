import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataError } from "@/lib/errors";
import { qk } from "./keys";
import type { WorkspaceLabel } from "./types";

export const LABEL_COLORS = [
  "#e11d48",
  "#ea580c",
  "#ca8a04",
  "#16a34a",
  "#0891b2",
  "#4f46e5",
  "#9333ea",
  "#64748b",
] as const;

export function workspaceLabelsQuery(workspaceId: string | null | undefined) {
  return queryOptions({
    queryKey: qk.labels(workspaceId ?? undefined),
    enabled: Boolean(workspaceId),
    queryFn: async (): Promise<WorkspaceLabel[]> => {
      const { data, error } = await supabase
        .from("workspace_labels")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("name");
      if (error) throw new DataError("workspace_labels.list", error);
      return data ?? [];
    },
  });
}
