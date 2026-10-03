import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ConfirmDeleteDialog } from "@/components/confirm-delete-dialog";
import { useServerAction } from "@/lib/use-server-action";
import { deleteTickets } from "@/lib/tickets.functions";
import { qk } from "@/data/keys";

/**
 * Confirm and perform "delete these tickets", from the triage queue (one or
 * many) and from a ticket's own page.
 *
 * Deleting is permanent: the conversation, the files and the history go with
 * the ticket. A duplicate is the usual reason, so there is no typed
 * confirmation, but the dialog names what is lost and a ticket's own page says
 * which one.
 */
export function TicketDeleteDialog({
  tickets,
  open,
  onOpenChange,
  onDeleted,
}: {
  tickets: Array<{ id: string; title?: string; number?: number }>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs after the delete; the ticket page uses it to leave the page that no longer exists. */
  onDeleted?: (deleted: string[]) => void | Promise<void>;
}) {
  const queryClient = useQueryClient();
  const many = tickets.length > 1;
  const only = tickets[0];
  const name = only?.number ? `ticket #${only.number}` : "this ticket";

  const remove = useServerAction(useServerFn(deleteTickets), {
    label: "tickets.delete",
    onSuccess: async (result) => {
      onOpenChange(false);
      await onDeleted?.(result.deleted);
      // Only after leaving: refetching the detail of a ticket that is gone is an error screen.
      for (const id of result.deleted) queryClient.removeQueries({ queryKey: qk.ticket(id) });
      await queryClient.invalidateQueries({ queryKey: qk.tickets() });
      if (result.failed.length > 0) {
        toast.error(`${result.failed.length} couldn't be deleted`);
      }
      toast.success(
        result.deleted.length === 1 ? "Ticket deleted" : `${result.deleted.length} tickets deleted`,
      );
    },
  });

  return (
    <ConfirmDeleteDialog
      open={open}
      onOpenChange={onOpenChange}
      title={many ? `Delete ${tickets.length} tickets?` : `Delete ${name}?`}
      busy={remove.busy}
      confirmLabel={many ? `Delete ${tickets.length} tickets` : "Delete ticket"}
      onConfirm={() => remove.fire({ ticketIds: tickets.map((ticket) => ticket.id) })}
    >
      {!many && only?.title ? <p className="font-medium text-foreground">{only.title}</p> : null}
      <p>
        {many ? "Their" : "Its"} comments, files and history are deleted with {many ? "them" : "it"}
        , and this can&rsquo;t be undone. A plan task made from {many ? "one of them" : "it"} stays,
        without the link.
      </p>
    </ConfirmDeleteDialog>
  );
}
