import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronUp, Terminal } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { planEventsQuery } from "@/data/planner";
import { PLAN_EVENT_KIND_LABEL, type EventWithRefs } from "@/data";
import { qk } from "@/data/keys";
import { supabase } from "@/integrations/supabase/client";

export function AgentActivityFeed({ planId }: { planId: string }) {
  const queryClient = useQueryClient();
  const events = useQuery(planEventsQuery(planId));

  useEffect(() => {
    if (!planId) return;

    const channel = supabase
      .channel(`plan_events:${planId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "plan_events",
          filter: `plan_id=eq.${planId}`,
        },
        () => {
          void queryClient.invalidateQueries({ queryKey: qk.planEvents(planId) });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [planId, queryClient]);

  const rows = events.data?.events ?? [];

  return (
    <Collapsible
      defaultOpen
      className="group relative z-10 flex shrink-0 flex-col border-t bg-background shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)] transition-all data-[state=closed]:h-12 data-[state=open]:h-64"
    >
      <div className="flex h-12 items-center justify-between border-b px-4">
        <h3 className="flex items-center gap-2 font-medium text-muted-foreground">
          <Terminal className="h-4 w-4" />
          Agent Activity Feed
        </h3>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-muted/50">
            <ChevronUp className="h-4 w-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
            <span className="sr-only">Toggle activity feed</span>
          </Button>
        </CollapsibleTrigger>
      </div>

      <CollapsibleContent className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          <ul className="flex flex-col gap-3 p-4">
            {rows.map((event) => {
              const row = event as EventWithRefs;
              const actorName = row.agent?.name || row.actor?.full_name || "Someone";
              const detail =
                typeof row.metadata === "object" &&
                row.metadata &&
                !Array.isArray(row.metadata) &&
                "message" in row.metadata
                  ? String((row.metadata as { message?: unknown }).message ?? "")
                  : row.new_value;

              return (
                <li key={row.id} className="flex gap-3 text-sm">
                  <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <Bot className="h-3 w-3" />
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium text-foreground">
                      {actorName}{" "}
                      <span className="font-normal text-muted-foreground">
                        {PLAN_EVENT_KIND_LABEL[row.kind] ?? row.kind}
                      </span>
                    </span>
                    {detail ? <span className="text-muted-foreground">{detail}</span> : null}
                    <span className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(row.created_at).toLocaleString()}
                    </span>
                  </div>
                </li>
              );
            })}
            {rows.length === 0 && (
              <li className="text-center text-sm text-muted-foreground">No activity yet.</li>
            )}
          </ul>
        </ScrollArea>
      </CollapsibleContent>
    </Collapsible>
  );
}
