import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guard, requireFound } from "@/lib/server-errors";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";
import {
  OPEN_TICKET_STATUSES,
  taskDescriptionFromTicket,
  taskTitleFromTicket,
  ticketPriorityToTask,
} from "@/lib/ticket-task";
import { normalizeScopes } from "@/lib/api-scopes";
import { isOrphanPullRequestRef, isOrphanTicketRef, scrubCommentIfUnlinked } from "@/lib/plan-refs";
import { MAX_STEP_DEPTH, splitDescriptionSteps, STEP_TEXT_MAX } from "@/lib/plan-markdown";
import { applyPlanMarkdown, attachmentPathsWhere, purgePlanFiles } from "@/lib/plan-import";
import { isPlanAttachmentPath, PLAN_ATTACHMENT_BUCKET, validateFileMeta } from "@/lib/upload";
import {
  eventKindForStatus,
  placeTask,
  SECTION_PALETTE,
  STATUS_STYLE,
} from "@/features/planner/plan-model";
import { createClient } from "@supabase/supabase-js";
import { Constants, type Database } from "@/integrations/supabase/types";

const workspaceIdField = z.string().uuid().optional();
const planStatusEnum = z.enum(Constants.public.Enums.plan_status);
const planTaskStatusEnum = z.enum(Constants.public.Enums.plan_task_status);
const planTaskPriorityEnum = z.enum(Constants.public.Enums.plan_task_priority);
const planTaskComplexityEnum = z.enum(Constants.public.Enums.plan_task_complexity);

type PlanUpdate = Database["public"]["Tables"]["plans"]["Update"];
type PlanSectionUpdate = Database["public"]["Tables"]["plan_sections"]["Update"];
type PlanTaskUpdate = Database["public"]["Tables"]["plan_tasks"]["Update"];
type TicketPriority = Database["public"]["Enums"]["ticket_priority"];

type PlanTaskRefRow = {
  id: string;
  ticket_id?: string | null;
  ticket?: { id: string } | null;
  pr_number?: number | null;
  pr_url?: string | null;
  pr_status?: string | null;
};

/** Clear structured refs that would show as live links to missing tickets/PRs. */
async function healOrphanPlanTaskRefs(
  supabase: SupabaseClient<Database>,
  plan: { sections?: Array<{ tasks?: PlanTaskRefRow[] | null } | null> | null },
) {
  const orphanTickets: string[] = [];
  const orphanPrs: string[] = [];

  for (const section of plan.sections ?? []) {
    for (const task of section?.tasks ?? []) {
      if (!task) continue;
      if (isOrphanTicketRef(task)) {
        orphanTickets.push(task.id);
        task.ticket_id = null;
      }
      if (isOrphanPullRequestRef(task)) {
        orphanPrs.push(task.id);
        task.pr_number = null;
        task.pr_status = null;
      }
    }
  }

  if (orphanTickets.length > 0) {
    const { error } = await supabase
      .from("plan_tasks")
      .update({ ticket_id: null })
      .in("id", orphanTickets);
    if (error) console.error("[planner] clear orphan ticket refs", error.message);
  }
  if (orphanPrs.length > 0) {
    const { error } = await supabase
      .from("plan_tasks")
      .update({ pr_number: null, pr_status: null })
      .in("id", orphanPrs);
    if (error) console.error("[planner] clear orphan PR refs", error.message);
  }
}

async function noteTicketPlannerEvent(
  supabase: SupabaseClient<Database>,
  userId: string,
  ticketId: string,
  kind: "planner_linked" | "planner_done",
  taskTitle: string,
) {
  const { error } = await supabase.from("ticket_events").insert({
    ticket_id: ticketId,
    actor_id: userId,
    kind,
    new_value: taskTitle.slice(0, 200),
  });
  if (error) console.error("[planner] ticket event", error.message);
}

async function sectionForPlan(
  supabase: SupabaseClient<Database>,
  planId: string,
  sectionId?: string,
) {
  if (sectionId) {
    const { data } = await supabase
      .from("plan_sections")
      .select("id")
      .eq("id", sectionId)
      .eq("plan_id", planId)
      .maybeSingle();
    return requireFound(data, "section").id;
  }

  const { data: existing } = await supabase
    .from("plan_sections")
    .select("id")
    .eq("plan_id", planId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("plan_sections")
    .insert({ plan_id: planId, title: "From tickets", position: 1 })
    .select("id")
    .single();
  if (error) throw error;
  return created.id;
}

async function resolveWorkspaceMembership(
  supabase: SupabaseClient<Database>,
  userId: string,
  workspaceId?: string,
) {
  let query = supabase.from("workspace_members").select("workspace_id").eq("user_id", userId);
  if (workspaceId) query = query.eq("workspace_id", workspaceId);
  const { data: membership } = await query.limit(1).single();
  return requireFound(membership, "workspace_membership");
}

/** Service-role client, for signing URLs and removing files. Never for reads of plan rows. */
function storageAdmin() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type PlanEventKind = Database["public"]["Enums"]["plan_event_kind"];

/**
 * One row in the activity feed. A failed write here must never fail the action
 * that caused it, so it is reported and swallowed.
 */
async function logPlanEvent(
  supabase: SupabaseClient<Database>,
  userId: string,
  event: {
    planId: string;
    taskId?: string | null;
    kind: PlanEventKind;
    oldValue?: string | null;
    newValue?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
  },
) {
  const { error } = await supabase.from("plan_events").insert({
    plan_id: event.planId,
    task_id: event.taskId ?? null,
    actor_id: userId,
    kind: event.kind,
    old_value: event.oldValue ?? null,
    new_value: event.newValue ?? null,
    metadata: event.metadata ?? {},
  });
  if (error) console.error("[planner] plan event", error.message);
}

const SIGNED_URL_SECONDS = 60 * 60;

export const createPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        title: z.string().min(1).max(200),
        description: z.string().optional(),
        projectId: z.string().uuid().optional(),
        githubRepo: z.string().optional(),
        githubBase: z.string().optional(),
        workspaceId: workspaceIdField,
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("plans.create", async () => {
      const { supabase, userId } = context;

      const membership = await resolveWorkspaceMembership(supabase, userId, data.workspaceId);

      let githubRepo = data.githubRepo ?? null;
      let githubBase = data.githubBase ?? null;
      if (data.projectId && (!githubRepo || !githubBase)) {
        const { data: project } = await supabase
          .from("projects")
          .select("github_repo, github_default_branch")
          .eq("id", data.projectId)
          .maybeSingle();
        if (!githubRepo) githubRepo = project?.github_repo ?? null;
        if (!githubBase) githubBase = project?.github_default_branch ?? null;
      }

      const { data: plan, error } = await supabase
        .from("plans")
        .insert({
          workspace_id: membership.workspace_id,
          title: data.title,
          description: data.description ?? null,
          project_id: data.projectId ?? null,
          github_repo: githubRepo,
          github_base: githubBase,
          created_by: userId,
        })
        .select("id")
        .single();
      if (error) throw error;

      await supabase.from("plan_events").insert({
        plan_id: plan.id,
        actor_id: userId,
        kind: "plan_created",
      });

      return { id: plan.id };
    }),
  );

