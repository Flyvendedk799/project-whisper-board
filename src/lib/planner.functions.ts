import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guard, requireFound } from "@/lib/server-errors";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Constants, type Database } from "@/integrations/supabase/types";

const workspaceIdField = z.string().uuid().optional();
const planStatusEnum = z.enum(Constants.public.Enums.plan_status);
const planTaskStatusEnum = z.enum(Constants.public.Enums.plan_task_status);
const planTaskPriorityEnum = z.enum(Constants.public.Enums.plan_task_priority);
const planTaskComplexityEnum = z.enum(Constants.public.Enums.plan_task_complexity);

type PlanUpdate = Database["public"]["Tables"]["plans"]["Update"];
type PlanSectionUpdate = Database["public"]["Tables"]["plan_sections"]["Update"];
type PlanTaskUpdate = Database["public"]["Tables"]["plan_tasks"]["Update"];

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

      const { data: plan, error } = await supabase
        .from("plans")
        .insert({
          workspace_id: membership.workspace_id,
          title: data.title,
          description: data.description ?? null,
          project_id: data.projectId ?? null,
          github_repo: data.githubRepo ?? null,
          github_base: data.githubBase ?? null,
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
        githubRepo: z.string().optional(),
        githubBase: z.string().optional(),
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
          project:projects(id, title),
          sections:plan_sections(
            *,
            tasks:plan_tasks(
              *,
              assigned_agent:plan_agents(id, name, provider, model),
              assigned_user:profiles(id, full_name, email, avatar_url),
              ticket:tickets(id, ticket_number, title)
            )
          )
        `,
        )
        .eq("id", data.planId)
        .order("position", { referencedTable: "plan_sections", ascending: true })
        .order("position", { referencedTable: "plan_sections.plan_tasks", ascending: true })
        .single();
      if (error) throw error;
      return { plan: requireFound(plan, "plan") };
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

      const { data: section, error } = await supabase
        .from("plan_sections")
        .insert({
          plan_id: data.planId,
          title: data.title,
          description: data.description ?? null,
          color: data.color ?? null,
          position,
        })
        .select("id")
        .single();
      if (error) throw error;

      await supabase.from("plan_events").insert({
        plan_id: data.planId,
        actor_id: userId,
        kind: "section_created",
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

      await supabase
        .from("plan_events")
        .insert({ plan_id: section.plan_id, actor_id: userId, kind: "section_updated" });

      return { ok: true };
    }),
  );

export const deleteSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ sectionId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("sections.delete", async () => {
      const { supabase } = context;
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
        complexity: planTaskComplexityEnum.optional(),
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
        .select("plan_id, status")
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

      await supabase
        .from("plan_events")
        .insert({ plan_id: before.plan_id, actor_id: userId, kind: "task_updated" });

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
      const { supabase } = context;
      const { error } = await supabase.from("plan_tasks").delete().eq("id", data.taskId);
      if (error) throw error;
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
        body: z.string().min(1).max(10000),
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
          body: data.body,
        })
        .select("id")
        .single();
      if (error) throw error;

      await supabase
        .from("plan_events")
        .insert({ plan_id: task.plan_id, actor_id: userId, kind: "comment_added" });

      return { id: comment.id };
    }),
  );

export const listTaskComments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ taskId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("comments.list", async () => {
      const { supabase } = context;

      const { data: comments, error } = await supabase
        .from("plan_task_comments")
        .select(
          "*, author:profiles(id, full_name, email, avatar_url), agent:plan_agents(id, name, provider, model)",
        )
        .eq("task_id", data.taskId)
        .order("created_at", { ascending: true });
      if (error) throw error;

      return { comments };
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
          scopes: data.scopes ?? ["planner"],
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
        .select("id, name, key_prefix, last_used_at, created_at, revoked_at")
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

export const suggestTasksFromTickets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) =>
    z
      .object({
        projectId: z.string().uuid().optional(),
        limit: z.number().int().optional().default(5),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("planner.suggestTasksFromTickets", async () => {
      const { supabase } = context;

      // Get open tickets for the project (or all projects if none specified)
      let ticketsQuery = supabase
        .from("tickets")
        .select("id, title, description, type, priority")
        .eq("status", "open");

      if (data.projectId) {
        ticketsQuery = ticketsQuery.eq("project_id", data.projectId);
      }

      const { data: tickets, error: ticketsError } = await ticketsQuery;
      if (ticketsError) throw ticketsError;

      // For each ticket, generate a suggested task
      const suggestedTasks = tickets.map((ticket) => {
        // Simple heuristic: convert ticket to task suggestion
        // In a real implementation, this would use an AI model
        const title = "[AI Suggested] " + ticket.title;
        let description = "Based on ticket #" + ticket.id + ": " + (ticket.description || "");

        // Add AI-generated analysis
        description +=
          "\n\nAI Analysis: This ticket appears to be a " +
          ticket.type +
          " with " +
          ticket.priority +
          " priority.";
        description +=
          "\nSuggested approach: Create a task to address this ticket and link it for traceability.";

        return {
          title,
          description,
          priority: ticket.priority === "urgent" ? "high" : ticket.priority,
          complexity: "medium", // Default complexity
          labels: ["ai-suggested", ticket.type],
          // No dependencies by default
          dependsOn: [],
        };
      });

      // Limit the number of suggestions
      const limitedSuggestions = suggestedTasks.slice(0, data.limit);

      return {
        suggestedTasks: limitedSuggestions,
        count: limitedSuggestions.length,
        basedOnTicketsCount: tickets.length,
      };
    }),
  );
