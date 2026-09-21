import { queryOptions } from "@tanstack/react-query";
import { qk } from "./keys";
import {
  listPlans,
  getPlan,
  listAgents,
  getPlanEvents,
  listTaskComments,
  listApiKeys,
  listTasksByTicket,
} from "@/lib/planner.functions";

export const planListQuery = (workspaceId?: string | null, projectId?: string) =>
  queryOptions({
    queryKey: projectId
      ? [...qk.planList(), workspaceId ?? "none", { projectId }]
      : [...qk.planList(), workspaceId ?? "none"],
    enabled: Boolean(workspaceId),
    queryFn: () =>
      listPlans({
        data: {
          projectId,
          workspaceId: workspaceId ?? undefined,
        },
      }),
  });

export const planDetailQuery = (planId: string) =>
  queryOptions({
    queryKey: qk.plan(planId),
    queryFn: () => getPlan({ data: { planId } }),
    enabled: Boolean(planId),
  });

export const planAgentsQuery = (workspaceId?: string | null) =>
  queryOptions({
    queryKey: [...qk.planAgents(), workspaceId ?? "none"],
    enabled: Boolean(workspaceId),
    queryFn: () => listAgents({ data: { workspaceId: workspaceId ?? undefined } }),
  });

export const planEventsQuery = (planId: string, limit = 50) =>
  queryOptions({
    queryKey: qk.planEvents(planId),
    queryFn: () => getPlanEvents({ data: { planId, limit } }),
    enabled: Boolean(planId),
  });

export const taskCommentsQuery = (taskId: string) =>
  queryOptions({
    queryKey: qk.taskComments(taskId),
    queryFn: () => listTaskComments({ data: { taskId } }),
    enabled: Boolean(taskId),
  });

export const ticketTasksQuery = (ticketId: string) =>
  queryOptions({
    queryKey: qk.ticketTasks(ticketId),
    queryFn: () => listTasksByTicket({ data: { ticketId } }),
    enabled: Boolean(ticketId),
  });

export const apiKeysQuery = (workspaceId?: string | null) =>
  queryOptions({
    queryKey: [...qk.apiKeys(), workspaceId ?? "none"],
    enabled: Boolean(workspaceId),
    queryFn: () => listApiKeys({ data: { workspaceId: workspaceId ?? undefined } }),
  });
