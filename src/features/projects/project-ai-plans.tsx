import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BrainCircuit, LayoutList, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, StatusPill, ListSkeleton } from "@/components/app-shell";
import { planListQuery } from "@/data/planner";
import type { Row } from "@/data";

export function ProjectAiPlansTab({ projectId }: { projectId: string }) {
  const plansQuery = useQuery(planListQuery(projectId));

  if (plansQuery.isLoading) {
    return <ListSkeleton rows={3} />;
  }

  const rows = plansQuery.data?.plans ?? [];

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={BrainCircuit}
        title="No AI Plans yet"
        description="Create an AI plan to orchestrate agent tasks for this project."
        action={
          <Button asChild>
            <Link to="/app/planner">Go to Planner</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {rows.map((plan: Row<"plans">) => (
        <Link
          key={plan.id}
          to={`/app/planner/${plan.id}`}
          className="group block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
        >
          <Card className="h-full p-5 transition-shadow hover:shadow-md">
            <div className="mb-2 flex items-start justify-between gap-4">
              <h3 className="font-semibold leading-tight group-hover:text-primary">
                {plan.title}
              </h3>
              <StatusPill tone={plan.status === "active" ? "primary" : plan.status === "completed" ? "success" : "muted"}>
                {plan.status}
              </StatusPill>
            </div>
            
            {plan.description && (
              <p className="line-clamp-2 text-sm text-muted-foreground">
                {plan.description}
              </p>
            )}

            <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5">
                <LayoutList className="h-4 w-4" />
                <span>{(plan as any).section_count || 0} sections</span>
              </div>
              <div className="flex items-center gap-1.5">
                <CheckSquare className="h-4 w-4" />
                <span>{(plan as any).task_count || 0} tasks</span>
              </div>
            </div>
          </Card>
        </Link>
      ))}
    </div>
  );
}
