import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { deleteProject } from "@/lib/projects.functions";
import { setProjectStatus } from "@/lib/tickets.functions";
import { toUserMessage } from "@/lib/errors";
import { projectDeletionImpactQuery } from "@/data/projects";
import { qk } from "@/data/keys";
import { joinList, projectLosses } from "./project-impact";

/**
 * Confirm and perform "delete this project".
 *
 * Asks the server what is in the project first, so the warning is a list of
 * real things rather than a generic sentence, and so a project with issued
 * invoices is refused up front instead of after a typed confirmation.
 */
export function ProjectDeleteDialog({
  project,
  open,
  onOpenChange,
  onDeleted,
}: {
  project: { id: string; title: string; status: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs after the delete; the project page uses it to leave the page that no longer exists. */
  onDeleted?: () => void | Promise<void>;
}) {
  const { workspaceId } = useAuth();
  const queryClient = useQueryClient();
  const impact = useQuery(projectDeletionImpactQuery(project.id, open));

  const remove = useServerAction(useServerFn(deleteProject), {
    label: "projects.delete",
    onSuccess: async () => {
      onOpenChange(false);
      await onDeleted?.();
      // Only after leaving: refetching the detail of a project that is gone is an error screen.
      queryClient.removeQueries({ queryKey: qk.project(project.id) });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.projects() }),
        queryClient.invalidateQueries({ queryKey: qk.plans() }),
        queryClient.invalidateQueries({ queryKey: qk.tickets() }),
      ]);
      toast.success(`Deleted “${project.title}”`);
    },
  });

  const archive = useServerAction(useServerFn(setProjectStatus), {
    label: "projects.setStatus",
    success: "Project archived",
    invalidate: [qk.project(project.id), qk.projectList(workspaceId ?? undefined)],
    onSuccess: () => onOpenChange(false),
  });

  const data = impact.data;
  const issued = data?.issuedInvoices ?? 0;
  const losses = data ? projectLosses(data) : [];
  const busy = remove.busy || archive.busy;

  const archiveButton =
    project.status === "archived" ? null : (
      <Button
        type="button"
        variant={issued > 0 ? "default" : "outline"}
        disabled={busy}
        onClick={() => archive.fire({ projectId: project.id, status: "archived" })}
      >
        {archive.busy ? "Archiving…" : issued > 0 ? "Archive project" : "Archive instead"}
      </Button>
    );

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Delete “${project.title}”?`}
      busy={remove.busy}
      blocked={issued > 0}
      disabled={!data}
      confirmText={losses.length > 0 ? project.title : undefined}
      confirmLabel="Delete project"
      extraAction={archiveButton}
      onConfirm={() => remove.fire({ projectId: project.id })}
    >
      {impact.isError ? (
        <p className="text-destructive">
          We couldn’t check what’s in this project: {toUserMessage(impact.error)} Close this and try
          again.
        </p>
      ) : !data ? (
        <p>Checking what’s in this project…</p>
      ) : issued > 0 ? (
        <p>
          This project has {issued} issued invoice{issued === 1 ? "" : "s"} (sent, paid or overdue).
          Billing records are kept for your books, so it can’t be deleted. Archiving takes it off
          the project list and leaves everything in place.
        </p>
      ) : (
        <>
          <p>
            {losses.length > 0
              ? `This permanently deletes the project and everything filed under it: ${joinList(losses)}, with their comments and files. This can’t be undone.`
              : "It’s empty, so nothing else is lost. This can’t be undone."}
          </p>
          {data.plans > 0 ? (
            <p>
              Its {data.plans} plan{data.plans === 1 ? "" : "s"} stay in the Planner, no longer
              linked to a project.
            </p>
          ) : null}
        </>
      )}
    </ConfirmDeleteDialog>
  );
}
