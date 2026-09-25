import { useQuery } from "@tanstack/react-query";
import { getIntegrationStatus } from "@/lib/admin-views.functions";
import { qk } from "@/data/keys";

/** True only when an AI provider is actually configured. Controls stay hidden otherwise. */
export function useAiEnabled() {
  const status = useQuery({
    queryKey: [...qk.all, "integrations"] as const,
    queryFn: () => getIntegrationStatus(),
    staleTime: 60_000,
  });

  return status.data?.ai.enabled === true;
}