export const updatePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        planId: z.string().uuid(),
        title: z.string().min(1).max(200).optional(),
        description: z.string().optional(),
        status: planStatusEnum.optional(),
        projectId: z.string().uuid().nullable().optional(),
        githubRepo: z.string().max(200).nullable().optional(),
        githubBase: z.string().max(200).nullable().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("plans.update", async () => {
      const { supabase, userId } = context;
      const { planId, ...fields } = data;

      const { data: before } = await supabase
        .from("plans")
        .select("status")
        .eq("id", planId)
        .single();

      const patch: PlanUpdate = {
        ...(fields.title !== undefined && { title: fields.title }),
        ...(fields.description !== undefined && { description: fields.description }),
        ...(fields.status !== undefined && { status: fields.status }),
        ...(fields.projectId !== undefined && { project_id: fields.projectId }),
        ...(fields.githubRepo !== undefined && { github_repo: fields.githubRepo }),
        ...(fields.githubBase !== undefined && { github_base: fields.githubBase }),
      };

      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from("plans").update(patch).eq("id", planId);
        if (error) throw error;
      }

      if (fields.status && before && fields.status !== before.status) {
        if (fields.status === "active") {
          await supabase
            .from("plan_events")
            .insert({ plan_id: planId, actor_id: userId, kind: "plan_activated" });
        } else if (fields.status === "completed") {
          await supabase
            .from("plan_events")
            .insert({ plan_id: planId, actor_id: userId, kind: "plan_completed" });
        }
      }

      return { ok: true };
    }),
  );

export const listPlans = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        projectId: z.string().optional(),
        workspaceId: workspaceIdField,
      })
      .optional()
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("plans.list", async () => {
      const { supabase, userId } = context;

      const membership = await resolveWorkspaceMembership(supabase, userId, data?.workspaceId);

      let query = supabase
        .from("plans")
        .select(
          `
          *,
          project:projects(id, title),
          plan_sections(count),
          plan_tasks(status)
        `,
        )
        .eq("workspace_id", membership.workspace_id)
        .order("updated_at", { ascending: false });

      if (data?.projectId) {
        query = query.eq("project_id", data.projectId);
      }

      const { data: plans, error } = await query;
      if (error) throw error;

      return {
        plans: (plans ?? []).map((plan) => {
          const sectionCount = Array.isArray(plan.plan_sections)
            ? (plan.plan_sections[0]?.count ?? 0)
            : 0;
          const tasks = Array.isArray(plan.plan_tasks) ? plan.plan_tasks : [];
          const { plan_sections: _sections, plan_tasks: _tasks, ...rest } = plan;
          return {
            ...rest,
            section_count: sectionCount,
            task_count: tasks.length,
            done_task_count: tasks.filter((task) => task.status === "done").length,
          };
        }),
      };
    }),
  );

export const listTasksByTicket = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ ticketId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("tasks.listByTicket", async () => {
      const { supabase } = context;
      const { data: tasks, error } = await supabase
        .from("plan_tasks")
        .select(
          `
          *,
          plan:plans(id, title),
          assigned_agent:plan_agents(id, name, provider, model),
          assigned_user:profiles(id, full_name, email, avatar_url)
        `,
        )
        .eq("ticket_id", data.ticketId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return tasks ?? [];
    }),
  );

export const getPlan = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("plans.get", async () => {
      const { supabase } = context;

      const { data: plan, error } = await supabase
        .from("plans")
        .select(
          `
          *,
          project:projects(id, title, github_repo, github_default_branch),
          sections:plan_sections(
            *,
            tasks:plan_tasks(
              *,
              assigned_agent:plan_agents(id, name, provider, model),
              assigned_user:profiles(id, full_name, email, avatar_url),
              ticket:tickets(id, ticket_number, title, status),
              steps:plan_task_steps(*),
              comment_count:plan_task_comments(count)
            )
          )
        `,
        )
        .eq("id", data.planId)
        .order("position", { referencedTable: "plan_sections", ascending: true })
        .order("position", { referencedTable: "plan_sections.plan_tasks", ascending: true })
        .order("position", {
          referencedTable: "plan_sections.plan_tasks.plan_task_steps",
          ascending: true,
        })
        .single();
      if (error) throw error;
      const found = requireFound(plan, "plan");
      await healOrphanPlanTaskRefs(supabase, found);
      // PostgREST's embedded ordering is not something to lean on when the
      // embeds are aliased; order here so the board never depends on it.
      const byPosition = (a: { position: number | null }, b: { position: number | null }) =>
        (a.position ?? 0) - (b.position ?? 0);
      found.sections = [...(found.sections ?? [])].sort(byPosition).map((section) => ({
        ...section,
        tasks: [...(section.tasks ?? [])].sort(byPosition).map((task) => ({
          ...task,
          steps: [...(task.steps ?? [])].sort(byPosition),
        })),
      }));
      return { plan: found };
    }),
  );

