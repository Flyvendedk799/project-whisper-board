import { queryOptions } from "@tanstack/react-query";
import { qk } from "./keys";
import {
  listPlans,
  getPlan,
  listAgents,
  getPlanEvents,
  listTaskComments,
  listApiKeys,
  listPlanAttachments,
  listTasksByTicket,
} from "@/lib/planner.functions";
import { getPlanPullRequests } from "@/lib/plan-pulls.functions";
import { getClientPlan } from "@/lib/plan-client-view.functions";
import { getAiSettings } from "@/lib/ai-planner.functions";
import { listPlanPatches } from "@/lib/plan-patches.functions";

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

/** The plan's pull requests in merge order, as GitHub has them. Asked afresh, not polled. */
export const planPullsQuery = (planId: string) =>
  queryOptions({
    queryKey: qk.planPulls(planId),
    queryFn: () => getPlanPullRequests({ data: { planId } }),
    enabled: Boolean(planId),
    staleTime: 60_000,
  });

export const planPatchesQuery = (planId: string) =>
  queryOptions({
    queryKey: qk.planPatches(planId),
    queryFn: () => listPlanPatches({ data: { planId } }),
  });

/** Every file on a plan with signed URLs. Refetched before the hour is up. */
export const planAttachmentsQuery = (planId: string) =>
  queryOptions({
    queryKey: qk.planAttachments(planId),
    queryFn: () => listPlanAttachments({ data: { planId } }),
    enabled: Boolean(planId),
    staleTime: 20 * 60_000,
    refetchInterval: 40 * 60_000,
  });

/** The signed-in person's own AI switches. Off until they turn something on. */
export const userAiSettingsQuery = () =>
  queryOptions({
    queryKey: qk.aiSettings(),
    queryFn: () => getAiSettings(),
    staleTime: 5 * 60_000,
  });

/** The plan as its clients see it: the client layer only. */
export const clientPlanQuery = (planId: string) =>
  queryOptions({
    queryKey: [...qk.plan(planId), "client"],
    queryFn: () => getClientPlan({ data: { planId } }),
    enabled: Boolean(planId),
  });
