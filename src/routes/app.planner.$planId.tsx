import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { useAuth } from "@/components/auth-provider";
import { ClientPlanScreen } from "@/features/planner/client-plan-screen";
import { PlanScreen } from "@/features/planner/plan-screen";

const planSearchSchema = z.object({
  /** The open task, so a task can be linked to. */
  task: z.string().uuid().optional().catch(undefined),
  /** "client": the plan as its clients see it (the agency's preview). */
  view: z.enum(["client"]).optional().catch(undefined),
});

type PlanSearch = z.infer<typeof planSearchSchema>;

export const Route = createFileRoute("/app/planner/$planId")({
  validateSearch: planSearchSchema,
  component: PlanDetailPage,
});

function PlanDetailPage() {
  const { planId } = Route.useParams();
  const { task, view } = Route.useSearch();
  const { isAdmin } = useAuth();
  const navigate = useNavigate({ from: Route.fullPath });

  // Clients only ever get the client layer. The agency can open it as a preview.
  if (!isAdmin || view === "client") {
    return (
      <ClientPlanScreen
        planId={planId}
        preview={isAdmin}
        backHref={
          isAdmin
            ? {
                label: "Back to agency view",
                onClick: () =>
                  void navigate({
                    search: (prev: PlanSearch) => ({ ...prev, view: undefined }),
                  }),
              }
            : undefined
        }
      />
    );
  }

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
