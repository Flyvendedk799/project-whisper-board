import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Octokit } from "octokit";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getAiProviderFor } from "@/lib/providers/server";
import { AppError } from "@/lib/errors";
import { guard, requireFound } from "@/lib/server-errors";
import { parseRepoSlug } from "@/lib/github-url";
import { NOT_CONNECTED_MESSAGE } from "@/lib/github-port";
import { OPEN_TICKET_STATUSES } from "@/lib/ticket-task";
import { describeAction, parseAssistantReply } from "@/lib/assistant-actions";
import {
  AUDIT_CONTEXT_CHARS,
  buildPlatformContext,
  DEFAULT_CONTEXT_CHARS,
  type CtxPlan,
  type CtxTaskDetail,
  type PlatformData,
} from "@/lib/assistant-context";
import {
  buildAssessPrompt,
  buildAssistantSystemPrompt,
  buildAuditSystemPrompt,
  normalizeAssessment,
  parseAuditReply,
  PRESET_IDS,
  toProviderMessages,
  type AuditResult,
} from "@/lib/assistant-prompts";
import {
  buildContextMessages,
  buildPickFilesMessages,
  capContext,
  filterRepoPaths,
  fitFiles,
  MAX_PICKED_FILES,
  parsePickedFiles,
  rankPaths,
  treeListing,
  type FetchedFile,
  type TreeEntry,
} from "@/lib/repo-context";
import { planRepo } from "@/lib/auto-enrich";
import type { Database, Json } from "@/integrations/supabase/types";

/**
 * The AI that works on plans: the assistant chat, the plan audit, technical
 * context drawn from the plan's repository, the quick assessment the automatic
 * mode runs, and the person's switch for that mode.
 *
 * Nothing here writes plan content on its own authority. The chat and the audit
 * only PROPOSE actions; the browser applies them through the ordinary server
 * functions, as the signed-in person under RLS. What is written here is the
 * AI's own notes on a task (`ai_context`, `ai_assessment`), in fields separate
 * from anything a person wrote. Every call uses the signed-in person's own AI
 * (their connected subscription, else the deployment's key) and GitHub token.
 */

type Db = SupabaseClient<Database>;

async function aiFor(userId: string) {
  const ai = await getAiProviderFor(userId);
  if (!ai.enabled) {
    throw new AppError("ai_disabled", "AI features aren't configured on this workspace.", {
      status: 501,
    });
  }
  return ai;
}

// ---------------------------------------------------------------------------
// Loading what the assistant is shown
// ---------------------------------------------------------------------------

const MAX_PLAN_TASKS = 400;

const byPosition = (a: { position?: number | null }, b: { position?: number | null }) =>
  (a.position ?? 0) - (b.position ?? 0);

async function loadPlan(supabase: Db, planId: string) {
  const { data, error } = await supabase
    .from("plans")
    .select(
      `
      id, title, status, description, workspace_id, github_repo, github_base,
      project:projects(id, title, github_repo, github_default_branch),
      sections:plan_sections(
        id, title, description, goals, intentions, client_summary, tags, position,
        tasks:plan_tasks(
          id, section_id, title, status, priority, complexity, labels, description,
          acceptance_criteria, position, ai_context, depends_on,
          features:plan_task_features(id, met),
          steps:plan_task_steps(id, done),
          questions:plan_task_questions(id, status, blocking)
        )
      )
    `,
    )
    .eq("id", planId)
    .maybeSingle();
  if (error) throw error;
  const plan = requireFound(data, "plan");

  const sections = [...(plan.sections ?? [])].sort(byPosition);
  const tasks = sections
    .flatMap((section) => [...(section.tasks ?? [])].sort(byPosition))
    .slice(0, MAX_PLAN_TASKS);

  const ctx: CtxPlan = {
    id: plan.id,
    title: plan.title,
    status: plan.status,
    description: plan.description,
    repo: planRepo({ github_repo: plan.github_repo, project: plan.project }),
    base: plan.github_base ?? plan.project?.github_default_branch ?? null,
    sections: sections.map((section) => ({
      id: section.id,
      title: section.title,
      description: section.description,
      goals: section.goals,
      intentions: section.intentions,
      client_summary: section.client_summary,
      tags: section.tags ?? [],
    })),
    tasks: tasks.map((task) => {
      const open = (task.questions ?? []).filter((question) => question.status === "open");
      return {
        id: task.id,
        sectionId: task.section_id,
        title: task.title,
        status: task.status,
        priority: task.priority,
        complexity: task.complexity,
        labels: task.labels ?? [],
        description: task.description,
        hasAcceptance: Boolean(task.acceptance_criteria?.trim()),
        features: {
          total: (task.features ?? []).length,
          met: (task.features ?? []).filter((feature) => feature.met).length,
        },
        steps: {
          total: (task.steps ?? []).length,
          done: (task.steps ?? []).filter((step) => step.done).length,
        },
        openQuestions: open.length,
        blockingQuestions: open.filter((question) => question.blocking).length,
        hasAiContext: Boolean(task.ai_context?.trim()),
        dependsOn: (task.depends_on ?? []).length,
      };
    }),
  };
  return { ctx, workspaceId: plan.workspace_id };
}