export const createSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        planId: z.string().uuid(),
        title: z.string().min(1).max(100),
        description: z.string().optional(),
        color: z.string().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("sections.create", async () => {
      const { supabase, userId } = context;

      const { data: maxPosSection } = await supabase
        .from("plan_sections")
        .select("position")
        .eq("plan_id", data.planId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();

      const position = maxPosSection ? (maxPosSection.position || 0) + 1 : 1;
      // Sections take the next colour in the palette unless one was chosen.
      const color = data.color ?? SECTION_PALETTE[(position - 1) % SECTION_PALETTE.length];

      const { data: section, error } = await supabase
        .from("plan_sections")
        .insert({
          plan_id: data.planId,
          title: data.title,
          description: data.description ?? null,
          color,
          position,
        })
        .select("id")
        .single();
      if (error) throw error;

      await logPlanEvent(supabase, userId, {
        planId: data.planId,
        kind: "section_created",
        newValue: data.title,
      });

      return { id: section.id };
    }),
  );

export const updateSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        sectionId: z.string().uuid(),
        title: z.string().min(1).max(100).optional(),
        description: z.string().optional(),
        color: z.string().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("sections.update", async () => {
      const { supabase, userId } = context;
      const { sectionId, ...fields } = data;

      const { data: sectionRow } = await supabase
        .from("plan_sections")
        .select("plan_id")
        .eq("id", sectionId)
        .single();
      const section = requireFound(sectionRow, "section");

      const patch: PlanSectionUpdate = {
        ...(fields.title !== undefined && { title: fields.title }),
        ...(fields.description !== undefined && { description: fields.description }),
        ...(fields.color !== undefined && { color: fields.color }),
      };

      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from("plan_sections").update(patch).eq("id", sectionId);
        if (error) throw error;
      }

      await logPlanEvent(supabase, userId, {
        planId: section.plan_id,
        kind: "section_updated",
        newValue: fields.title ?? null,
      });

      return { ok: true };
    }),
  );

export const deleteSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ sectionId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("sections.delete", async () => {
      const { supabase } = context;
      const { count, error: countError } = await supabase
        .from("plan_tasks")
        .select("id", { count: "exact", head: true })
        .eq("section_id", data.sectionId);
      if (countError) throw countError;
      if ((count ?? 0) > 0) {
        throw new AppError(
          "section_not_empty",
          "Move this section's tasks somewhere else before deleting it.",
          { status: 409 },
        );
      }
      const { error } = await supabase.from("plan_sections").delete().eq("id", data.sectionId);
      if (error) throw error;
      return { ok: true };
    }),
  );

export const reorderSections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        planId: z.string().uuid(),
        order: z.array(z.string().uuid()),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("sections.reorder", async () => {
      const { supabase } = context;

      for (let i = 0; i < data.order.length; i++) {
        const { error } = await supabase
          .from("plan_sections")
          .update({ position: i + 1 })
          .eq("id", data.order[i])
          .eq("plan_id", data.planId);
        if (error) throw error;
      }

      return { ok: true };
    }),
  );

export const createTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        planId: z.string().uuid(),
        sectionId: z.string().uuid(),
        title: z.string().min(1).max(200),
        description: z.string().optional(),
        priority: planTaskPriorityEnum.optional(),
        complexity: planTaskComplexityEnum.optional(),
        labels: z.array(z.string()).optional(),
        dependsOn: z.array(z.string().uuid()).optional(),
        preferredProviders: z.array(z.string()).optional(),
        preferredModels: z.array(z.string()).optional(),
        contextFiles: z.array(z.string()).optional(),
        acceptanceCriteria: z.array(z.string()).optional(),
        estimatedMinutes: z.number().optional(),
        ticketId: z.string().uuid().optional(),
        status: planTaskStatusEnum.optional(),
        assignedUserId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("tasks.create", async () => {
      const { supabase, userId } = context;

      const { data: maxPosTask } = await supabase
        .from("plan_tasks")
        .select("position")
        .eq("section_id", data.sectionId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();

      const position = maxPosTask ? (maxPosTask.position || 0) + 1 : 1;

      const { data: task, error } = await supabase
        .from("plan_tasks")
        .insert({
          plan_id: data.planId,
          section_id: data.sectionId,
          title: data.title,
          description: data.description ?? null,
          ...(data.priority !== undefined && { priority: data.priority }),
          ...(data.complexity !== undefined && { complexity: data.complexity }),
          labels: data.labels ?? [],
          depends_on: data.dependsOn ?? [],
          preferred_providers: data.preferredProviders ?? [],
          preferred_models: data.preferredModels ?? [],
          context_files: data.contextFiles ?? [],
          acceptance_criteria: data.acceptanceCriteria?.length
            ? data.acceptanceCriteria.join("\n")
            : null,
          estimated_minutes: data.estimatedMinutes ?? null,
          status: data.status ?? "available",
          position,
          ...(data.assignedUserId ? { assigned_user_id: data.assignedUserId } : {}),
          ...(data.ticketId ? { ticket_id: data.ticketId } : {}),
        })
        .select("id")
        .single();
      if (error) throw error;

      await logPlanEvent(supabase, userId, {
        planId: data.planId,
        taskId: task.id,
        kind: "task_created",
        newValue: data.title,
      });

      if (data.ticketId) {
        await noteTicketPlannerEvent(supabase, userId, data.ticketId, "planner_linked", data.title);
      }

      return { id: task.id };
    }),
  );

