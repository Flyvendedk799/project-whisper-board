import { useState } from "react";
import { X } from "lucide-react";
import type { TaskWithAgent } from "@/data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { splitDescriptionSteps, stepsProgress } from "@/lib/plan-markdown";
import { cn } from "@/lib/utils";
import type { PlanActions } from "./use-plan-actions";

/** The sub-step checklist in the task drawer. */
export function TaskSteps({ task, actions }: { task: TaskWithAgent; actions: PlanActions }) {
  const [text, setText] = useState("");
  const steps = task.steps ?? [];
  const progress = stepsProgress(steps);
  const allDone = progress.total > 0 && progress.done === progress.total;
  const canReview = allDone && task.status !== "done" && task.status !== "in_review";
  const legacy = splitDescriptionSteps(task.description, { plainLists: true }).steps.length;

  const add = () => {
    const value = text.trim();
    if (!value) return;
    actions.addStep.fire({ taskId: task.id, text: value });
    setText("");
  };

  return (
    <section className="flex flex-col gap-2.5" aria-labelledby={`steps-${task.id}`}>
      <div className="flex items-baseline gap-2.5">
        <h3 id={`steps-${task.id}`} className="font-display text-[22px] leading-none">
          Sub-steps
        </h3>
        {progress.total > 0 ? (
          <span className="text-xs text-muted-foreground">
            {progress.done} of {progress.total} done
          </span>
        ) : null}
      </div>

      {progress.total > 0 ? (
        <div
          role="progressbar"
          aria-label="Sub-step progress"
          aria-valuenow={progress.percent}
          aria-valuemin={0}
          aria-valuemax={100}
          className="h-1 overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full bg-success transition-[width] duration-200"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      ) : null}

      <ul className="flex flex-col">
        {steps.map((step) => (
          <li
            key={step.id}
            className="flex items-center gap-2.5 py-1.5"
            style={{ paddingLeft: step.depth * 20 }}
          >
            <button
              type="button"
              role="checkbox"
              aria-checked={step.done}
              aria-label={`${step.done ? "Reopen" : "Finish"} ${step.text}`}
              onClick={() => actions.toggleStep(task.id, step.id, !step.done)}
              className={cn(
                "flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] text-[11px] leading-none text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                step.done ? "border-success bg-success" : "border-border bg-transparent",
              )}
            >
              {step.done ? "✓" : ""}
            </button>
            <span
              className={cn(
                "flex-1 text-sm leading-snug",
                step.done && "text-muted-foreground line-through",
              )}
            >
              {step.text}
            </span>
            <button
              type="button"
              aria-label={`Remove sub-step ${step.text}`}
              onClick={() => actions.deleteStep(task.id, step.id)}
              className="text-muted-foreground/70 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          }
        }}
        placeholder="Add a sub-step, press Enter"
        aria-label="Add a sub-step"
        maxLength={500}
        className="h-9 text-[13px]"
      />

      {steps.length === 0 && legacy > 0 ? (
        <div className="flex items-center gap-2.5 rounded-lg bg-muted/60 px-3.5 py-2.5 text-[13px]">
          <span className="flex-1">
            The brief has a list in it. Turn it into {legacy} checkable sub-step
            {legacy === 1 ? "" : "s"}?
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={actions.convert.busy}
            onClick={() => actions.convert.fire({ taskId: task.id, plainLists: true })}
          >
            Turn into sub-steps
          </Button>
        </div>
      ) : null}

      {canReview ? (
        <div className="flex items-center gap-2.5 rounded-[10px] bg-success/15 px-3.5 py-2.5 text-[13px]">
          <span className="flex-1">Every sub-step is done.</span>
          <Button
            type="button"
            size="sm"
            className="h-7 text-xs"
            onClick={() => actions.setStatus(task, "in_review")}
          >
            Move to review
          </Button>
        </div>
      ) : null}
    </section>
  );
}