async function loadTaskDetail(supabase: Db, taskId: string): Promise<CtxTaskDetail> {
  const { data, error } = await supabase
    .from("plan_tasks")
    .select(
      `
      id, description, acceptance_criteria, ai_context,
      features:plan_task_features(id, text, met, position),
      steps:plan_task_steps(id, text, done, depth, feature_id, position),
      questions:plan_task_questions(id, body, blocking, status, answer, created_at)
    `,
    )
    .eq("id", taskId)
    .maybeSingle();
  if (error) throw error;
  const task = requireFound(data, "task");

  const { data: comments } = await supabase
    .from("plan_task_comments")
    .select("body, created_at, author:profiles(full_name)")
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    .limit(6);

  return {
    id: task.id,
    description: task.description,
    acceptance: task.acceptance_criteria,
    aiContext: task.ai_context,
    features: [...(task.features ?? [])]
      .sort(byPosition)
      .map((feature) => ({ id: feature.id, text: feature.text, met: feature.met })),
    steps: [...(task.steps ?? [])].sort(byPosition).map((step) => ({
      id: step.id,
      text: step.text,
      done: step.done,
      depth: step.depth,
      featureId: step.feature_id,
    })),
    questions: [...(task.questions ?? [])]
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((question) => ({
        id: question.id,
        body: question.body,
        blocking: question.blocking,
        status: question.status,
        answer: question.answer,
      })),
    comments: (comments ?? [])
      .map((comment) => ({
        author: (comment.author as { full_name: string | null } | null)?.full_name ?? null,
        body: comment.body ?? "",
      }))
      .filter((comment) => comment.body.trim())
      .reverse(),
  };
}

async function loadWorkspace(
  supabase: Db,
  userId: string,
  workspaceId: string | null,
  projectId: string | undefined,
) {
  let workspace = workspaceId;
  if (!workspace) {
    const { data: membership } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();
    workspace = membership?.workspace_id ?? null;
  }
  if (!workspace) return { plans: [], tickets: [] };

  let plansQuery = supabase
    .from("plans")
    .select("id, title, status, project:projects(title), plan_tasks(status)")
    .eq("workspace_id", workspace)
    .order("updated_at", { ascending: false })
    .limit(30);
  if (projectId) plansQuery = plansQuery.eq("project_id", projectId);

  let ticketsQuery = supabase
    .from("tickets")
    .select("ticket_number, title, priority, status")
    .eq("workspace_id", workspace)
    .in("status", [...OPEN_TICKET_STATUSES])
    .order("updated_at", { ascending: false })
    .limit(10);
  if (projectId) ticketsQuery = ticketsQuery.eq("project_id", projectId);

  const [plans, tickets] = await Promise.all([plansQuery, ticketsQuery]);
  return {
    plans: (plans.data ?? []).map((plan) => ({
      title: plan.title,
      status: plan.status,
      projectTitle: plan.project?.title ?? null,
      tasks: (plan.plan_tasks ?? []).length,
      done: (plan.plan_tasks ?? []).filter((task) => task.status === "done").length,
    })),
    tickets: (tickets.data ?? []).map((ticket) => ({
      number: ticket.ticket_number,
      title: ticket.title,
      priority: ticket.priority,
      status: ticket.status,
    })),
  };
}

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// The assistant
// ---------------------------------------------------------------------------