export const updateTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        taskId: z.string().uuid(),
        title: z.string().optional(),
        description: z.string().optional(),
        status: planTaskStatusEnum.optional(),
        priority: planTaskPriorityEnum.optional(),
        complexity: planTaskComplexityEnum.nullable().optional(),
        labels: z.array(z.string()).optional(),
        dependsOn: z.array(z.string().uuid()).optional(),
        preferredProviders: z.array(z.string()).optional(),
        preferredModels: z.array(z.string()).optional(),
        contextFiles: z.array(z.string()).optional(),
        acceptanceCriteria: z.array(z.string()).optional(),
        estimatedMinutes: z.number().optional(),
        branchName: z.string().optional(),
        assignedUserId: z.string().uuid().nullable().optional(),
        ticketId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("tasks.update", async () => {
      const { supabase, userId } = context;
      const { taskId, ...fields } = data;

      const { data: beforeRow } = await supabase
        .from("plan_tasks")
        .select("plan_id, status, ticket_id, title")
        .eq("id", taskId)
        .single();
      const before = requireFound(beforeRow, "task");

      const patch: PlanTaskUpdate = {};
      if (fields.title !== undefined) patch.title = fields.title;
      if (fields.description !== undefined) patch.description = fields.description;
      if (fields.status !== undefined) patch.status = fields.status;
      if (fields.priority !== undefined) patch.priority = fields.priority;
      if (fields.complexity !== undefined) patch.complexity = fields.complexity;
      if (fields.labels !== undefined) patch.labels = fields.labels;
      if (fields.dependsOn !== undefined) patch.depends_on = fields.dependsOn;
      if (fields.preferredProviders !== undefined)
        patch.preferred_providers = fields.preferredProviders;
      if (fields.preferredModels !== undefined) patch.preferred_models = fields.preferredModels;
      if (fields.contextFiles !== undefined) patch.context_files = fields.contextFiles;
      if (fields.acceptanceCriteria !== undefined) {
        patch.acceptance_criteria = fields.acceptanceCriteria.length
          ? fields.acceptanceCriteria.join("\n")
          : null;
      }
      if (fields.estimatedMinutes !== undefined) patch.estimated_minutes = fields.estimatedMinutes;
      if (fields.branchName !== undefined) patch.branch_name = fields.branchName;
      if (fields.assignedUserId !== undefined) patch.assigned_user_id = fields.assignedUserId;
      if (fields.ticketId !== undefined) patch.ticket_id = fields.ticketId;

      if (fields.status && fields.status !== before.status) {
        if (fields.status === "done") {
          patch.completed_at = new Date().toISOString();
        }
        if (
          (before.status === "claimed" || before.status === "in_progress") &&
          fields.status === "available"
        ) {
          patch.assigned_agent_id = null;
          patch.claimed_at = null;
        }
      }

      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from("plan_tasks").update(patch).eq("id", taskId);
        if (error) throw error;
      }

      if (Object.keys(patch).length > 0) {
        const statusChanged = fields.status !== undefined && fields.status !== before.status;
        await logPlanEvent(supabase, userId, {
          planId: before.plan_id,
          taskId,
          kind: statusChanged ? eventKindForStatus(fields.status!) : "task_updated",
          oldValue: statusChanged ? before.status : null,
          newValue: statusChanged
            ? `Status: ${STATUS_STYLE[fields.status!].label}`
            : (fields.title ?? null),
        });
      }

      const linkedTicket = fields.ticketId !== undefined ? fields.ticketId : before.ticket_id;
      const taskTitle = fields.title ?? before.title;
      if (fields.ticketId) {
        await noteTicketPlannerEvent(
          supabase,
          userId,
          fields.ticketId,
          "planner_linked",
          taskTitle,
        );
      }
      if (fields.status === "done" && fields.status !== before.status && linkedTicket) {
        await noteTicketPlannerEvent(supabase, userId, linkedTicket, "planner_done", taskTitle);
      }

      return { ok: true };
    }),
  );

export const moveTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        taskId: z.string().uuid(),
        sectionId: z.string().uuid(),
        position: z.number().int(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("tasks.move", async () => {
      const { supabase } = context;

      const { error } = await supabase
        .from("plan_tasks")
        .update({ section_id: data.sectionId, position: data.position })
        .eq("id", data.taskId);
      if (error) throw error;

      return { ok: true };
    }),
  );

export const bulkUpdateTasks = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        taskIds: z.array(z.string().uuid()).min(1),
        status: planTaskStatusEnum.optional(),
        priority: planTaskPriorityEnum.optional(),
        complexity: planTaskComplexityEnum.optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("tasks.bulkUpdate", async () => {
      const { supabase } = context;

      const patch: PlanTaskUpdate = {
        ...(data.status !== undefined && { status: data.status }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.complexity !== undefined && { complexity: data.complexity }),
      };

      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from("plan_tasks").update(patch).in("id", data.taskIds);
        if (error) throw error;
      }

      return { ok: true };
    }),
  );

export const deleteTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ taskId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("tasks.delete", async () => {
      const { supabase, userId } = context;
      const { data: row } = await supabase
        .from("plan_tasks")
        .select("plan_id, title")
        .eq("id", data.taskId)
        .maybeSingle();
      const paths = await attachmentPathsWhere(supabase, "task_id", [data.taskId]);
      const { error } = await supabase.from("plan_tasks").delete().eq("id", data.taskId);
      if (error) throw error;
      await purgePlanFiles(paths);
      if (row) {
        await logPlanEvent(supabase, userId, {
          planId: row.plan_id,
          kind: "task_deleted",
          oldValue: row.title,
          metadata: { title: row.title },
        });
      }
      return { ok: true };
    }),
  );

/**
 * Drop a task into a section, before another task or at the end. The whole
 * target column is renumbered 1..n so positions never tie, which the old
 * `moveTask` (one row, one number) could not guarantee.
 */
export const moveTaskTo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        taskId: z.string().uuid(),
        sectionId: z.string().uuid(),
        beforeTaskId: z.string().uuid().nullable().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("tasks.moveTo", async () => {
      const { supabase, userId } = context;

      const { data: taskRow } = await supabase
        .from("plan_tasks")
        .select("id, plan_id, section_id, title")
        .eq("id", data.taskId)
        .maybeSingle();
      const task = requireFound(taskRow, "task");

      const { data: sectionRow } = await supabase
        .from("plan_sections")
        .select("id, title")
        .eq("id", data.sectionId)
        .eq("plan_id", task.plan_id)
        .maybeSingle();
      const section = requireFound(sectionRow, "section");

      const { data: siblings, error: siblingsError } = await supabase
        .from("plan_tasks")
        .select("id, position")
        .eq("section_id", data.sectionId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (siblingsError) throw siblingsError;

      const order = placeTask(
        (siblings ?? []).map((row) => row.id),
        data.taskId,
        data.beforeTaskId,
      );
      const current = new Map((siblings ?? []).map((row) => [row.id, row.position]));

      for (let index = 0; index < order.length; index++) {
        const id = order[index];
        const position = index + 1;
        const moved = id === data.taskId;
        if (!moved && current.get(id) === position) continue;
        const { error } = await supabase
          .from("plan_tasks")
          .update(moved ? { section_id: data.sectionId, position } : { position })
          .eq("id", id);
        if (error) throw error;
      }

      if (task.section_id !== data.sectionId) {
        await logPlanEvent(supabase, userId, {
          planId: task.plan_id,
          taskId: task.id,
          kind: "task_moved",
          newValue: `to ${section.title}`,
        });
      }

      return { ok: true };
    }),
  );

