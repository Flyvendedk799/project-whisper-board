import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/data/keys";
import type { PlanEvent } from "@/data";
import { supabase } from "@/integrations/supabase/client";

/**
 * Keeps the plan live. Anything an agent or a teammate does reaches this page
 * as a row change; we do not patch the cache from the payload (the row would be
 * missing its joins) but refetch what it touches, batched so a burst of changes
 * costs one round trip.
 */
export function usePlanRealtime(planId: string, onEvent?: (event: PlanEvent) => void) {
  const queryClient = useQueryClient();
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!planId) return;

    const pending = new Set<"plan" | "events" | "files" | "comments">();
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      if (pending.has("plan"))
        void queryClient.invalidateQueries({ queryKey: qk.plan(planId), exact: true });
      if (pending.has("events"))
        void queryClient.invalidateQueries({ queryKey: qk.planEvents(planId) });
      if (pending.has("files"))
        void queryClient.invalidateQueries({ queryKey: qk.planAttachments(planId) });
      if (pending.has("comments"))
        void queryClient.invalidateQueries({ queryKey: [...qk.all, "task-comments"] });
      pending.clear();
    };
    const touch = (...what: Array<"plan" | "events" | "files" | "comments">) => {
      for (const item of what) pending.add(item);
      if (!timer) timer = setTimeout(flush, 200);
    };

    const filter = `plan_id=eq.${planId}`;
    const channel = supabase
      .channel(`plan:${planId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "plan_events", filter },
        (payload) => {
          touch("events", "plan", "files", "comments");
          onEventRef.current?.(payload.new as PlanEvent);
        },
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "plan_tasks", filter }, () =>
        touch("plan"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plan_task_steps", filter },
        () => touch("plan"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plan_task_attachments", filter },
        () => touch("files"),
      )
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [planId, queryClient]);
}