const chatInput = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().max(8000),
      }),
    )
    .min(1)
    .max(40),
  context: z
    .object({
      planId: z.string().uuid().optional(),
      taskId: z.string().uuid().optional(),
      projectId: z.string().uuid().optional(),
      preset: z.enum(PRESET_IDS).optional(),
    })
    .optional(),
});

/**
 * One turn of the assistant. Builds the context from what the person can see,
 * asks the model for `{reply, actions[]}`, and returns the reply with the
 * actions that survived validation, each with a plain-language summary. Writes
 * nothing.
 */
export const assistantChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => chatInput.parse(input))
  .handler(({ data, context }) =>
    guard("assistant.chat", async () => {
      const { supabase, userId } = context;
      const last = data.messages[data.messages.length - 1];
      if (last.role !== "user" || !last.content.trim()) {
        throw new AppError("validation", "Write a message first.");
      }
      const ai = await aiFor(userId);
      const focus = data.context ?? {};

      // A task points at its plan; with neither, the assistant sees the workspace only.
      let planId = focus.planId;
      if (focus.taskId) {
        const { data: row } = await supabase
          .from("plan_tasks")
          .select("plan_id")
          .eq("id", focus.taskId)
          .maybeSingle();
        planId = requireFound(row, "task").plan_id;
      }

      const [loaded, profile] = await Promise.all([
        planId ? loadPlan(supabase, planId) : Promise.resolve(null),
        supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
      ]);
      const [workspace, task] = await Promise.all([
        loadWorkspace(supabase, userId, loaded?.workspaceId ?? null, focus.projectId),
        focus.taskId ? loadTaskDetail(supabase, focus.taskId) : Promise.resolve(null),
      ]);

      const platform: PlatformData = {
        today: today(),
        person: profile.data?.full_name ?? null,
        plans: workspace.plans,
        plan: loaded?.ctx ?? null,
        task,
        tickets: workspace.tickets,
      };
      const built = buildPlatformContext(platform, { maxChars: DEFAULT_CONTEXT_CHARS });

      const system = buildAssistantSystemPrompt({
        context: built.text,
        preset: focus.preset,
        truncated: built.truncated,
      });
      const raw = await ai.chat(toProviderMessages(system, data.messages), { json: true });

      const reply = parseAssistantReply(raw, built.refs);
      const names = built.refs.names();
      return {
        reply: reply.reply,
        proposals: reply.actions.map((action) => ({
          action,
          summary: describeAction(action, names),
        })),
        dropped: reply.dropped,
        truncated: built.truncated,
      };
    }),
  );

// ---------------------------------------------------------------------------
// The audit
// ---------------------------------------------------------------------------

export const auditPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ planId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("assistant.audit", async () => {
      const { supabase, userId } = context;
      const ai = await aiFor(userId);
      const loaded = await loadPlan(supabase, data.planId);
      if (loaded.ctx.tasks.length === 0 && loaded.ctx.sections.length === 0) {
        throw new AppError(
          "empty_plan",
          "There is nothing to audit yet: add some sections and tasks.",
        );
      }

      const built = buildPlatformContext(
        { today: today(), plans: [], plan: loaded.ctx, tickets: [] },
        { maxChars: AUDIT_CONTEXT_CHARS, audit: true },
      );
      const raw = await ai.chat(
        [
          { role: "system", content: buildAuditSystemPrompt(built.text, built.truncated) },
          { role: "user", content: "Audit this plan." },
        ],
        { json: true },
      );

      const audit: AuditResult | null = parseAuditReply(raw, built.refs);
      if (!audit) {
        throw new AppError("ai_parse", "The AI's answer wasn't readable. Try the audit again.", {
          status: 502,
          context: { raw: raw.slice(0, 500) },
        });
      }
      return { ...audit, truncated: built.truncated };
    }),
  );

// ---------------------------------------------------------------------------
// Context from the repository
// ---------------------------------------------------------------------------