/** Hands a task back: no agent, no claim, and "available" again unless it is done or blocked. */
export const releaseTaskAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ taskId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("tasks.releaseAgent", async () => {
      const { supabase, userId } = context;
      const { data: taskRow } = await supabase
        .from("plan_tasks")
        .select("id, plan_id, status, assigned_agent_id")
        .eq("id", data.taskId)
        .maybeSingle();
      const task = requireFound(taskRow, "task");
      if (!task.assigned_agent_id) return { ok: true };

      const reopen = task.status === "claimed" || task.status === "in_progress";
      const { error } = await supabase
        .from("plan_tasks")
        .update({
          assigned_agent_id: null,
          claimed_at: null,
          ...(reopen ? { status: "available" as const } : {}),
        })
        .eq("id", task.id);
      if (error) throw error;

      await logPlanEvent(supabase, userId, {
        planId: task.plan_id,
        taskId: task.id,
        kind: "task_unclaimed",
      });
      return { ok: true };
    }),
  );

export const listAgents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ workspaceId: workspaceIdField }).optional().parse(input),
  )
  .handler(({ data, context }) =>
    guard("agents.list", async () => {
      const { supabase, userId } = context;

      const membership = await resolveWorkspaceMembership(supabase, userId, data?.workspaceId);

      const { data: agents, error } = await supabase
        .from("plan_agents")
        .select("*")
        .eq("workspace_id", membership.workspace_id)
        .order("last_seen_at", { ascending: false, nullsFirst: false });
      if (error) throw error;

      return { agents };
    }),
  );

export const registerAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        name: z.string().min(1).max(100),
        provider: z.string().min(1).max(100),
        model: z.string().optional(),
        capabilities: z.array(z.string()).optional(),
        workspaceId: workspaceIdField,
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("agents.register", async () => {
      const { supabase, userId } = context;

      const membership = await resolveWorkspaceMembership(supabase, userId, data.workspaceId);

      const { data: agent, error } = await supabase
        .from("plan_agents")
        .insert({
          workspace_id: membership.workspace_id,
          name: data.name,
          provider: data.provider,
          model: data.model ?? null,
          capabilities: data.capabilities ?? [],
        })
        .select("id")
        .single();
      if (error) throw error;

      return { id: agent.id };
    }),
  );

export const getPlanEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        planId: z.string().uuid(),
        limit: z.number().int().optional().default(50),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("events.get", async () => {
      const { supabase } = context;

      const { data: events, error } = await supabase
        .from("plan_events")
        .select(
          "*, actor:profiles(id, full_name, email, avatar_url), agent:plan_agents(id, name, provider, model)",
        )
        .eq("plan_id", data.planId)
        .order("created_at", { ascending: false })
        .limit(data.limit);
      if (error) throw error;

      return { events };
    }),
  );

export const addTaskComment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        taskId: z.string().uuid(),
        // A note may be only files; the body is then a short placeholder.
        body: z.string().max(10000),
        /** Files already attached to the task that belong to this note. */
        attachmentIds: z.array(z.string().uuid()).max(20).optional(),
      })
      .refine((value) => value.body.trim().length > 0 || (value.attachmentIds?.length ?? 0) > 0, {
        message: "Write a note or attach a file.",
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("comments.add", async () => {
      const { supabase, userId } = context;

      const { data: taskRow } = await supabase
        .from("plan_tasks")
        .select("plan_id")
        .eq("id", data.taskId)
        .single();
      const task = requireFound(taskRow, "task");

      const { data: comment, error } = await supabase
        .from("plan_task_comments")
        .insert({
          task_id: data.taskId,
          author_id: userId,
          body: data.body.trim(),
        })
        .select("id")
        .single();
      if (error) throw error;

      if (data.attachmentIds?.length) {
        const { error: linkError } = await supabase
          .from("plan_task_attachments")
          .update({ comment_id: comment.id })
          .in("id", data.attachmentIds)
          .eq("task_id", data.taskId);
        if (linkError) throw linkError;
      }

      await logPlanEvent(supabase, userId, {
        planId: task.plan_id,
        taskId: data.taskId,
        kind: "comment_added",
        newValue: data.body.trim().slice(0, 200) || null,
      });

      return { id: comment.id };
    }),
  );

export const listTaskComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ taskId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("comments.list", async () => {
      const { supabase } = context;

      const { data: task, error: taskError } = await supabase
        .from("plan_tasks")
        .select("id, ticket_id, pr_url, pr_number, ticket:tickets(id)")
        .eq("id", data.taskId)
        .maybeSingle();
      if (taskError) throw taskError;

      const { data: comments, error } = await supabase
        .from("plan_task_comments")
        .select(
          "*, author:profiles(id, full_name, email, avatar_url), agent:plan_agents(id, name, provider, model)",
        )
        .eq("task_id", data.taskId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      const { data: fileRows } = await supabase
        .from("plan_task_attachments")
        .select("comment_id")
        .eq("task_id", data.taskId)
        .not("comment_id", "is", null);
      const hasFiles = new Set((fileRows ?? []).map((row) => row.comment_id));

      const ref = {
        ticket_id: task?.ticket_id ?? null,
        ticket: (task?.ticket as { id: string } | null | undefined) ?? null,
        pr_url: task?.pr_url ?? null,
        pr_number: task?.pr_number ?? null,
      };

      return {
        comments: (comments ?? [])
          .map((entry) => ({
            ...entry,
            body: scrubCommentIfUnlinked(entry.body ?? "", ref),
          }))
          // A note that is only files has an empty body and still counts.
          .filter((entry) => entry.body.trim().length > 0 || hasFiles.has(entry.id)),
      };
    }),
  );

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        name: z.string().min(1).max(100),
        scopes: z.array(z.string()).optional(),
        workspaceId: workspaceIdField,
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("apiKeys.create", async () => {
      const { supabase, userId } = context;
      const crypto = await import("node:crypto");

      const membership = await resolveWorkspaceMembership(supabase, userId, data.workspaceId);

      const rawKey = "cpk_" + crypto.randomBytes(16).toString("hex");
      const hashedKey = crypto.createHash("sha256").update(rawKey).digest("hex");
      const prefix = rawKey.slice(0, 8);

      const { data: key, error } = await supabase
        .from("api_keys")
        .insert({
          workspace_id: membership.workspace_id,
          name: data.name,
          key_prefix: prefix,
          key_hash: hashedKey,
          scopes: normalizeScopes(data.scopes ?? ["planner"]),
          created_by: userId,
        })
        .select("id")
        .single();
      if (error) throw error;

      return { id: key.id, rawKey };
    }),
  );

