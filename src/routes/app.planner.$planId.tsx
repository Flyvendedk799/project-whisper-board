import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
import { QueryState } from "@/components/query-state";
import { planDetailQuery } from "@/data/planner";
import { PlanHeader } from "@/features/planner/plan-header";
import { PlanBoard } from "@/features/planner/plan-board";
import { AgentActivityFeed } from "@/features/planner/agent-activity-feed";
import { PlanTaskDrawer } from "@/features/planner/plan-task-drawer";
import { updateTask } from "@/lib/planner.functions";
import { useServerAction } from "@/lib/use-server-action";
import { qk } from "@/data/keys";
import type { PlanWithSections } from "@/data";
import { useState } from "react";

export const Route = createFileRoute("/app/planner/$planId")({
  component: PlanDetailPage,
});

function PlanDetailPage() {
  const { planId } = Route.useParams();
  const planQuery = useQuery(planDetailQuery(planId));
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);

  const handleCreateTask = (sectionId: string) => {
    const title = prompt("Task title:");
    if (title) {
      // Create task using server action if needed, or omit for now
    }
  };

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
            <div className="flex-1 overflow-hidden relative">
              <PlanBoard
                plan={plan as unknown as PlanWithSections}
                onCreateTask={handleCreateTask}
                onTaskClick={setDrawerTaskId}
              />
            </div>
            <AgentActivityFeed planId={plan.id} />
            <PlanTaskDrawer
              planId={plan.id}
              taskId={drawerTaskId}
              onClose={() => setDrawerTaskId(null)}
            />
          </>
        )}
      </QueryState>
    </div>
  );
}
