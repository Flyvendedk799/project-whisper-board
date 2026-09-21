import { queryOptions } from "@tanstack/react-query";
import { qk } from "./keys";
import {
  listPlans,
  getPlan,
  listAgents,
  getPlanEvents,
  listTaskComments,
  listApiKeys,
} from "@/lib/planner.functions";

export const planListQuery = () =>
  queryOptions({
    queryKey: qk.planList(),
    queryFn: () => listPlans(),
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
    queryFn: () => listTaskComments({ taskId }),
    enabled: Boolean(taskId),
  });

export const apiKeysQuery = () =>
  queryOptions({
    queryKey: qk.apiKeys(),
    queryFn: () => listApiKeys(),
  });
