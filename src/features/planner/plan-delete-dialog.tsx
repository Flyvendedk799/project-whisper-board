import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Button } from "@/components/ui/button";
import { useServerAction } from "@/lib/use-server-action";
import { deletePlan, updatePlan } from "@/lib/planner.functions";
import { qk } from "@/data/keys";
import { pluralize } from "./plan-model";

/**
 * Confirm and perform "delete this plan".
 *
 * Used from the plan page and from the plan list, so it takes the counts it
 * should warn about rather than reading them from either screen's data. A plan
 * with tasks asks for its title to be typed; an empty one just asks.
 */
export function PlanDeleteDialog({
  plan,
  open,
  onOpenChange,
  onDeleting,
  onDeleted,
}: {
  plan: { id: string; title: string; status: string; sections: number; tasks: number };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Called as the delete starts (`true`) and if it fails (`false`). The plan page uses it to
   * stop showing the plan: the live connection reports its rows going and a refetch would
   * otherwise flash "couldn't load plan".
   */
  onDeleting?: (deleting: boolean) => void;
  /** Runs after the delete; the plan page uses it to leave the page that no longer exists. */
  onDeleted?: () => void | Promise<void>;
}) {
  const queryClient = useQueryClient();

  const remove = useServerAction(useServerFn(deletePlan), {
    label: "plans.delete",
    onError: () => onDeleting?.(false),
    onSuccess: async () => {
      onOpenChange(false);
      await onDeleted?.();
      queryClient.removeQueries({ queryKey: qk.plan(plan.id) });
      queryClient.removeQueries({ queryKey: qk.planEvents(plan.id) });
      queryClient.removeQueries({ queryKey: qk.planAttachments(plan.id) });
      await queryClient.invalidateQueries({ queryKey: qk.plans() });
      // A project's progress is partly its plans'.
      await queryClient.invalidateQueries({ queryKey: qk.projects() });
      toast.success(`Deleted “${plan.title}”`);
    },
  });

  const archive = useServerAction(useServerFn(updatePlan), {
    label: "plans.update",
    success: "Plan archived",
    invalidate: [qk.plan(plan.id), qk.planList(), qk.planEvents(plan.id)],
    onSuccess: () => onOpenChange(false),
  });

  const busy = remove.busy || archive.busy;
  const hasWork = plan.tasks > 0 || plan.sections > 0;

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete “${plan.title}”?`}
      busy={remove.busy}
      confirmText={hasWork ? plan.title : undefined}
      confirmLabel="Delete plan"
      extraAction={
        plan.status === "archived" ? null : (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => archive.fire({ planId: plan.id, status: "archived" })}
          >
            {archive.busy ? "Archiving…" : "Archive instead"}
          </Button>
        )
      }
      onConfirm={() => {
        onDeleting?.(true);
        remove.fire({ planId: plan.id });
      }}
    >
      <p>
        {hasWork
          ? `This permanently deletes the plan with its ${pluralize(plan.sections, "section")} and ${pluralize(plan.tasks, "task")}, including their steps, comments and files. This can’t be undone.`
          : "It’s empty, so nothing else is lost. This can’t be undone."}
      </p>
      <p>Pull requests on GitHub are not touched, and tickets linked to its tasks stay.</p>
    </ConfirmDeleteDialog>
  );
}
