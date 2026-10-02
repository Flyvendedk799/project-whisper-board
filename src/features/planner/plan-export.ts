import { toast } from "sonner";
import { planMarkdownFilename, serializePlanMarkdown } from "@/lib/plan-markdown";
import type { PlanWithSections } from "@/data";
import { sortedTasks } from "./plan-model";

/** The plan as a Markdown document, sub-steps included. */
export function planToMarkdown(plan: PlanWithSections): string {
  return serializePlanMarkdown({
    sections: plan.sections.map((section) => ({
      title: section.title,
      tasks: sortedTasks(section.tasks ?? []).map((task) => ({
        title: task.title,
        description: task.description ?? "",
        ...(task.acceptance_criteria?.trim() && { acceptance: task.acceptance_criteria.trim() }),
        ...(task.status === "done" && { done: true }),
        steps: [...(task.steps ?? [])]
          .sort((a, b) => a.position - b.position)
          .map((step) => ({ text: step.text, done: step.done, depth: step.depth })),
      })),
    })),
  });
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
