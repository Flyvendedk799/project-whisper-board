import { toast } from "sonner";
import { isWorkMode } from "@/lib/plan-fields";
import { serializeBoardMarkdown } from "@/lib/plan-markdown-board";
import { planMarkdownFilename, type PlanMdDocument, type PlanMdTask } from "@/lib/plan-markdown";
import type { PlanWithSections, TaskWithAgent } from "@/data";
import { sortedTasks } from "./plan-model";

const questionStatus = (status: string) =>
  status === "answered" || status === "dismissed" ? status : "open";

function taskToMd(task: TaskWithAgent): PlanMdTask {
  const features = [...(task.features ?? [])].sort((a, b) => a.position - b.position);
  const featureNumber = new Map(features.map((feature, index) => [feature.id, index + 1]));
  const assignee = task.assigned_user
    ? task.assigned_user.full_name || task.assigned_user.email
    : task.assigned_agent?.name;

  return {
    title: task.title,
    description: task.description ?? "",
    id: task.id,
    status: task.status,
    ...(task.status === "done" && { done: true }),
    priority: task.priority,
    ...(task.complexity && { size: task.complexity }),
    ...(task.labels?.length && { tags: task.labels }),
    ...(assignee && { assignee }),
    ...(task.color?.trim() && { color: task.color.trim() }),
    ...(features.length > 0 && {
      features: features.map((feature) => ({ text: feature.text, met: feature.met })),
    }),
    steps: [...(task.steps ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((step) => ({
        text: step.text,
        done: step.done,
        depth: step.depth,
        ...(step.feature_id &&
          featureNumber.has(step.feature_id) && {
            feature: featureNumber.get(step.feature_id),
          }),
      })),
    ...(task.acceptance_criteria?.trim() && { acceptance: task.acceptance_criteria.trim() }),
    ...(task.ai_context?.trim() && { context: task.ai_context.trim() }),
    ...(task.questions?.length && {
      questions: [...task.questions]
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((question) => ({
          body: question.body,
          blocking: question.blocking,
          status: questionStatus(question.status),
          ...(question.answer?.trim() && { answer: question.answer.trim() }),
        })),
    }),
  };
}

/** The board's data as the document the Markdown writer (and reader) works with. */
export function planToDocument(
  plan: PlanWithSections,
  exportedAt: Date = new Date(),
): PlanMdDocument {
  const repo = plan.github_repo?.trim();
  const base = plan.github_base?.trim();
  const branch = plan.github_work_branch?.trim();
  return {
    title: plan.title,
    plan: {
      id: plan.id,
      status: plan.status,
      exportedAt: exportedAt.toISOString().slice(0, 10),
      ...(plan.description?.trim() && { description: plan.description.trim() }),
      ...(repo && { repo }),
      ...(base && { base }),
      ...(isWorkMode(plan.github_work_mode) && {
        workMode: plan.github_work_mode,
        ...(branch && { workBranch: branch }),
      }),
    },
    sections: plan.sections.map((section) => ({
      title: section.title,
      id: section.id,
      ...(section.description?.trim() && { description: section.description.trim() }),
      ...(section.goals?.trim() && { goals: section.goals.trim() }),
      ...(section.intentions?.trim() && { intentions: section.intentions.trim() }),
      ...(section.tags?.length && { tags: section.tags }),
      ...(section.color?.trim() && { color: section.color.trim() }),
      tasks: sortedTasks(section.tasks ?? []).map(taskToMd),
    })),
  };
}

/**
 * The plan as a Markdown document: a header, a `##` per section and a `###` per
 * task with its brief, features, sub-steps, acceptance, technical context and
 * questions. Importing the file reads all of it back.
 */
export function planToMarkdown(plan: PlanWithSections, exportedAt?: Date): string {
  return serializeBoardMarkdown(planToDocument(plan, exportedAt));
}

/** Downloads the plan as a real `.md` file. */
export function downloadPlanMarkdown(plan: PlanWithSections) {
  const blob = new Blob([planToMarkdown(plan)], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = planMarkdownFilename(plan.title);
  anchor.click();
  URL.revokeObjectURL(url);
  toast.success(`Exported ${anchor.download}`);
}
