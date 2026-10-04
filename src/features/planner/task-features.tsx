import { useState } from "react";
import { ArrowDown, ArrowUp, MoreHorizontal, X } from "lucide-react";
import type { PlanTaskFeature, TaskWithAgent } from "@/data";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";
import { FEATURE_TEXT_MAX, featuresProgress, parseFeatureList } from "@/lib/plan-fields";
import { cn } from "@/lib/utils";
import type { PlanActions } from "./use-plan-actions";

function FeatureRow({
  feature,
  index,
  count,
  taskId,
  actions,
}: {
  feature: PlanTaskFeature;
  index: number;
  count: number;
  taskId: string;
  actions: PlanActions;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(feature.text);

  const commit = () => {
    setEditing(false);
    const next = text.replace(/\s+/g, " ").trim();
    if (!next) setText(feature.text);
    else if (next !== feature.text) actions.editFeature.fire({ featureId: feature.id, text: next });
  };

  return (
    <li className="group flex items-start gap-2.5 py-1.5 max-md:min-h-12 max-md:items-center max-md:gap-3 max-md:border-b max-md:border-border/50 max-md:py-0.5 max-md:last:border-b-0">
      <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-[11px] text-muted-foreground max-md:mt-0 max-md:w-5 max-md:text-xs">
        {index + 1}.
      </span>
      <button
        type="button"
        role="checkbox"
        aria-checked={feature.met}
        aria-label={`${feature.met ? "Mark not met" : "Mark met"}: ${feature.text}`}
        onClick={() => actions.toggleFeature(taskId, feature.id, !feature.met)}
        className={cn(
          "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] text-[11px] leading-none text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:relative max-md:mt-0 max-md:h-6 max-md:w-6 max-md:rounded-md max-md:text-sm max-md:after:absolute max-md:after:-inset-3 max-md:after:content-['']",
          feature.met ? "border-success bg-success" : "border-border bg-transparent",
        )}
      >
        {feature.met ? "✓" : ""}
      </button>
      {editing ? (
        <input
          autoFocus
          value={text}
          aria-label="Edit feature"
          maxLength={FEATURE_TEXT_MAX}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              setText(feature.text);
              setEditing(false);
            }
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-primary bg-card px-2 text-sm outline-none max-md:h-11"
        />
      ) : (
        <button
          type="button"
          title="Click to edit"
          onClick={() => {
            setText(feature.text);
            setEditing(true);
          }}
          className={cn(
            "min-w-0 flex-1 rounded-md px-1 text-left text-sm leading-snug hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11 max-md:break-words max-md:py-2.5",
            feature.met && "text-muted-foreground line-through",
          )}
        >
          {feature.text}
          {feature.source !== "human" ? (
            <span className="ml-1.5 rounded-full bg-chart-5/20 px-1.5 py-px text-[10px] no-underline">
              {feature.source === "ai" ? "AI" : "agent"}
            </span>
          ) : null}
        </button>
      )}
      <span className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100 max-md:hidden">
        <button
          type="button"
          aria-label={`Move feature ${index + 1} up`}
          disabled={index === 0}
          onClick={() => actions.shiftFeature(taskId, feature.id, -1)}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Move feature ${index + 1} down`}
          disabled={index === count - 1}
          onClick={() => actions.shiftFeature(taskId, feature.id, 1)}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30"
        >
          <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label={`Remove feature ${feature.text}`}
          onClick={() => actions.deleteFeature(taskId, feature.id)}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Options for feature ${index + 1}`}
            className="grid h-11 w-11 shrink-0 place-items-center rounded text-muted-foreground md:hidden"
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            disabled={index === 0}
            onSelect={() => actions.shiftFeature(taskId, feature.id, -1)}
          >
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={index === count - 1}
            onSelect={() => actions.shiftFeature(taskId, feature.id, 1)}
          >
            Move down
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => actions.deleteFeature(taskId, feature.id)}
          >
            Remove feature
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

/**
 * The task's feature list: what it must deliver, written by a person after
 * the brief ("must be able to block questions", "has to have good security").
 * Sub-steps are how the work gets done; features are what has to be true.
 */
export function TaskFeatures({ task, actions }: { task: TaskWithAgent; actions: PlanActions }) {
  const [text, setText] = useState("");
  const features = task.features ?? [];
  const progress = featuresProgress(features);
  const pending = parseFeatureList(text).length;

  const add = () => {
    if (!text.trim() || pending === 0) return;
    actions.addFeatures.run({ taskId: task.id, text }).then(
      () => setText(""),
      () => {
        // The action already told the user why.
      },
    );
  };

  return (
    <section className="flex flex-col gap-2.5" aria-labelledby={`features-${task.id}`}>
      <div className="flex items-baseline gap-2.5">
        <h3 id={`features-${task.id}`} className="font-display text-[22px] leading-none">
          Feature list
        </h3>
        {progress.total > 0 ? (
          <span className="text-xs text-muted-foreground">
            {progress.met} of {progress.total} met
          </span>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        What this task has to deliver. Agents read it with the brief and tick features off as the
        work satisfies them.
      </p>

      {features.length > 0 ? (
        <ul className="flex flex-col">
          {features.map((feature, index) => (
            <FeatureRow
              key={feature.id}
              feature={feature}
              index={index}
              count={features.length}
              taskId={task.id}
              actions={actions}
            />
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-2">
        <Textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              add();
            }
          }}
          aria-label="Add features"
          placeholder={
            "Add a feature, or paste a list:\n- Must be able to block questions\n- Has to have good security"
          }
          className="min-h-[60px] resize-y bg-background text-sm"
        />
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground max-md:hidden">
            Enter adds, Shift+Enter for a new line. Bullets and numbers are removed.
          </span>
          <span className="flex-1 max-md:hidden" />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs max-md:w-full"
            disabled={pending === 0 || actions.addFeatures.busy}
            onClick={add}
          >
            {pending > 1 ? `Add ${pending} features` : "Add feature"}
          </Button>
        </div>
      </div>
    </section>
  );
}