export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ workspaceId: workspaceIdField }).optional().parse(input),
  )
  .handler(({ data, context }) =>
    guard("apiKeys.list", async () => {
      const { supabase, userId } = context;

      const membership = await resolveWorkspaceMembership(supabase, userId, data?.workspaceId);

      const { data: keys, error } = await supabase
        .from("api_keys")
        .select("id, name, key_prefix, scopes, last_used_at, created_at, revoked_at")
        .eq("workspace_id", membership.workspace_id)
        .order("created_at", { ascending: false });
      if (error) throw error;

      return { keys };
    }),
  );

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ keyId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("apiKeys.revoke", async () => {
      const { supabase } = context;

      const { error } = await supabase
        .from("api_keys")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", data.keyId);
      if (error) throw error;

      return { ok: true };
    }),
  );

export const createTaskFromTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        ticketId: z.string().uuid(),
        planId: z.string().uuid(),
        sectionId: z.string().uuid().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("tasks.createFromTicket", async () => {
      const { supabase, userId } = context;

      const { data: ticket } = await supabase
        .from("tickets")
        .select("id, ticket_number, title, description, type, priority, project_id")
        .eq("id", data.ticketId)
        .maybeSingle();
      const found = requireFound(ticket, "ticket");

      const { data: plan } = await supabase
        .from("plans")
        .select("id, project_id")
        .eq("id", data.planId)
        .maybeSingle();
      const foundPlan = requireFound(plan, "plan");
      if (foundPlan.project_id && foundPlan.project_id !== found.project_id) {
        throw new AppError("plan_project", "That plan belongs to a different project.");
      }

      const { data: existing } = await supabase
        .from("plan_tasks")
        .select("id")
        .eq("plan_id", data.planId)
        .eq("ticket_id", found.id)
        .maybeSingle();
      if (existing) return { id: existing.id, created: false };

      const sectionId = await sectionForPlan(supabase, data.planId, data.sectionId);
      const { data: maxPosTask } = await supabase
        .from("plan_tasks")
        .select("position")
        .eq("section_id", sectionId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      const position = maxPosTask ? (maxPosTask.position || 0) + 1 : 1;
      const title = taskTitleFromTicket(found.title);

      const { data: task, error } = await supabase
        .from("plan_tasks")
        .insert({
          plan_id: data.planId,
          section_id: sectionId,
          title,
          description: taskDescriptionFromTicket(found),
          priority: ticketPriorityToTask(found.priority),
          labels: [found.type],
          status: "available",
          ticket_id: found.id,
          position,
        })
        .select("id")
        .single();
      if (error) throw error;

      await supabase.from("plan_events").insert({
        plan_id: data.planId,
        actor_id: userId,
        kind: "task_created",
      });
      await noteTicketPlannerEvent(supabase, userId, found.id, "planner_linked", title);

      return { id: task.id, created: true };
    }),
  );

export const importOpenTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        planId: z.string().uuid(),
        sectionId: z.string().uuid().optional(),
        ticketIds: z.array(z.string().uuid()).optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("tasks.importOpenTickets", async () => {
      const { supabase, userId } = context;

      const { data: plan } = await supabase
        .from("plans")
        .select("id, project_id")
        .eq("id", data.planId)
        .maybeSingle();
      const foundPlan = requireFound(plan, "plan");
      if (!foundPlan.project_id) {
        throw new AppError("plan_project", "Link this plan to a project before importing tickets.");
      }

      let ticketsQuery = supabase
        .from("tickets")
        .select("id, ticket_number, title, description, type, priority, status")
        .eq("project_id", foundPlan.project_id)
        .in("status", [...OPEN_TICKET_STATUSES]);
      if (data.ticketIds?.length) ticketsQuery = ticketsQuery.in("id", data.ticketIds);

      const { data: tickets, error: ticketsError } = await ticketsQuery;
      if (ticketsError) throw ticketsError;

      const { data: linked, error: linkedError } = await supabase
        .from("plan_tasks")
        .select("ticket_id")
        .eq("plan_id", data.planId)
        .not("ticket_id", "is", null);
      if (linkedError) throw linkedError;
      const linkedIds = new Set((linked ?? []).map((row) => row.ticket_id));

      const pending = (tickets ?? []).filter((ticket) => !linkedIds.has(ticket.id));
      if (pending.length === 0) return { created: 0, skipped: (tickets ?? []).length, taskIds: [] };

      const sectionId = await sectionForPlan(supabase, data.planId, data.sectionId);
      const { data: maxPosTask } = await supabase
        .from("plan_tasks")
        .select("position")
        .eq("section_id", sectionId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      let position = maxPosTask ? (maxPosTask.position || 0) + 1 : 1;

      const taskIds: string[] = [];
      for (const ticket of pending) {
        const title = taskTitleFromTicket(ticket.title);
        const { data: task, error } = await supabase
          .from("plan_tasks")
          .insert({
            plan_id: data.planId,
            section_id: sectionId,
            title,
            description: taskDescriptionFromTicket(ticket),
            priority: ticketPriorityToTask(ticket.priority as TicketPriority),
            labels: [ticket.type],
            status: "available",
            ticket_id: ticket.id,
            position,
          })
          .select("id")
          .single();
        if (error) throw error;
        position += 1;
        taskIds.push(task.id);
        await noteTicketPlannerEvent(supabase, userId, ticket.id, "planner_linked", title);
      }

      await supabase.from("plan_events").insert({
        plan_id: data.planId,
        actor_id: userId,
        kind: "task_created",
      });

      return {
        created: taskIds.length,
        skipped: (tickets ?? []).length - taskIds.length,
        taskIds,
      };
    }),
  );

