import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { guard, requireFound } from "@/lib/server-errors";

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
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("plans.create", async () => {
      const { supabase, userId } = context;

      const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId)
        .limit(1)
        .single();
      requireFound(membership, "workspace_membership");

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
        status: z.string().optional(),
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

      const patch: Record<string, unknown> = {
        ...(fields.title !== undefined && { title: fields.title }),
        ...(fields.description !== undefined && { description: fields.description }),
        ...(fields.status !== undefined && { status: fields.status }),
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
    z.object({ projectId: z.string().optional() }).optional().parse(input)
  )
  .handler(({ data, context }) =>
    guard("plans.list", async () => {
      const { supabase, userId } = context;

      const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId)
        .limit(1)
        .single();
      requireFound(membership, "workspace_membership");

      let query = supabase
        .from("plans")
        .select("*")
        .eq("workspace_id", membership.workspace_id)
        .order("updated_at", { ascending: false });

      if (data?.projectId) {
        query = query.eq("project_id", data.projectId);
      }

      const { data: plans, error } = await query;
      if (error) throw error;

      return { plans };
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
      requireFound(plan, "plan");

      return { plan };
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

      const { data: section } = await supabase
        .from("plan_sections")
        .select("plan_id")
        .eq("id", sectionId)
        .single();
      requireFound(section, "section");

      const patch: Record<string, unknown> = {
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
        priority: z.string().optional(),
        complexity: z.string().optional(),
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
          priority: data.priority ?? null,
          complexity: data.complexity ?? null,
          labels: data.labels ?? null,
          depends_on: data.dependsOn ?? null,
          preferred_providers: data.preferredProviders ?? null,
          preferred_models: data.preferredModels ?? null,
          context_files: data.contextFiles ?? null,
          acceptance_criteria: data.acceptanceCriteria ?? null,
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
        status: z.string().optional(),
        priority: z.string().optional(),
        complexity: z.string().optional(),
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

      const { data: before } = await supabase
        .from("plan_tasks")
        .select("plan_id, status")
        .eq("id", taskId)
        .single();
      requireFound(before, "task");

      const patch: Record<string, unknown> = {};
      if (fields.title !== undefined) patch.title = fields.title;
      if (fields.description !== undefined) patch.description = fields.description;
      if (fields.status !== undefined) patch.status = fields.status;
      if (fields.priority !== undefined) patch.priority = fields.priority;
      if (fields.complexity !== undefined) patch.complexity = fields.complexity;
      if (fields.labels !== undefined) patch.labels = fields.labels;
      if (fields.dependsOn !== undefined) patch.depends_on = fields.dependsOn;
      if (fields.preferredProviders !== undefined) patch.preferred_providers = fields.preferredProviders;
      if (fields.preferredModels !== undefined) patch.preferred_models = fields.preferredModels;
      if (fields.contextFiles !== undefined) patch.context_files = fields.contextFiles;
      if (fields.acceptanceCriteria !== undefined) patch.acceptance_criteria = fields.acceptanceCriteria ? fields.acceptanceCriteria.join("\n") : null;
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
        status: z.string().optional(),
        priority: z.string().optional(),
        complexity: z.string().optional(),
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("tasks.bulkUpdate", async () => {
      const { supabase } = context;

      const patch: Record<string, unknown> = {
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
  .handler(({ context }) =>
    guard("agents.list", async () => {
      const { supabase, userId } = context;

      const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId)
        .limit(1)
        .single();
      requireFound(membership, "workspace_membership");

      const { data: agents, error } = await supabase
        .from("plan_agents")
        .select("*")
        .eq("workspace_id", membership.workspace_id)
        .order("last_active_at", { ascending: false, nullsFirst: false });
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
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("agents.register", async () => {
      const { supabase, userId } = context;

      const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId)
        .limit(1)
        .single();
      requireFound(membership, "workspace_membership");

      const { data: agent, error } = await supabase
        .from("plan_agents")
        .insert({
          workspace_id: membership.workspace_id,
          name: data.name,
          provider: data.provider,
          model: data.model ?? null,
          capabilities: data.capabilities ?? null,
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
          `
          *,
          actor:profiles(id, display_name, avatar_url),
          agent:plan_agents(id, name, provider, model)
        `,
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

      const { data: task } = await supabase
        .from("plan_tasks")
        .select("plan_id")
        .eq("id", data.taskId)
        .single();
      requireFound(task, "task");

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
          `
          *,
          author:profiles(id, display_name, avatar_url),
          agent:plan_agents(id, name, provider, model)
        `,
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
      })
      .parse(input),
  )
  .handler(({ data, context }) =>
    guard("apiKeys.create", async () => {
      const { supabase, userId } = context;
      const crypto = await import("node:crypto");

      const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId)
        .limit(1)
        .single();
      requireFound(membership, "workspace_membership");

      const rawKey = `cpk_${crypto.randomBytes(16).toString("hex")}`;
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
  .handler(({ context }) =>
    guard("apiKeys.list", async () => {
      const { supabase, userId } = context;

      const { data: membership } = await supabase
        .from("workspace_members")
        .select("workspace_id")
        .eq("user_id", userId)
        .limit(1)
        .single();
      requireFound(membership, "workspace_membership");

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
