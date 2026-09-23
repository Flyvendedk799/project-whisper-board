import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import { Constants } from "@/integrations/supabase/types";
import { verifyApiKey } from "@/lib/api-auth";
import { allowsAccount } from "@/lib/api-scopes";
import { matchAccountRoute } from "@/lib/account-route";
import { parseRepoSlug } from "@/lib/github-url";
import {
  taskDescriptionFromTicket,
  taskTitleFromTicket,
  ticketPriorityToTask,
} from "@/lib/ticket-task";

type Admin = SupabaseClient<Database>;

const ticketCreate = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  description: z.string().max(20_000).optional(),
  type: z.enum(Constants.public.Enums.ticket_type).optional(),
  priority: z.enum(Constants.public.Enums.ticket_priority).optional(),
});

const ticketPatch = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(20_000).nullable().optional(),
    status: z.enum(Constants.public.Enums.ticket_status).optional(),
    priority: z.enum(Constants.public.Enums.ticket_priority).optional(),
    type: z.enum(Constants.public.Enums.ticket_type).optional(),
    assignee_id: z.string().uuid().nullable().optional(),
  })
  .strict();

const projectPatch = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(20_000).nullable().optional(),
    status: z.enum(Constants.public.Enums.project_status).optional(),
    github_repo: z.string().max(200).nullable().optional(),
    github_default_branch: z.string().max(200).nullable().optional(),
  })
  .strict();

const taskCreate = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(20_000).optional(),
  section_id: z.string().uuid().optional(),
  ticket_id: z.string().uuid().optional(),
  priority: z.enum(Constants.public.Enums.plan_task_priority).optional(),
});

const ticketTaskCreate = z.object({
  plan_id: z.string().uuid(),
  section_id: z.string().uuid().optional(),
});

const TICKET_COLUMNS =
  "id, ticket_number, title, description, status, priority, type, project_id, assignee_id, labels, due_date, eta_date, created_at, updated_at";

export async function requireAccountAccess(
  request: Request,
): Promise<{ workspaceId: string } | Response> {
  const auth = await verifyApiKey(request.headers.get("authorization"));
  if (!auth) return json({ error: "Unauthorized" }, 401);
  if (!allowsAccount(auth.scopes)) {
    return json(
      {
        error: "Forbidden: requires account scope. Grant it from the planner API key manager.",
      },
      403,
    );
  }
  return { workspaceId: auth.workspaceId };
}

export function getAccountAdmin(): Admin {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Request failed";
  const status = message.startsWith("Not found") ? 404 : 400;
  return json({ error: message }, status);
}

async function readJson(request: Request): Promise<unknown> {
  return request.json().catch(() => ({}));
}

