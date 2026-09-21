import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { QueryState } from "@/components/query-state";
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
import { planDetailQuery } from "@/data/planner";
import { PlanHeader } from "@/features/planner/plan-header";
import { PlanBoard } from "@/features/planner/plan-board";
import { AgentActivityFeed } from "@/features/planner/agent-activity-feed";
import { PlanTaskDrawer } from "@/features/planner/plan-task-drawer";
import { createTask } from "@/lib/planner.functions";
import { useServerAction } from "@/lib/use-server-action";
import { qk } from "@/data/keys";
import type { PlanWithSections } from "@/data";

export const Route = createFileRoute("/app/planner/$planId")({
  component: PlanDetailPage,
});

function PlanDetailPage() {
  const { planId } = Route.useParams();
  const planQuery = useQuery(planDetailQuery(planId));
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [createSectionId, setCreateSectionId] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState("");

  const create = useServerAction(useServerFn(createTask), {
    label: "tasks.create",
    success: "Task created",
    invalidate: [qk.plan(planId)],
    onSuccess: () => {
      setCreateSectionId(null);
      setTaskTitle("");
    },
  });

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      <QueryState
        query={planQuery}
        errorTitle="Couldn't load plan"
        pending={
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        }
      >
        {({ plan }) => (
          <>
            <PlanHeader plan={plan as unknown as PlanWithSections} />
            <div className="relative flex-1 overflow-hidden">
              <PlanBoard
                plan={plan as unknown as PlanWithSections}
                onCreateTask={setCreateSectionId}
                onTaskClick={setDrawerTaskId}
              />
            </div>
            <AgentActivityFeed planId={plan.id} />
            <PlanTaskDrawer
              planId={plan.id}
              taskId={drawerTaskId}
              onClose={() => setDrawerTaskId(null)}
            />

            <Dialog
              open={Boolean(createSectionId)}
              onOpenChange={(open) => {
                if (!open) {
                  setCreateSectionId(null);
                  setTaskTitle("");
                }
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>New task</DialogTitle>
                </DialogHeader>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    if (!createSectionId || !taskTitle.trim()) return;
                    create.fire({
                      planId: plan.id,
                      sectionId: createSectionId,
                      title: taskTitle.trim(),
                    });
                  }}
                  className="space-y-4"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="task-title">Title</Label>
                    <Input
                      id="task-title"
                      value={taskTitle}
                      onChange={(e) => setTaskTitle(e.target.value)}
                      placeholder="What needs doing?"
                      autoFocus
                      required
                    />
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={create.busy || !taskTitle.trim()}>
                      {create.busy ? "Creating…" : "Create task"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </>
        )}
      </QueryState>
    </div>
  );
}
