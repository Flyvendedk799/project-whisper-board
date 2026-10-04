import type { TaskWithAgent } from "@/data";
import { Button } from "@/components/ui/button";
import { timeAgo } from "./plan-model";
import type { PlanActions } from "./use-plan-actions";

/**
 * Technical context for a task: what exists in the repository, where to
 * change it and what to watch for. Written by "Add context" (AI reading the
 * plan's repository) and read by agents next to the brief. Shown only when
 * there is some, so a plan that never used it carries no empty section.
 */
export function TaskTechnicalContext({
  task,
  actions,
}: {
  task: TaskWithAgent;
  actions: PlanActions;
}) {
  const context = task.ai_context?.trim();
  if (!context) return null;
  const files = task.context_files ?? [];

  return (
    <section className="flex flex-col gap-2.5" aria-labelledby={`context-${task.id}`}>
      <div className="flex items-baseline gap-2.5">
        <h3 id={`context-${task.id}`} className="font-display text-[22px] leading-none">
          Technical context
        </h3>
        {task.ai_context_at ? (
          <span className="text-xs text-muted-foreground">{timeAgo(task.ai_context_at)}</span>
        ) : null}
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => actions.patchTask(task, { aiContext: null }, { ai_context: null })}
        >
          Clear
        </Button>
      </div>
      <div className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-3 text-[13px] leading-relaxed max-md:max-h-72 max-md:overscroll-contain max-md:text-sm">
        {context}
      </div>
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {files.map((file) => (
            <li
              key={file}
              className="max-w-full truncate rounded-md border bg-card px-1.5 py-px font-mono text-[11px] text-muted-foreground max-md:text-xs"
              title={file}
            >
              {file}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
