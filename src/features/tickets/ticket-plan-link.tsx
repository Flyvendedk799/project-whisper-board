import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ListPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusPill } from "@/components/app-shell";
import { useAuth } from "@/components/auth-provider";
import { useServerAction } from "@/lib/use-server-action";
import { createTaskFromTicket } from "@/lib/planner.functions";
import { planListQuery, ticketTasksQuery } from "@/data/planner";
import { qk } from "@/data/keys";
import type { PlanListItem } from "@/data";

export function TicketPlanLink({ ticketId, projectId }: { ticketId: string; projectId: string }) {
  const { workspaceId } = useAuth();
  const tasksQuery = useQuery(ticketTasksQuery(ticketId));
  const plansQuery = useQuery(planListQuery(workspaceId, projectId));
  const [open, setOpen] = useState(false);
  const [planId, setPlanId] = useState("");

  const create = useServerAction(useServerFn(createTaskFromTicket), {
    label: "tasks.createFromTicket",
    success: (result) => (result.created ? "Added to the plan" : "Already on that plan"),
    invalidate: [qk.ticketTasks(ticketId), qk.ticket(ticketId)],
    onSuccess: () => {
      setOpen(false);
      setPlanId("");
    },
  });

  const plans = (plansQuery.data?.plans ?? []) as PlanListItem[];
  const tasks = tasksQuery.data ?? [];

  return (
    <Card className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Planner tasks</h2>
        <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => setOpen(true)}>
          <ListPlus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Add to plan
        </Button>
      </div>

      {tasks.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          This ticket is not on a plan yet. Add it and the work stays linked both ways.
        </p>
      ) : (
        <ul className="space-y-2">
          {tasks.map((task) => (
            <li key={task.id} className="rounded-md border p-2">
              <Link
                to="/app/planner/$planId"
                params={{ planId: task.plan_id }}
                className="block transition-colors hover:text-primary"
              >
                <div className="text-sm font-medium">{task.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <StatusPill>{task.status}</StatusPill>
                  <span className="truncate">
                    {task.plan && "title" in task.plan ? String(task.plan.title) : "Plan"}
                  </span>
                </div>
              </Link>
              {task.pr_url && (
                <a
                  href={task.pr_url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block text-xs underline underline-offset-2"
                >
                  {task.pr_status === "merged" ? "Merged pull request" : "Pull request"}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add this ticket to a plan</DialogTitle>
          </DialogHeader>
          {plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This project has no plans yet.{" "}
              <Link
                to="/app/planner"
                search={{ project: projectId, create: true }}
                className="underline underline-offset-2"
              >
                Create one
              </Link>
              .
            </p>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!planId) return;
                create.fire({ ticketId, planId });
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="ticket-plan">Plan</Label>
                <Select value={planId || undefined} onValueChange={setPlanId}>
                  <SelectTrigger id="ticket-plan">
                    <SelectValue placeholder="Choose a plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {plans.map((plan) => (
                      <SelectItem key={plan.id} value={plan.id}>
                        {plan.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DialogFooter>
                <Button type="submit" disabled={create.busy || !planId}>
                  {create.busy ? "Adding…" : "Add task"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
