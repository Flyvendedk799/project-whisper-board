import { useState } from "react";
import { Bot, Link2, MoreHorizontal, X } from "lucide-react";
import type { PlanTaskFeature, PlanTaskStep, TaskWithAgent } from "@/data";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import {
  MAX_STEP_DEPTH,
  splitDescriptionSteps,
  STEP_TEXT_MAX,
  stepsProgress,
} from "@/lib/plan-markdown";
import { stepCoverage } from "@/lib/plan-fields";
import { cn } from "@/lib/utils";
import type { PlanActions } from "./use-plan-actions";

function featureLabel(feature: PlanTaskFeature, index: number) {
  return `${index + 1}. ${feature.text}`;
}

function StepRow({
  step,
  index,
  count,
  task,
  features,
  actions,
}: {
  step: PlanTaskStep;
  index: number;
  count: number;
  task: TaskWithAgent;
  features: PlanTaskFeature[];
  actions: PlanActions;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(step.text);
  const featureIndex = features.findIndex((feature) => feature.id === step.feature_id);
  const linked = featureIndex >= 0 ? features[featureIndex] : null;

  const commit = () => {
    setEditing(false);
    const next = text.replace(/\s+/g, " ").trim();
    if (!next) setText(step.text);
    else if (next !== step.text) actions.editStep.fire({ stepId: step.id, text: next });
  };

  return (
    <li className="group flex items-center gap-2.5 py-1.5" style={{ paddingLeft: step.depth * 20 }}>
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

      {editing ? (
        <input
          autoFocus
          value={text}
          aria-label="Edit sub-step"
          maxLength={STEP_TEXT_MAX}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              setText(step.text);
              setEditing(false);
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-primary bg-card px-2 text-sm outline-none"
        />
      ) : (
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
          <button
            type="button"
            title="Click to edit"
            onClick={() => {
              setText(step.text);
              setEditing(true);
            }}
            className={cn(
              "rounded-md px-1 text-left text-sm leading-snug hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              step.done && "text-muted-foreground line-through",
            )}
          >
            {step.text}
          </button>
          {linked ? (
            <span
              title={`Delivers feature ${featureIndex + 1}: ${linked.text}`}
              className="inline-flex max-w-[180px] items-center gap-1 rounded-full border bg-muted/50 px-1.5 py-px text-[11px] text-muted-foreground"
            >
              <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {featureIndex + 1}. {linked.text}
              </span>
            </span>
          ) : null}
          {step.source !== "human" ? (
            <span
              title={step.source === "ai" ? "Written by AI" : "Added by an agent"}
              className="inline-flex items-center gap-0.5 rounded-full bg-chart-5/20 px-1.5 py-px text-[10px]"
            >
              <Bot className="h-3 w-3" aria-hidden="true" />
              {step.source === "ai" ? "AI" : "agent"}
            </span>
          ) : null}
        </span>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Options for sub-step ${step.text}`}
            className="rounded p-0.5 text-muted-foreground/70 opacity-0 hover:text-foreground focus-visible:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem
            disabled={index === 0}
            onSelect={() => actions.shiftStep(task.id, step.id, -1)}
          >
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={index === count - 1}
            onSelect={() => actions.shiftStep(task.id, step.id, 1)}
          >
            Move down
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={step.depth >= MAX_STEP_DEPTH || index === 0}
            onSelect={() => actions.setStepDepth(task.id, step.id, step.depth + 1)}
          >
            Indent
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={step.depth === 0}
            onSelect={() => actions.setStepDepth(task.id, step.id, step.depth - 1)}
          >
            Outdent
          </DropdownMenuItem>
          {features.length > 0 ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Delivers feature…</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-w-xs">
                  <DropdownMenuLabel className="text-xs">
                    Which feature is this for?
                  </DropdownMenuLabel>
                  {features.map((feature, i) => (
                    <DropdownMenuItem
                      key={feature.id}
                      className={cn(feature.id === step.feature_id && "bg-accent")}
                      onSelect={() => actions.linkStep(task.id, step.id, feature.id)}
                    >
                      <span className="truncate">{featureLabel(feature, i)}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!step.feature_id}
                    onSelect={() => actions.linkStep(task.id, step.id, null)}
                  >
                    No feature
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        aria-label={`Remove sub-step ${step.text}`}
        onClick={() => actions.deleteStep(task.id, step.id)}
        className="text-muted-foreground/70 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  );
}

/**
 * The sub-step checklist in the task drawer. Sub-steps are how the work gets
 * done; a step can say which feature of the feature list it delivers, and the
 * header shows which features still have no step at all.
 */
export function TaskSteps({ task, actions }: { task: TaskWithAgent; actions: PlanActions }) {
  const [text, setText] = useState("");
  const [featureId, setFeatureId] = useState<string | null>(null);
  const steps = task.steps ?? [];
  const features = task.features ?? [];
  const progress = stepsProgress(steps);
  const coverage = stepCoverage(features, steps);
  const allDone = progress.total > 0 && progress.done === progress.total;
  const canReview = allDone && task.status !== "done" && task.status !== "in_review";
  const legacy = splitDescriptionSteps(task.description, { plainLists: true }).steps.length;
  // A feature that was removed since the link was chosen no longer applies.
  const selectedFeature = features.find((feature) => feature.id === featureId) ?? null;

  const add = () => {
    const value = text.trim();
    if (!value) return;
    setText("");
    if (!value.includes("\n") && !selectedFeature) {
      actions.addStep.fire({ taskId: task.id, text: value });
      return;
    }
    actions.addSteps.fire({ taskId: task.id, text: value, featureId: selectedFeature?.id ?? null });
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

      {features.length > 0 && coverage.uncovered.length > 0 ? (
        <div className="flex flex-col gap-1.5 rounded-lg bg-muted/50 px-3 py-2 text-xs">
          <span className="text-muted-foreground">
            {coverage.uncovered.length === 1
              ? "1 feature has no sub-step yet:"
              : `${coverage.uncovered.length} features have no sub-step yet:`}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {coverage.uncovered.map((id) => {
              const index = features.findIndex((feature) => feature.id === id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFeatureId(id)}
                  className={cn(
                    "max-w-full truncate rounded-full border bg-card px-2 py-0.5 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    featureId === id && "border-primary bg-accent",
                  )}
                  title="Add sub-steps for this feature"
                >
                  {featureLabel(features[index], index)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      <ul className="flex flex-col">
        {steps.map((step, index) => (
          <StepRow
            key={step.id}
            step={step}
            index={index}
            count={steps.length}
            task={task}
            features={features}
            actions={actions}
          />
        ))}
      </ul>

      <div className="flex flex-col gap-1.5">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              add();
            }
          }}
          rows={1}
          placeholder={
            selectedFeature
              ? `Sub-step for "${selectedFeature.text}", press Enter`
              : "Add a sub-step, press Enter"
          }
          aria-label="Add a sub-step"
          className="min-h-9 resize-y bg-background py-2 text-[13px]"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {features.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex max-w-[260px] items-center gap-1 rounded-full border bg-card px-2 py-0.5 hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">
                    {selectedFeature
                      ? `For feature ${features.indexOf(selectedFeature) + 1}`
                      : "For a feature…"}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-w-xs">
                {features.map((feature, index) => (
                  <DropdownMenuItem key={feature.id} onSelect={() => setFeatureId(feature.id)}>
                    <span className="truncate">{featureLabel(feature, index)}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!featureId} onSelect={() => setFeatureId(null)}>
                  No feature
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <span>Paste a list to add several; indent to nest.</span>
        </div>
      </div>

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
