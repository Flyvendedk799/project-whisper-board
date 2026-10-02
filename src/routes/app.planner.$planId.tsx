import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { PlanScreen } from "@/features/planner/plan-screen";

const planSearchSchema = z.object({
  /** The open task, so a task can be linked to. */
  task: z.string().uuid().optional().catch(undefined),
});

type PlanSearch = z.infer<typeof planSearchSchema>;

export const Route = createFileRoute("/app/planner/$planId")({
  validateSearch: planSearchSchema,
  component: PlanDetailPage,
});

function PlanDetailPage() {
  const { planId } = Route.useParams();
  const { task } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });

  return (
    <PlanScreen
      planId={planId}
      taskId={task ?? null}
      onDeleted={({ projectId }) =>
        navigate({ to: "/app/planner", search: { project: projectId ?? undefined } })
      }
      onTaskChange={(next) =>
        void navigate({
          search: (prev: PlanSearch) => ({ ...prev, task: next ?? undefined }),
          replace: true,
        })
      }
    />
  );
}
