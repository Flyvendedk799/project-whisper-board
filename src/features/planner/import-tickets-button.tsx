import { useServerFn } from "@tanstack/react-start";
import { Ticket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/lib/use-server-action";
import { importOpenTickets } from "@/lib/planner.functions";
import { qk } from "@/data/keys";

export function ImportTicketsButton({
  planId,
  projectId,
}: {
  planId: string;
  projectId: string | null;
}) {
  const importTickets = useServerAction(useServerFn(importOpenTickets), {
    label: "tasks.importOpenTickets",
    success: (result) =>
      result.created > 0
        ? `Added ${result.created} ticket${result.created === 1 ? "" : "s"} to the plan`
        : "Every open ticket is already on this plan",
    invalidate: [qk.plan(planId)],
  });

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={!projectId || importTickets.busy}
      title={projectId ? "Create a task for each open ticket" : "Link a project first"}
      onClick={() => importTickets.fire({ planId })}
    >
      <Ticket className="mr-1.5 h-4 w-4" aria-hidden="true" />
      {importTickets.busy ? "Importing…" : "Add open tickets"}
    </Button>
  );
}
