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

export const planListQuery = (projectId?: string) =>
  queryOptions({
    queryKey: projectId ? [...qk.planList(), { projectId }] : qk.planList(),
    queryFn: () => listPlans({ data: { projectId } }),
  });

export const planDetailQuery = (planId: string) =>
  queryOptions({
    queryKey: qk.plan(planId),
    queryFn: () => getPlan({ planId }),
    enabled: Boolean(planId),
  });

export const planAgentsQuery = () =>
  queryOptions({
    queryKey: qk.planAgents(),
    queryFn: () => listAgents(),
  });

export const planEventsQuery = (planId: string, limit = 50) =>
  queryOptions({
    queryKey: qk.planEvents(planId),
    queryFn: () => getPlanEvents({ planId, limit }),
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

export const apiKeysQuery = () =>
  queryOptions({
    queryKey: qk.apiKeys(),
    queryFn: () => listApiKeys(),
  });