export const suggestTasksFromTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        projectId: z.string().uuid().optional(),
        planId: z.string().uuid().optional(),
        limit: z.number().int().optional().default(8),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("planner.suggestTasksFromTickets", async () => {
      const { supabase } = context;

      let ticketsQuery = supabase
        .from("tickets")
        .select("id, ticket_number, title, description, type, priority, status")
        .in("status", [...OPEN_TICKET_STATUSES]);

      if (data.projectId) {
        ticketsQuery = ticketsQuery.eq("project_id", data.projectId);
      }

      const { data: tickets, error: ticketsError } = await ticketsQuery;
      if (ticketsError) throw ticketsError;

      let linkedIds = new Set<string | null>();
      if (data.planId) {
        const { data: linked, error: linkedError } = await supabase
          .from("plan_tasks")
          .select("ticket_id")
          .eq("plan_id", data.planId)
          .not("ticket_id", "is", null);
        if (linkedError) throw linkedError;
        linkedIds = new Set((linked ?? []).map((row) => row.ticket_id));
      }

      const suggestedTasks = (tickets ?? [])
        .filter((ticket) => !linkedIds.has(ticket.id))
        .slice(0, data.limit)
        .map((ticket) => ({
          ticketId: ticket.id,
          ticketNumber: ticket.ticket_number,
          title: taskTitleFromTicket(ticket.title),
          description: taskDescriptionFromTicket(ticket),
          priority: ticketPriorityToTask(ticket.priority),
          labels: [ticket.type],
          status: ticket.status,
        }));

      return {
        suggestedTasks,
        count: suggestedTasks.length,
        basedOnTicketsCount: tickets?.length ?? 0,
      };
    }),
  );

export const importPlanMarkdown = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        planId: z.string().uuid(),
        markdown: z.string().min(1).max(500_000),
        mode: z.enum(["replace", "merge", "sync"]),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("plans.importMarkdown", async () => {
      const { supabase, userId } = context;

      return applyPlanMarkdown(supabase, {
        planId: data.planId,
        markdown: data.markdown,
        mode: data.mode,
        actorId: userId,
      });
    }),
  );

// ---------------------------------------------------------------------------
// Sub-steps
// ---------------------------------------------------------------------------

const stepText = z
  .string()
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(z.string().min(1, "Write the step first.").max(STEP_TEXT_MAX));

export const createTaskStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        taskId: z.string().uuid(),
        text: stepText,
        depth: z.number().int().min(0).max(MAX_STEP_DEPTH).optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("steps.create", async () => {
      const { supabase } = context;
      const { data: last } = await supabase
        .from("plan_task_steps")
        .select("position, depth")
        .eq("task_id", data.taskId)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: step, error } = await supabase
        .from("plan_task_steps")
        .insert({
          task_id: data.taskId,
          text: data.text,
          depth: Math.min(data.depth ?? 0, last ? last.depth + 1 : 0),
          position: (last?.position ?? 0) + 1,
        })
        .select("id")
        .single();
      if (error) throw error;
      return { id: step.id };
    }),
  );

export const updateTaskStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        stepId: z.string().uuid(),
        text: stepText.optional(),
        done: z.boolean().optional(),
        depth: z.number().int().min(0).max(MAX_STEP_DEPTH).optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("steps.update", async () => {
      const { supabase } = context;
      const { stepId, ...fields } = data;
      const patch: Database["public"]["Tables"]["plan_task_steps"]["Update"] = {
        ...(fields.text !== undefined && { text: fields.text }),
        ...(fields.done !== undefined && { done: fields.done }),
        ...(fields.depth !== undefined && { depth: fields.depth }),
      };
      if (Object.keys(patch).length === 0) return { ok: true };
      const { error } = await supabase.from("plan_task_steps").update(patch).eq("id", stepId);
      if (error) throw error;
      return { ok: true };
    }),
  );

export const deleteTaskStep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ stepId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("steps.delete", async () => {
      const { supabase } = context;
      const { error } = await supabase.from("plan_task_steps").delete().eq("id", data.stepId);
      if (error) throw error;
      return { ok: true };
    }),
  );

/**
 * Moves the checklist lines (and, when asked, the plain bullets) out of a
 * task's description and into real steps. This is the path for plans that
 * were imported before steps existed.
 */
export const convertDescriptionToSteps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ taskId: z.string().uuid(), plainLists: z.boolean().optional() }).parse(input),
  )
  .handler(({ data, context }) =>
    guard("steps.fromDescription", async () => {
      const { supabase } = context;
      const { data: taskRow } = await supabase
        .from("plan_tasks")
        .select("id, description")
        .eq("id", data.taskId)
        .maybeSingle();
      const task = requireFound(taskRow, "task");

      const split = splitDescriptionSteps(task.description, { plainLists: data.plainLists });
      if (split.steps.length === 0) return { created: 0 };

      const { data: last } = await supabase
        .from("plan_task_steps")
        .select("position")
        .eq("task_id", task.id)
        .order("position", { ascending: false })
        .limit(1)
        .maybeSingle();
      let position = last?.position ?? 0;

      const { error } = await supabase.from("plan_task_steps").insert(
        split.steps
          .filter((step) => step.text.length > 0)
          .map((step) => ({
            task_id: task.id,
            text: step.text,
            done: step.done,
            depth: step.depth,
            position: ++position,
          })),
      );
      if (error) throw error;

      const { error: descriptionError } = await supabase
        .from("plan_tasks")
        .update({ description: split.description || null })
        .eq("id", task.id);
      if (descriptionError) throw descriptionError;

      return { created: split.steps.length };
    }),
  );

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

type AttachmentRow = Database["public"]["Tables"]["plan_task_attachments"]["Row"];

