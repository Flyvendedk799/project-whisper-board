import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { BrainCircuit, LayoutList, CheckSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, StatusPill } from "@/components/app-shell";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import { planListQuery } from "@/data/planner";
import { PLAN_STATUS_TONE, type PlanListItem } from "@/data";

export function ProjectAiPlansTab({ projectId }: { projectId: string }) {
  const { workspaceId, isAdmin } = useAuth();
  const plansQuery = useQuery(planListQuery(workspaceId, projectId));

  return (
    <QueryState
      query={plansQuery}
      errorTitle="Couldn't load AI plans"
      empty={
        <EmptyState
          icon={BrainCircuit}
          title="No AI Plans yet"
          description={
            isAdmin
              ? "Create an AI plan to orchestrate agent tasks for this project."
              : "When your agency plans work here, progress will show up on this tab."
          }
          action={
            isAdmin ? (
              <Button asChild>
                <Link to="/app/planner" search={{ project: projectId, create: true }}>
                  Create plan for this project
                </Link>
              </Button>
            ) : undefined
          }
        />
      }
    >
      {(data) => {
        const rows = data.plans as PlanListItem[];
        if (!isAdmin) {
          const tasks = rows.reduce((total, plan) => total + (plan.task_count ?? 0), 0);
          const done = rows.reduce((total, plan) => total + (plan.done_task_count ?? 0), 0);
          const percent = tasks === 0 ? 0 : Math.round((100 * done) / tasks);
          return (
            <Card className="space-y-2 p-5">
              <h3 className="font-display text-xl">Plan progress</h3>
              <p className="text-sm text-muted-foreground">
                {done} of {tasks} planned tasks are done ({percent}%).
              </p>
              <ul className="space-y-2">
                {rows.map((plan) => (
                  <li key={plan.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">{plan.title}</span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {plan.done_task_count ?? 0}/{plan.task_count ?? 0}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          );
        }
        return (
          <div className="space-y-4">
            <div className="flex justify-end">
              <Button asChild size="sm">
                <Link to="/app/planner" search={{ project: projectId, create: true }}>
                  <BrainCircuit className="mr-1.5 h-4 w-4" />
                  New plan
                </Link>
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {rows.map((plan) => (
                <Link
                  key={plan.id}
                  to="/app/planner/$planId"
                  params={{ planId: plan.id }}
                  className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Card className="h-full p-5 transition-shadow hover:shadow-md">
                    <div className="mb-2 flex items-start justify-between gap-4">
                      <h3 className="font-semibold leading-tight group-hover:text-primary">
                        {plan.title}
                      </h3>
                      <StatusPill tone={PLAN_STATUS_TONE[plan.status]}>{plan.status}</StatusPill>
                    </div>

                    {plan.description && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">
                        {plan.description}
                      </p>
                    )}

                    <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1.5">
                        <LayoutList className="h-4 w-4" />
                        <span>{plan.section_count ?? 0} sections</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <CheckSquare className="h-4 w-4" />
                        <span>
                          {plan.done_task_count ?? 0}/{plan.task_count ?? 0} tasks
                        </span>
                      </div>
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}
