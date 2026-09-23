import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-provider";
import { planListQuery } from "@/data/planner";
import type { PlanListItem } from "@/data";

export function ProjectPlanProgress({
  projectId,
  linked,
}: {
  projectId: string;
  linked?: boolean;
}) {
  const { workspaceId } = useAuth();
  const plans = useQuery(planListQuery(workspaceId, projectId));
  const rows = (plans.data?.plans ?? []) as PlanListItem[];
  if (rows.length === 0) return null;

  const tasks = rows.reduce((total, plan) => total + (plan.task_count ?? 0), 0);
  const done = rows.reduce((total, plan) => total + (plan.done_task_count ?? 0), 0);
  const percent = tasks === 0 ? 0 : Math.round((100 * done) / tasks);

  const label = `Plan ${percent}% · ${done}/${tasks} tasks`;

  if (!linked) {
    return <span className="text-muted-foreground">{label}</span>;
  }

  return (
    <Link
      to="/app/projects/$projectId"
      params={{ projectId }}
      search={{ tab: "plans" }}
      className="text-muted-foreground underline-offset-2 hover:underline"
    >
      {label}
    </Link>
  );
}