async function signAttachmentUrls(rows: AttachmentRow[]): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  if (rows.length === 0) return urls;
  const { data, error } = await storageAdmin()
    .storage.from(PLAN_ATTACHMENT_BUCKET)
    .createSignedUrls(
      rows.map((row) => row.storage_path),
      SIGNED_URL_SECONDS,
    );
  if (error) throw error;
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) urls.set(entry.path, entry.signedUrl);
  }
  return urls;
}

/** Every file on the plan, each with a signed URL that lasts an hour. */
export const listPlanAttachments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("attachments.list", async () => {
      const { supabase } = context;
      const { data: rows, error } = await supabase
        .from("plan_task_attachments")
        .select("*, uploader:profiles(id, full_name, email, avatar_url)")
        .eq("plan_id", data.planId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      const urls = await signAttachmentUrls(rows ?? []);
      return {
        attachments: (rows ?? []).map((row) => ({
          ...row,
          url: urls.get(row.storage_path) ?? null,
        })),
      };
    }),
  );

/** A fresh URL that downloads instead of opening in the tab. */
export const signPlanAttachmentDownload = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ attachmentId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("attachments.sign", async () => {
      const { supabase } = context;
      const { data: row } = await supabase
        .from("plan_task_attachments")
        .select("storage_path, file_name")
        .eq("id", data.attachmentId)
        .maybeSingle();
      const found = requireFound(row, "file");
      const { data: signed, error } = await storageAdmin()
        .storage.from(PLAN_ATTACHMENT_BUCKET)
        .createSignedUrl(found.storage_path, 60 * 5, { download: found.file_name });
      if (error) throw error;
      return { url: signed.signedUrl };
    }),
  );

/**
 * Called after the browser has put the bytes in the bucket. Validates again
 * (the client is not trusted), checks the path belongs to this user and task,
 * writes the row and records the event. If the row cannot be written the object
 * is removed so nothing is orphaned.
 */
export const registerPlanAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        taskId: z.string().uuid(),
        storagePath: z.string().min(1).max(500),
        fileName: z.string().min(1).max(255),
        mimeType: z.string().max(200).nullable().optional(),
        sizeBytes: z.number().int().positive(),
        sourceAttachmentId: z.string().uuid().nullable().optional(),
        width: z.number().int().positive().nullable().optional(),
        height: z.number().int().positive().nullable().optional(),
        shared: z.boolean().optional(),
        /** Skips the activity entry, for files that are part of a batch reported once. */
        quiet: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("attachments.register", async () => {
      const { supabase, userId } = context;

      const { data: taskRow } = await supabase
        .from("plan_tasks")
        .select("id, plan_id")
        .eq("id", data.taskId)
        .maybeSingle();
      const task = requireFound(taskRow, "task");

      const problem = validateFileMeta({
        name: data.fileName,
        size: data.sizeBytes,
        type: data.mimeType ?? "",
      });
      if (problem) {
        await purgePlanFiles([data.storagePath]);
        throw new AppError("upload_invalid", problem, { status: 400 });
      }
      if (
        !isPlanAttachmentPath(data.storagePath, {
          userId,
          planId: task.plan_id,
          taskId: task.id,
        })
      ) {
        throw new AppError("upload_invalid", "That file was uploaded to the wrong place.", {
          status: 400,
        });
      }

      // A marked-up copy of a file on a note stays on that note.
      let commentId: string | null = null;
      if (data.sourceAttachmentId) {
        const { data: source } = await supabase
          .from("plan_task_attachments")
          .select("comment_id")
          .eq("id", data.sourceAttachmentId)
          .eq("task_id", task.id)
          .maybeSingle();
        commentId = source?.comment_id ?? null;
      }

      const { data: row, error } = await supabase
        .from("plan_task_attachments")
        .insert({
          task_id: task.id,
          comment_id: commentId,
          uploader_id: userId,
          storage_path: data.storagePath,
          file_name: data.fileName,
          mime_type: data.mimeType ?? null,
          size_bytes: data.sizeBytes,
          source_attachment_id: data.sourceAttachmentId ?? null,
          width: data.width ?? null,
          height: data.height ?? null,
          shared_with_agents: data.shared ?? true,
        })
        .select("id")
        .single();
      if (error) {
        await purgePlanFiles([data.storagePath]);
        throw error;
      }

      if (!data.quiet) {
        await logPlanEvent(supabase, userId, {
          planId: task.plan_id,
          taskId: task.id,
          kind: "attachment_added",
          newValue: data.fileName,
        });
      }
      return { id: row.id };
    }),
  );

export const deletePlanAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ attachmentId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("attachments.delete", async () => {
      const { supabase, userId } = context;
      const { data: row } = await supabase
        .from("plan_task_attachments")
        .select("id, task_id, plan_id, storage_path, file_name")
        .eq("id", data.attachmentId)
        .maybeSingle();
      const found = requireFound(row, "file");

      // RLS decides whether this person may delete it: uploader or admin.
      const { data: deleted, error } = await supabase
        .from("plan_task_attachments")
        .delete()
        .eq("id", found.id)
        .select("id");
      if (error) throw error;
      if (!deleted?.length) {
        throw new AppError(
          "forbidden",
          "Only the person who added a file or an admin can remove it.",
          {
            status: 403,
          },
        );
      }

      await purgePlanFiles([found.storage_path]);
      await logPlanEvent(supabase, userId, {
        planId: found.plan_id,
        taskId: found.task_id,
        kind: "attachment_removed",
        oldValue: found.file_name,
      });
      return { ok: true };
    }),
  );

export const setPlanAttachmentShared = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z.object({ attachmentId: z.string().uuid(), shared: z.boolean() }).parse(input),
  )
  .handler(({ data, context }) =>
    guard("attachments.share", async () => {
      const { supabase } = context;
      const { data: updated, error } = await supabase
        .from("plan_task_attachments")
        .update({ shared_with_agents: data.shared })
        .eq("id", data.attachmentId)
        .select("id");
      if (error) throw error;
      if (!updated?.length) {
        throw new AppError(
          "forbidden",
          "Only the person who added a file or an admin can change who sees it.",
          {
            status: 403,
          },
        );
      }
      return { ok: true };
    }),
  );
