import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState, StatusPill } from "@/components/status-pill";
import { QueryState } from "@/components/query-state";
import { useDataMutation, useServerAction } from "@/lib/use-server-action";
import { completeMilestone } from "@/lib/billing.functions";
import { setMilestoneStatus } from "@/lib/tickets.functions";
import { parseMoneyToCents } from "@/data/billing";
import { projectMilestonesQuery } from "@/data/projects";
import { createMilestone } from "@/data/mutations";
import { qk } from "@/data/keys";
import { MILESTONE_STATUS_LABEL, MILESTONE_STATUS_TONE } from "@/data/enums";
import { formatCents, formatDate } from "@/lib/utils-format";

export function MilestonesPanel({
  projectId,
  canEdit,
  currency,
}: {
  projectId: string;
  canEdit: boolean;
  currency: string;
}) {
  const milestones = useQuery(projectMilestonesQuery(projectId));
  const [adding, setAdding] = useState(false);

  const invalidate = [
    qk.projectMilestones(projectId),
    qk.project(projectId),
    qk.projectUpdates(projectId),
    qk.projectInvoices(projectId),
  ];

  const setStatus = useServerAction(useServerFn(setMilestoneStatus), {
    label: "milestones.setStatus",
    invalidate,
  });

  const complete = useServerAction(useServerFn(completeMilestone), {
    label: "billing.completeMilestone",
    invalidate,
    success: (result) =>
      result.invoiceId ? "Milestone complete. Invoice drafted in Billing." : "Milestone complete.",
  });

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button variant="outline" className="max-md:w-full" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
            New milestone
          </Button>
        </div>
      )}

      <QueryState
        query={milestones}
        errorTitle="Couldn't load milestones"
        empty={
          <div className="rounded-[14px] border bg-card">
            <EmptyState
              title="No milestones yet"
              description={
                canEdit
                  ? "Add them here, or accept a quote and its line items become the plan."
                  : "Once the plan is agreed you'll see it here."
              }
              action={
                canEdit ? <Button onClick={() => setAdding(true)}>New milestone</Button> : undefined
              }
            />
          </div>
        }
      >
        {(data) => (
          <ul className="overflow-hidden rounded-[14px] border bg-card">
            {data.map((milestone, index) => (
              <li
                key={milestone.id}
                className={`flex flex-wrap items-center gap-3 px-4 py-3.5 hover:bg-surface ${
                  index > 0 ? "border-t" : ""
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 break-words font-medium leading-snug">
                      {milestone.title}
                    </span>
                    <StatusPill tone={MILESTONE_STATUS_TONE[milestone.status]}>
                      {MILESTONE_STATUS_LABEL[milestone.status]}
                    </StatusPill>
                  </div>
                  <div className="mt-0.5 text-[13px] text-muted-foreground">
                    {milestone.due_date ? `Due ${formatDate(milestone.due_date)}` : "No due date"}
                    {milestone.amount_cents
                      ? ` · ${formatCents(milestone.amount_cents, currency)}`
                      : ""}
                  </div>
                </div>
                {canEdit && milestone.status !== "done" && (
                  <div className="flex gap-1 max-md:w-full max-md:gap-2 max-md:[&>button]:flex-1">
                    {milestone.status === "pending" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={setStatus.busy}
                        onClick={() =>
                          setStatus.fire({ milestoneId: milestone.id, status: "in_progress" })
                        }
                      >
                        Start
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={complete.busy}
                      onClick={() =>
                        complete.fire({ milestoneId: milestone.id, draftInvoice: true })
                      }
                    >
                      Mark done
                    </Button>
                  </div>
                )}
                {canEdit && milestone.status === "done" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="max-md:w-full max-md:border max-md:border-input"
                    disabled={setStatus.busy}
                    onClick={() =>
                      setStatus.fire({ milestoneId: milestone.id, status: "in_progress" })
                    }
                  >
                    Reopen
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </QueryState>

      <NewMilestoneDialog
        open={adding}
        onOpenChange={setAdding}
        projectId={projectId}
        currency={currency}
        invalidate={invalidate}
      />
    </div>
  );
}

function NewMilestoneDialog({
  open,
  onOpenChange,
  projectId,
  currency,
  invalidate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  currency: string;
  invalidate: readonly (readonly unknown[])[];
}) {
  const add = useDataMutation("milestones.insert", createMilestone, {
    success: "Milestone added",
    invalidate,
    onSuccess: () => onOpenChange(false),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">New milestone</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const title = String(form.get("title") ?? "").trim();
            if (!title) return;
            const rawAmount = String(form.get("amount") ?? "");
            const amount = parseMoneyToCents(rawAmount);
            if (rawAmount.trim() && amount == null) {
              toast.error("Enter the amount as a number, like 25000 or 1250.50.");
              return;
            }
            add.fire({
              project_id: projectId,
              title,
              due_date: String(form.get("due") ?? "") || null,
              amount_cents: amount,
            });
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="milestone-title">Title</Label>
            <Input id="milestone-title" name="title" required enterKeyHint="next" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="milestone-due">Due</Label>
            <Input id="milestone-due" name="due" type="date" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="milestone-amount">Amount ({currency})</Label>
            <Input
              id="milestone-amount"
              name="amount"
              inputMode="decimal"
              placeholder="25000"
              enterKeyHint="done"
            />
            <p className="text-xs text-muted-foreground">
              When you mark the milestone done, an invoice for this amount is drafted for you to
              review.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={add.busy}>
              {add.busy ? "Adding…" : "Add milestone"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
