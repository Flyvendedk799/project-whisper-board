import { queryOptions } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { DataError } from "@/lib/errors";
import { qk } from "./keys";
import type { SlaPolicy } from "./types";

export const DEFAULT_SLA_MINUTES: Record<
  SlaPolicy["priority"],
  { first: number; resolution: number }
> = {
  urgent: { first: 60, resolution: 480 },
  high: { first: 240, resolution: 2880 },
  medium: { first: 1440, resolution: 10080 },
  low: { first: 4320, resolution: 43200 },
};

export function slaPoliciesQuery(workspaceId: string | null | undefined) {
  return queryOptions({
    queryKey: qk.slaPolicies(workspaceId ?? undefined),
    enabled: Boolean(workspaceId),
    queryFn: async (): Promise<SlaPolicy[]> => {
      const { data, error } = await supabase
        .from("sla_policies")
        .select("*")
        .eq("workspace_id", workspaceId!)
        .order("priority");
      if (error) throw new DataError("sla_policies.list", error);
      return data ?? [];
    },
  });
}