/** What GitHub's refusal means for the person reading it. */
function githubProblem(error: unknown, repo: string): AppError | null {
  // Only what Octokit threw: an AI provider's own 401 is not a GitHub problem.
  if (!error || typeof error !== "object" || error instanceof AppError || !("request" in error)) {
    return null;
  }
  const status = (error as { status?: number }).status;
  if (status === 404) {
    return new AppError(
      "github_repo",
      `Couldn't find ${repo} (or its branch) with your GitHub token. Check the repository in the plan settings.`,
      { status: 404 },
    );
  }
  if (status === 401 || status === 403) {
    return new AppError(
      "github_denied",
      `GitHub refused access to ${repo}. Reconnect your GitHub token in Settings.`,
      { status: 403 },
    );
  }
  return null;
}

async function logAiNote(
  supabase: Db,
  userId: string,
  planId: string,
  taskId: string,
  note: string,
) {
  const { error } = await supabase.from("plan_events").insert({
    plan_id: planId,
    task_id: taskId,
    actor_id: userId,
    kind: "task_updated",
    new_value: note,
    metadata: { ai: true },
  });
  if (error) console.error("[assistant] plan event", error.message);
}

/**
 * Reads the part of the plan's repository that matters to one task and writes
 * technical context for it. Two model calls: which files to read (from a
 * filtered file list, held to paths it was offered), then the context itself.
 * The result lands in `ai_context`, a field of its own, so the brief is never
 * touched; the files read are added to `context_files` alongside any a person
 * listed.
 */
export const addTaskContext = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ taskId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("assistant.addContext", async () => {
      const { supabase, userId } = context;
      const ai = await aiFor(userId);

      const { data: row, error } = await supabase
        .from("plan_tasks")
        .select(
          `
          id, plan_id, title, description, acceptance_criteria, context_files,
          plan:plans(github_repo, github_base, project:projects(github_repo, github_default_branch))
        `,
        )
        .eq("id", data.taskId)
        .maybeSingle();
      if (error) throw error;
      const task = requireFound(row, "task");

      const repo = task.plan
        ? planRepo({ github_repo: task.plan.github_repo, project: task.plan.project })
        : null;
      if (!repo) {
        throw new AppError(
          "no_repo",
          "This plan has no GitHub repository. Connect one in the plan settings to add code context.",
        );
      }
      const slug = parseRepoSlug(repo);
      if (!slug) {
        throw new AppError("github_repo", `"${repo}" isn't a repository name. Use owner/name.`);
      }

      const { githubFor } = await import("@/lib/github-token");
      const access = await githubFor(userId);
      if (!access.token) {
        throw new AppError("github_not_configured", NOT_CONNECTED_MESSAGE, { status: 409 });
      }
      const octokit = new Octokit({ auth: access.token });

      const brief = {
        title: task.title,
        description: task.description,
        acceptance: task.acceptance_criteria,
      };
      const briefText = `${brief.title} ${brief.description ?? ""} ${brief.acceptance ?? ""}`;

      try {
        const base =
          task.plan?.github_base ??
          task.plan?.project?.github_default_branch ??
          (await octokit.rest.repos.get(slug)).data.default_branch;

        const tree = await octokit.rest.git.getTree({ ...slug, tree_sha: base, recursive: "true" });
        const paths = filterRepoPaths(
          tree.data.tree.flatMap((entry): TreeEntry[] =>
            entry.path ? [{ path: entry.path, type: entry.type, size: entry.size }] : [],
          ),
        );
        if (paths.length === 0) {
          throw new AppError("no_files", `Found no code or docs to read in ${repo}.`);
        }

        // The listing the model picks from: most relevant first, cut to a size.
        const ranked = rankPaths(paths, briefText);
        const listing = treeListing(ranked);
        const allowed = new Set(listing.shown);
        const pickedRaw = await ai.chat(
          buildPickFilesMessages(brief, {
            text: listing.text,
            total: listing.total,
            shown: listing.shown.length,
          }),
          { json: true },
        );
        // If the model picked nothing usable, the best-ranked paths are still a fair start.
        let picked = parsePickedFiles(pickedRaw, allowed, MAX_PICKED_FILES);
        if (picked.length === 0) picked = ranked.slice(0, 5);

        const fetched = await Promise.all(
          picked.map(async (path): Promise<FetchedFile | null> => {
            try {
              const { data: file } = await octokit.rest.repos.getContent({
                ...slug,
                path,
                ref: base,
              });
              if (
                Array.isArray(file) ||
                file.type !== "file" ||
                !("content" in file) ||
                !file.content
              ) {
                return null;
              }
              return { path, content: Buffer.from(file.content, "base64").toString("utf8") };
            } catch {
              return null;
            }
          }),
        );
        const files = fitFiles(fetched.filter((file): file is FetchedFile => file !== null));
        if (files.length === 0) {
          throw new AppError("no_files", `Couldn't read any of the files chosen from ${repo}.`);
        }

        const markdown = capContext(
          await ai.chat(buildContextMessages(brief, repo, files), { maxTokens: 2500 }),
        );
        if (!markdown)
          throw new AppError("ai_empty", "The AI returned nothing. Try again.", { status: 502 });

        const readPaths = files.map((file) => file.path);
        const merged = [...new Set([...(task.context_files ?? []), ...readPaths])].slice(0, 40);
        const at = new Date().toISOString();
        const { error: updateError } = await supabase
          .from("plan_tasks")
          .update({ ai_context: markdown, ai_context_at: at, context_files: merged })
          .eq("id", task.id);
        if (updateError) throw updateError;
        await logAiNote(supabase, userId, task.plan_id, task.id, "AI added technical context");

        return { context: markdown, files: readPaths, at, base };
      } catch (failure) {
        throw githubProblem(failure, repo) ?? failure;
      }
    }),
  );