async function sectionFor(
  admin: Admin,
  planId: string,
  sectionId: string | undefined,
): Promise<string> {
  if (sectionId) {
    const { data, error } = await admin
      .from("plan_sections")
      .select("id")
      .eq("id", sectionId)
      .eq("plan_id", planId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Not found: section");
    return data.id;
  }

  const { data: existing, error } = await admin
    .from("plan_sections")
    .select("id")
    .eq("plan_id", planId)
    .order("position", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing.id;

  const { data: created, error: createError } = await admin
    .from("plan_sections")
    .insert({ plan_id: planId, title: "From tickets", position: 1 })
    .select("id")
    .single();
  if (createError) throw createError;
  return created.id;
}

async function nextPosition(admin: Admin, sectionId: string): Promise<number> {
  const { data } = await admin
    .from("plan_tasks")
    .select("position")
    .eq("section_id", sectionId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? (data.position || 0) + 1 : 1;
}

export async function handleAccountRequest(
  request: Request,
  workspaceId: string,
  path: string,
): Promise<Response> {
  const admin = getAccountAdmin();
  const match = matchAccountRoute(path);
  if (!match) return json({ error: "Not found" }, 404);

  try {
    if (match.name === "index" && request.method === "GET") {
      return json({
        workspace_id: workspaceId,
        resources: [
          "GET /api/v1/workspace",
          "GET /api/v1/projects",
          "GET|PATCH /api/v1/projects/:id",
          "GET|POST /api/v1/tickets",
          "GET|PATCH /api/v1/tickets/:id",
          "POST /api/v1/tickets/:id/tasks",
          "GET /api/v1/plans",
          "GET /api/v1/plans/:id",
          "POST /api/v1/plans/:id/tasks",
        ],
      });
    }

    if (match.name === "workspace" && request.method === "GET") {
      const { data, error } = await admin
        .from("workspaces")
        .select("id, name, slug, created_at")
        .eq("id", workspaceId)
        .single();
      if (error) throw error;
      return json(data);
    }

    if (match.name === "projects" && request.method === "GET") {
      const { data, error } = await admin
        .from("projects")
        .select(
          "id, title, description, status, progress, github_repo, github_default_branch, created_at, updated_at",
        )
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return json(data ?? []);
    }

    if (match.name === "project" && request.method === "GET") {
      const { data, error } = await admin
        .from("projects")
        .select(
          "id, title, description, status, progress, github_repo, github_default_branch, organization_id, created_at, updated_at",
        )
        .eq("workspace_id", workspaceId)
        .eq("id", match.id)
        .single();
      if (error) throw new Error("Not found: project");
      return json(data);
    }

    if (match.name === "project" && request.method === "PATCH") {
      const patch = projectPatch.parse(await readJson(request));
      if (patch.github_repo) {
        if (!parseRepoSlug(patch.github_repo)) {
          throw new Error("github_repo must look like owner/name");
        }
      }
      const { data, error } = await admin
        .from("projects")
        .update(patch)
        .eq("workspace_id", workspaceId)
        .eq("id", match.id)
        .select(
          "id, title, description, status, progress, github_repo, github_default_branch, updated_at",
        )
        .single();
      if (error) throw new Error("Not found: project");
      return json(data);
    }

    if (match.name === "tickets" && request.method === "GET") {
      const url = new URL(request.url);
      let query = admin
        .from("tickets")
        .select(TICKET_COLUMNS)
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .limit(100);
      const projectId = url.searchParams.get("project_id");
      const status = url.searchParams.get("status");
      if (projectId) query = query.eq("project_id", z.string().uuid().parse(projectId));
      if (status)
        query = query.eq("status", z.enum(Constants.public.Enums.ticket_status).parse(status));
      const { data, error } = await query;
      if (error) throw error;
      return json(data ?? []);
    }

    if (match.name === "tickets" && request.method === "POST") {
      const body = ticketCreate.parse(await readJson(request));
      const { data: project, error: projectError } = await admin
        .from("projects")
        .select("id")
        .eq("id", body.project_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (projectError || !project) throw new Error("Not found: project");

      const { data, error } = await admin
        .from("tickets")
        .insert({
          project_id: body.project_id,
          title: body.title,
          description: body.description ?? null,
          type: body.type ?? "bug",
          priority: body.priority ?? "medium",
        })
        .select(TICKET_COLUMNS)
        .single();
      if (error) throw error;
      return json(data, 201);
    }

    if (match.name === "ticket" && request.method === "GET") {
      const { data, error } = await admin
        .from("tickets")
        .select(TICKET_COLUMNS)
        .eq("workspace_id", workspaceId)
        .eq("id", match.id)
        .single();
      if (error) throw new Error("Not found: ticket");
      return json(data);
    }

    if (match.name === "ticket" && request.method === "PATCH") {
      const patch = ticketPatch.parse(await readJson(request));
      const { data, error } = await admin
        .from("tickets")
        .update(patch)
        .eq("workspace_id", workspaceId)
        .eq("id", match.id)
        .select(TICKET_COLUMNS)
        .single();
      if (error) throw new Error("Not found: ticket");
      return json(data);
    }

    if (match.name === "plans" && request.method === "GET") {
      const { data, error } = await admin
        .from("plans")
        .select(
          "id, title, description, status, project_id, github_repo, github_base, created_at, updated_at",
        )
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return json(data ?? []);
    }

    if (match.name === "plan" && request.method === "GET") {
      const { data, error } = await admin
        .from("plans")
        .select("*, plan_sections(*, plan_tasks(*))")
        .eq("workspace_id", workspaceId)
        .eq("id", match.id)
        .single();
      if (error) throw new Error("Not found: plan");
      return json(data);
    }

    if (match.name === "planTasks" && request.method === "POST") {
      const body = taskCreate.parse(await readJson(request));
      const { data: plan, error: planError } = await admin
        .from("plans")
        .select("id")
        .eq("id", match.id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (planError || !plan) throw new Error("Not found: plan");
      const task = await insertLinkedTask(admin, {
        planId: match.id,
        sectionId: body.section_id,
        title: body.title,
        description: body.description ?? null,
        priority: body.priority,
        ticketId: body.ticket_id,
        workspaceId,
      });
      return json(task, 201);
    }

    if (match.name === "ticketTasks" && request.method === "POST") {
      const body = ticketTaskCreate.parse(await readJson(request));
      const { data: ticket, error: ticketError } = await admin
        .from("tickets")
        .select("id, ticket_number, title, description, type, priority, project_id")
        .eq("id", match.id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (ticketError || !ticket) throw new Error("Not found: ticket");

      const { data: plan, error: planError } = await admin
        .from("plans")
        .select("id, project_id")
        .eq("id", body.plan_id)
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (planError || !plan) throw new Error("Not found: plan");
      if (plan.project_id && plan.project_id !== ticket.project_id) {
        throw new Error("That plan belongs to a different project");
      }

      const { data: existing } = await admin
        .from("plan_tasks")
        .select("id, title, status, plan_id, ticket_id")
        .eq("plan_id", plan.id)
        .eq("ticket_id", ticket.id)
        .maybeSingle();
      if (existing) return json({ ...existing, created: false });

      const task = await insertLinkedTask(admin, {
        planId: plan.id,
        sectionId: body.section_id,
        title: taskTitleFromTicket(ticket.title),
        description: taskDescriptionFromTicket(ticket),
        priority: ticketPriorityToTask(ticket.priority),
        ticketId: ticket.id,
        workspaceId,
        labels: [ticket.type],
      });
      return json({ ...task, created: true }, 201);
    }

    return json({ error: "Method not allowed" }, 405);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json({ error: "Invalid request", issues: error.issues }, 400);
    }
    return fail(error);
  }
}

async function insertLinkedTask(
  admin: Admin,
  input: {
    planId: string;
    sectionId?: string;
    title: string;
    description: string | null;
    priority?: Database["public"]["Enums"]["plan_task_priority"];
    ticketId?: string;
    workspaceId: string;
    labels?: string[];
  },
) {
  if (input.ticketId) {
    const { data: ticket } = await admin
      .from("tickets")
      .select("id")
      .eq("id", input.ticketId)
      .eq("workspace_id", input.workspaceId)
      .maybeSingle();
    if (!ticket) throw new Error("Not found: ticket");
  }

  const sectionId = await sectionFor(admin, input.planId, input.sectionId);
  const position = await nextPosition(admin, sectionId);
  const { data, error } = await admin
    .from("plan_tasks")
    .insert({
      plan_id: input.planId,
      section_id: sectionId,
      title: input.title,
      description: input.description,
      position,
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.ticketId ? { ticket_id: input.ticketId } : {}),
      ...(input.labels ? { labels: input.labels } : {}),
    })
    .select("id, title, status, plan_id, section_id, ticket_id, priority")
    .single();
  if (error) throw error;
  return data;
}
