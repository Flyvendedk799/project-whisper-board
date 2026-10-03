import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";
import {
  FEATURE_TEXT_MAX,
  QUESTION_ANSWER_MAX,
  QUESTION_BODY_MAX,
  workBranchProblem,
} from "@/lib/plan-fields";
import {
  MAX_STEP_DEPTH,
  parsePlanMarkdown,
  planMarkdownCoverage,
  planMarkdownStats,
  STEP_TEXT_MAX,
  type PlanMdSettings,
} from "@/lib/plan-markdown";
import {
  appendSections,
  syncSections,
  type ExistingSection,
  type SyncStore,
} from "@/lib/plan-sync";
import { requireFound } from "@/lib/server-errors";
import { PLAN_ATTACHMENT_BUCKET } from "@/lib/upload";
import { SECTION_PALETTE } from "@/features/planner/plan-model";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

const OVERVIEW_TITLE = "Overview";

/** Longest list of lost lines an import reports back. The count is always exact. */
const MAX_REPORTED_LINES = 25;

/** Service-role client, for signing URLs and removing files. Never for reads of plan rows. */
function storageAdmin() {
  return createClient<Database>(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Removes files from storage after their rows are gone. Orphans are logged, not thrown. */
export async function purgePlanFiles(paths: string[]) {
  if (paths.length === 0) return;
  const { error } = await storageAdmin().storage.from(PLAN_ATTACHMENT_BUCKET).remove(paths);
  if (error) console.error("[planner] purge plan files", error.message);
}

/**
 * Storage paths of the files on these tasks or plans. For a plan, `tasksOnly`
 * leaves out the files on the plan itself, for when the tasks are going and the
 * plan is staying.
 */
export async function attachmentPathsWhere(
  supabase: Client,
  column: "task_id" | "plan_id",
  ids: string[],
  options: { tasksOnly?: boolean } = {},
): Promise<string[]> {
  if (ids.length === 0) return [];
  let query = supabase.from("plan_task_attachments").select("storage_path").in(column, ids);
  if (options.tasksOnly) query = query.not("task_id", "is", null);
  const { data } = await query;
  return (data ?? []).map((row) => row.storage_path);
}

export type PlanImportMode = "replace" | "merge" | "sync";

export type PlanImportResult = {
  mode: PlanImportMode;
  /** Created by this import. */
  sections: number;
  tasks: number;
  steps: number;
  /** Feature-list entries and questions created by this import. */
  features: number;
  questions: number;
  /** `sync` only: what already existed and was matched, and what was filled in. */
  sync?: {
    matchedSections: number;
    matchedTasks: number;
    updatedSections: number;
    updatedTasks: number;
  };
  /** Plan-level fields the document set (description, repository, base and working branch). */
  plan?: { updated: string[] };
  /** Source lines checked, and the ones that did not make it into the plan. */
  coverage: { lines: number; missing: number; missingLines: string[] };
};

/**
 * Turns markdown into sections, tasks, sub-steps, feature lists and questions
 * on an existing plan, then checks that every line of the source landed
 * somewhere. It reads outlines, headings and nested lists, and the board's own
 * export (see `plan-markdown-board`) field by field.
 *
 * Shared by the board's import dialog (a signed-in person) and the REST API
 * (an API key, no person), so both read a document the same way.
 */
export async function applyPlanMarkdown(
  supabase: Client,
  input: {
    planId: string;
    markdown: string;
    /**
     * `replace` deletes the plan's sections first; `merge` adds every section as new;
     * `sync` matches by id or title and only adds what is missing, keeping all progress.
     */
    mode: PlanImportMode;
    /** The signed-in user, or null when an API key did the import. */
    actorId: string | null;
  },
): Promise<PlanImportResult> {
  const { data: planRow } = await supabase
    .from("plans")
    .select("id, description, github_repo, github_base, github_work_mode, github_work_branch")
    .eq("id", input.planId)
    .maybeSingle();
  const plan = requireFound(planRow, "plan");

  const doc = parsePlanMarkdown(input.markdown);
  const stats = planMarkdownStats(doc);
  if (stats.sections === 0) {
    throw new AppError(
      "validation",
      "No sections found in that markdown. Use numbered outlines, headings, or nested lists.",
      { status: 400 },
    );
  }

  // What sat above the first section (a title's intro, a status table) is
  // kept as a section of its own, so it is on the board and not in the header.
  const sections = doc.preamble
    ? [{ title: OVERVIEW_TITLE, description: doc.preamble, tasks: [] }, ...doc.sections]
    : doc.sections;
  const limits = { maxStepDepth: MAX_STEP_DEPTH, maxStepText: STEP_TEXT_MAX };
  const store = supabaseSyncStore(supabase, plan.id, input.actorId);

  if (input.mode === "sync") {
    const outcome = await syncSections(store, sections, limits, {
      // The board's own export keeps notes apart from tasks, so nothing moved out of a note.
      refreshNotes: doc.format !== "board",
    });
    const updated = await applyPlanSettings(supabase, plan, doc.plan, input.mode);
    const { error: syncEventError } = await supabase.from("plan_events").insert({
      plan_id: plan.id,
      actor_id: input.actorId,
      kind: "section_created",
      new_value: `synced: ${outcome.createdSections} sections, ${outcome.createdTasks} tasks added; ${outcome.matchedTasks} tasks matched`,
      metadata: {},
    });
    if (syncEventError) console.error("[planner] plan event", syncEventError.message);
    return {
      mode: "sync",
      sections: outcome.createdSections,
      tasks: outcome.createdTasks,
      steps: outcome.createdSteps,
      features: outcome.createdFeatures,
      questions: outcome.createdQuestions,
      sync: {
        matchedSections: outcome.matchedSections,
        matchedTasks: outcome.matchedTasks,
        updatedSections: outcome.updatedSections,
        updatedTasks: outcome.updatedTasks,
      },
      ...(updated.length > 0 && { plan: { updated } }),
      coverage: coverageOf(input.markdown, doc),
    };
  }

  if (input.mode === "replace") {
    // Replacing the board replaces its sections and tasks; the plan's own files stay.
    const paths = await attachmentPathsWhere(supabase, "plan_id", [plan.id], { tasksOnly: true });
    const { error: deleteError } = await supabase
      .from("plan_sections")
      .delete()
      .eq("plan_id", plan.id);
    if (deleteError) throw deleteError;
    await purgePlanFiles(paths);
  }

  const { data: maxPosSection } = await supabase
    .from("plan_sections")
    .select("position")
    .eq("plan_id", plan.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const created = await appendSections(
    store,
    sections,
    limits,
    maxPosSection ? (maxPosSection.position || 0) + 1 : 1,
  );
  const updated = await applyPlanSettings(supabase, plan, doc.plan, input.mode);

  const { error: eventError } = await supabase.from("plan_events").insert({
    plan_id: plan.id,
    actor_id: input.actorId,
    kind: "section_created",
    new_value: `${created.createdSections} sections, ${created.createdTasks} tasks`,
    metadata: {},
  });
  if (eventError) console.error("[planner] plan event", eventError.message);

  return {
    mode: input.mode,
    sections: created.createdSections,
    tasks: created.createdTasks,
    steps: created.createdSteps,
    features: created.createdFeatures,
    questions: created.createdQuestions,
    ...(updated.length > 0 && { plan: { updated } }),
    coverage: coverageOf(input.markdown, doc),
  };
}

function coverageOf(markdown: string, doc: ReturnType<typeof parsePlanMarkdown>) {
  const coverage = planMarkdownCoverage(markdown, doc);
  return {
    lines: coverage.lines,
    missing: coverage.missing.length,
    missingLines: coverage.missing.slice(0, MAX_REPORTED_LINES),
  };
}

type PlanSettingsRow = {
  description: string | null;
  github_repo: string | null;
  github_base: string | null;
  github_work_mode: string | null;
  github_work_branch: string | null;
};

const sameRepo = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * What a board-format header may change on the plan itself.
 *  - the description: set when the plan has none, and by `replace`;
 *  - the repository and base branch: only when the plan has no repository;
 *  - the working branch: by `replace`, or when the plan has none, and only
 *    when the document is about the same repository the plan uses.
 * Merge and sync never change a repository, base or branch that is already set.
 * Returns the names of the fields written. A failure is logged, not thrown: the
 * sections are already in.
 */
export async function applyPlanSettings(
  supabase: Client,
  plan: { id: string } & PlanSettingsRow,
  settings: PlanMdSettings | undefined,
  mode: PlanImportMode,
): Promise<string[]> {
  if (!settings) return [];
  const patch: Database["public"]["Tables"]["plans"]["Update"] = {};
  const updated: string[] = [];
  const set = (name: string, values: typeof patch) => {
    Object.assign(patch, values);
    updated.push(name);
  };

  if (settings.description && (mode === "replace" || !plan.description?.trim())) {
    if (settings.description !== plan.description) {
      set("description", { description: settings.description });
    }
  }

  const planRepo = plan.github_repo?.trim() || null;
  const repo = planRepo ?? settings.repo ?? null;
  if (!planRepo && settings.repo) set("repo", { github_repo: settings.repo });
  const planBase = plan.github_base?.trim() || null;
  const sameProject = !settings.repo || !planRepo || sameRepo(settings.repo, planRepo);
  if (!planBase && settings.base && sameProject) set("base", { github_base: settings.base });
  const base = planBase ?? (sameProject ? (settings.base ?? null) : null);

  if (repo && sameProject && settings.workMode && (mode === "replace" || !plan.github_work_mode)) {
    const branch = settings.workMode === "base" ? null : (settings.workBranch ?? null);
    if (!workBranchProblem(settings.workMode, branch, base)) {
      set("workBranch", { github_work_mode: settings.workMode, github_work_branch: branch });
    }
  }

  if (updated.length === 0) return [];
  const { error } = await supabase.from("plans").update(patch).eq("id", plan.id);
  if (error) {
    console.error("[planner] import plan settings", error.message);
    return [];
  }
  return updated;
}

/** The import's view of a plan in the database. */
function supabaseSyncStore(supabase: Client, planId: string, actorId: string | null): SyncStore {
  return {
    async load() {
      const { data, error } = await supabase
        .from("plan_sections")
        .select(
          "id, title, description, goals, intentions, tags, position, tasks:plan_tasks(id, title, description, acceptance_criteria, labels, color, ai_context, position, steps:plan_task_steps(id, text, position, feature_id), features:plan_task_features(id, text, position), questions:plan_task_questions(id, body))",
        )
        .eq("plan_id", planId)
        .order("position", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ExistingSection[];
    },
    async createSection({ title, description, position, color, ...extras }) {
      const { data, error } = await supabase
        .from("plan_sections")
        .insert({
          plan_id: planId,
          title,
          description,
          color: color ?? SECTION_PALETTE[(position - 1) % SECTION_PALETTE.length],
          position,
          ...extras,
        })
        .select("id")
        .single();
      if (error) throw error;
      return data;
    },
    async updateSection(id, patch) {
      const { error } = await supabase.from("plan_sections").update(patch).eq("id", id);
      if (error) throw error;
    },
    async updateSectionFields(id, patch) {
      const { error } = await supabase.from("plan_sections").update(patch).eq("id", id);
      if (error) throw error;
    },
    async createTasks(sectionId, tasks) {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("plan_tasks")
        .insert(
          tasks.map((task) => ({
            plan_id: planId,
            section_id: sectionId,
            ...task,
            ...(task.status === "done" && { completed_at: now }),
          })),
        )
        .select("id, position")
        .order("position", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    async updateTask(id, patch) {
      const { error } = await supabase.from("plan_tasks").update(patch).eq("id", id);
      if (error) throw error;
    },
    async createSteps(steps) {
      const { error } = await supabase.from("plan_task_steps").insert(
        steps.map((step) => ({
          task_id: step.taskId,
          text: step.text,
          done: step.done,
          depth: step.depth,
          position: step.position,
          ...(step.featureId && { feature_id: step.featureId }),
        })),
      );
      if (error) throw error;
    },
    async createFeatures(features) {
      const { data, error } = await supabase
        .from("plan_task_features")
        .insert(
          features.map((feature) => ({
            task_id: feature.taskId,
            text: feature.text.slice(0, FEATURE_TEXT_MAX),
            met: feature.met,
            position: feature.position,
          })),
        )
        .select("id, task_id, position");
      if (error) throw error;
      // Positions repeat from one task to the next, so rows are matched by task and position.
      const byKey = new Map((data ?? []).map((row) => [`${row.task_id}:${row.position}`, row.id]));
      return features.map((feature) => {
        const id = byKey.get(`${feature.taskId}:${feature.position}`);
        if (!id) throw new Error("A feature was saved but not returned.");
        return { id };
      });
    },
    async createQuestions(questions) {
      const now = new Date().toISOString();
      const { error } = await supabase.from("plan_task_questions").insert(
        questions.map((question) => ({
          task_id: question.taskId,
          body: question.body.slice(0, QUESTION_BODY_MAX),
          blocking: question.blocking,
          status: question.status,
          answer: question.answer ? question.answer.slice(0, QUESTION_ANSWER_MAX) : null,
          asked_by_user_id: actorId,
          ...(question.status !== "open" && { answered_by_user_id: actorId }),
          ...(question.status === "answered" && { answered_at: now }),
        })),
      );
      if (error) throw error;
    },
  };
}