// ---------------------------------------------------------------------------
// The quick assessment
// ---------------------------------------------------------------------------

/**
 * A fast look at one task: does it need code context, features, sub-steps or
 * questions? Stored on the task so the automatic mode never looks twice, and
 * so the plan can say what the AI thinks is missing. Changes nothing else.
 */
export const assessTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ taskId: z.string().uuid() }).parse(input))
  .handler(({ data, context }) =>
    guard("assistant.assessTask", async () => {
      const { supabase, userId } = context;
      const ai = await aiFor(userId);

      const { data: row, error } = await supabase
        .from("plan_tasks")
        .select(
          `
          id, title, description, acceptance_criteria, status, ai_context,
          plan:plans(github_repo, project:projects(github_repo)),
          features:plan_task_features(id),
          steps:plan_task_steps(id),
          questions:plan_task_questions(id, status)
        `,
        )
        .eq("id", data.taskId)
        .maybeSingle();
      if (error) throw error;
      const task = requireFound(row, "task");

      const facts = {
        hasRepo: Boolean(
          task.plan && planRepo({ github_repo: task.plan.github_repo, project: task.plan.project }),
        ),
        hasAiContext: Boolean(task.ai_context?.trim()),
        features: (task.features ?? []).length,
        steps: (task.steps ?? []).length,
        openQuestions: (task.questions ?? []).filter((question) => question.status === "open")
          .length,
      };
      const raw = await ai.chat(
        buildAssessPrompt(
          {
            title: task.title,
            description: task.description,
            acceptance: task.acceptance_criteria,
            status: task.status,
          },
          facts,
        ),
        { json: true },
      );
      const assessment = normalizeAssessment(raw, facts);
      if (!assessment) {
        throw new AppError("ai_parse", "The AI's answer wasn't readable. Try again.", {
          status: 502,
          context: { raw: raw.slice(0, 300) },
        });
      }

      const assessedAt = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("plan_tasks")
        .update({
          ai_assessment: { needs: assessment.needs, note: assessment.note } as Json,
          ai_assessed_at: assessedAt,
        })
        .eq("id", task.id);
      if (updateError) throw updateError;
      return { ...assessment, assessedAt };
    }),
  );

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/** The person's own AI switches. No row yet means everything is off. */
export const getAiSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(({ context }) =>
    guard("aiSettings.get", async () => {
      const { data, error } = await context.supabase
        .from("user_ai_settings")
        .select("auto_enrich")
        .eq("user_id", context.userId)
        .maybeSingle();
      if (error) throw error;
      return { autoEnrich: data?.auto_enrich ?? false };
    }),
  );

export const setAiSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ autoEnrich: z.boolean() }).parse(input))
  .handler(({ data, context }) =>
    guard("aiSettings.set", async () => {
      const { error } = await context.supabase.from("user_ai_settings").upsert(
        {
          user_id: context.userId,
          auto_enrich: data.autoEnrich,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
      if (error) throw error;
      return { autoEnrich: data.autoEnrich };
    }),
  );
