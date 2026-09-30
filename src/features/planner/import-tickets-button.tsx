import { useServerFn } from "@tanstack/react-start";
import { importOpenTickets } from "@/lib/planner.functions";
import { useServerAction } from "@/lib/use-server-action";
import { qk } from "@/data/keys";

/**
 * "Add open tickets": one task per open ticket on the linked project that is
 * not already on the plan. Offered from the Plan options menu and from the
 * empty-plan starter, so it is a hook rather than a button.
 */
export function useImportOpenTickets(planId: string) {
  return useServerAction(useServerFn(importOpenTickets), {
    label: "tasks.importOpenTickets",
    success: (result) =>
      result.created > 0
        ? `Added ${result.created} ticket${result.created === 1 ? "" : "s"} to the plan`
        : "Every open ticket is already on this plan",
    invalidate: [qk.plan(planId), qk.planEvents(planId)],
  });
}
