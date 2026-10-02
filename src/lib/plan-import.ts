import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";
import {
  MAX_STEP_DEPTH,
  parsePlanMarkdown,
  planMarkdownCoverage,
  planMarkdownStats,
  STEP_TEXT_MAX,
} from "@/lib/plan-markdown";
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

export async function attachmentPathsWhere(
  supabase: Client,
  column: "task_id" | "plan_id",
  ids: string[],
): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from("plan_task_attachments")
    .select("storage_path")
    .in(column, ids);
  return (data ?? []).map((row) => row.storage_path);
}

export type PlanImportResult = {
  mode: "replace" | "merge";
  sections: number;
  tasks: number;
  steps: number;
  /** Source lines checked, and the ones that did not make it into the plan. */
  coverage: { lines: number; missing: number; missingLines: string[] };
};

/**
 * Turns markdown into sections, tasks and steps on an existing plan, then
 * checks that every line of the source landed somewhere.
 *
 * Shared by the board's import dialog (a signed-in person) and the REST API
 * (an API key, no person), so both read a document the same way.
 */
export async function applyPlanMarkdown(
  supabase: Client,
  input: {
    planId: string;
    markdown: string;
    mode: "replace" | "merge";
    /** The signed-in user, or null when an API key did the import. */
    actorId: string | null;
  },
): Promise<PlanImportResult> {
  const { data: planRow } = await supabase
    .from("plans")
    .select("id")
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

  if (input.mode === "replace") {
    const paths = await attachmentPathsWhere(supabase, "plan_id", [plan.id]);
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
  let sectionPosition = maxPosSection ? (maxPosSection.position || 0) + 1 : 1;

  let createdSections = 0;
  let createdTasks = 0;
  let createdSteps = 0;

  // What sat above the first section (a title's intro, a status table) is
  // kept as a section of its own, so it is on the board and not in the header.
  const sections = doc.preamble
    ? [{ title: OVERVIEW_TITLE, description: doc.preamble, tasks: [] }, ...doc.sections]
    : doc.sections;

  for (const section of sections) {
    const { data: createdSection, error: sectionError } = await supabase
      .from("plan_sections")
      .insert({
        plan_id: plan.id,
        title: section.title,
        description: section.description || null,
        color: SECTION_PALETTE[(sectionPosition - 1) % SECTION_PALETTE.length],
        position: sectionPosition,
      })
      .select("id")
      .single();
    if (sectionError) throw sectionError;
    sectionPosition += 1;
    createdSections += 1;

    if (section.tasks.length === 0) continue;

    // One insert per section; rows come back in the order they were sent.
    const { data: createdRows, error: taskError } = await supabase
      .from("plan_tasks")
      .insert(
        section.tasks.map((task, index) => ({
          plan_id: plan.id,
          section_id: createdSection.id,
          title: task.title,
          description: task.description || null,
          status: "available" as const,
          position: index + 1,
        })),
      )
      .select("id, position")
      .order("position", { ascending: true });
    if (taskError) throw taskError;
    createdTasks += createdRows?.length ?? 0;

    const stepRows = (createdRows ?? []).flatMap((row, index) =>
      (section.tasks[index]?.steps ?? []).map((step, stepIndex) => ({
        task_id: row.id,
        text: step.text.slice(0, STEP_TEXT_MAX),
        done: step.done,
        depth: Math.min(step.depth, MAX_STEP_DEPTH),
        position: stepIndex + 1,
      })),
    );
    if (stepRows.length > 0) {
      const { error: stepError } = await supabase.from("plan_task_steps").insert(stepRows);
      if (stepError) throw stepError;
      createdSteps += stepRows.length;
    }
  }

  const { error: eventError } = await supabase.from("plan_events").insert({
    plan_id: plan.id,
    actor_id: input.actorId,
    kind: "section_created",
    new_value: `${createdSections} sections, ${createdTasks} tasks`,
    metadata: {},
  });
  if (eventError) console.error("[planner] plan event", eventError.message);

  const coverage = planMarkdownCoverage(input.markdown, doc);
  return {
    mode: input.mode,
    sections: createdSections,
    tasks: createdTasks,
    steps: createdSteps,
    coverage: {
      lines: coverage.lines,
      missing: coverage.missing.length,
      missingLines: coverage.missing.slice(0, MAX_REPORTED_LINES),
    },
  };
}
