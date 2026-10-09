import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { TaskWithAgent } from "@/data";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { clientPlanQuery } from "@/data/planner";
import { cn } from "@/lib/utils";
import { CommentThread } from "./client-plan-screen";
import type { PlanActions } from "./use-plan-actions";

/**
 * The client's version of a task: a short plain-Danish name, one sentence, and a
 * plain wording for each step. The agency's own title, brief and steps stay as
 * they are; a client sees a task only once it has a title here, and a step only
 * once it has a wording.
 */
export function TaskClientLayer({ task, actions }: { task: TaskWithAgent; actions: PlanActions }) {
  const [title, setTitle] = useState(task.client_title ?? "");
  const [summary, setSummary] = useState(task.client_summary ?? "");

  useEffect(() => {
    setTitle(task.client_title ?? "");
    setSummary(task.client_summary ?? "");
  }, [task.id, task.client_title, task.client_summary]);

  const shown = Boolean(task.client_title?.trim());
  const steps = task.steps ?? [];
  const features = task.features ?? [];

  const saveTitle = () => {
    const next = title.trim();
    if (next === (task.client_title ?? "").trim()) return;
    actions.patchTask(task, { clientTitle: next || null }, { client_title: next || null });
  };
  const saveSummary = () => {
    const next = summary.trim();
    if (next === (task.client_summary ?? "").trim()) return;
    actions.patchTask(task, { clientSummary: next || null }, { client_summary: next || null });
  };

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`client-${task.id}`}>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h3 id={`client-${task.id}`} className="font-display text-[22px] leading-none">
          For the client
        </h3>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            shown ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
          )}
        >
          {shown ? "Shown to clients" : "Hidden from clients"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        Plain Danish, no jargon: say what it is for them, not how it is built. Clients see a task
        only once it has a title here, and a step only once it has a wording.
      </p>

      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Client title</span>
        <Input
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={saveTitle}
          placeholder="e.g. Shader-forbedringer"
          className="h-[38px] text-sm"
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs text-muted-foreground">Client summary (optional)</span>
        <Textarea
          value={summary}
          maxLength={1000}
          rows={2}
          onChange={(event) => setSummary(event.target.value)}
          onBlur={saveSummary}
          placeholder="En enkelt sætning om, hvad det betyder for jer."
          className="resize-y text-sm"
        />
      </label>

      {features.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            What it has to deliver, in plain words: this is the client&rsquo;s list of what is still
            missing
          </span>
          <ul className="flex flex-col gap-1.5">
            {features.map((feature) => (
              <FeatureClientText key={feature.id} feature={feature} actions={actions} />
            ))}
          </ul>
        </div>
      ) : null}

      {steps.length > 0 ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">Steps, in plain words</span>
          <ul className="flex flex-col gap-1.5">
            {steps.map((step) => (
              <StepClientText key={step.id} step={step} actions={actions} />
            ))}
          </ul>
        </div>
      ) : null}

      <ClientConversation task={task} />
    </section>
  );
}

/** What the client has said on this task, and a place to answer. Only matters on shared plans. */
function ClientConversation({ task }: { task: TaskWithAgent }) {
  const query = useQuery(clientPlanQuery(task.plan_id));
  const comments = (query.data?.comments ?? []).filter((comment) => comment.task_id === task.id);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">
        Conversation with the client{comments.length > 0 ? ` (${comments.length})` : ""}. Visible to
        them on plans shared with clients.
      </span>
      <CommentThread
        planId={task.plan_id}
        sectionId={null}
        taskId={task.id}
        comments={comments}
        bordered={false}
      />
    </div>
  );
}

function FeatureClientText({
  feature,
  actions,
}: {
  feature: NonNullable<TaskWithAgent["features"]>[number];
  actions: PlanActions;
}) {
  const [text, setText] = useState(feature.client_text ?? "");
  useEffect(() => setText(feature.client_text ?? ""), [feature.id, feature.client_text]);

  return (
    <li className="flex flex-col gap-1">
      <span className="truncate text-[11px] text-muted-foreground" title={feature.text}>
        {feature.text}
      </span>
      <Input
        value={text}
        maxLength={300}
        aria-label={`Client wording for: ${feature.text}`}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const next = text.trim();
          if (next === (feature.client_text ?? "").trim()) return;
          actions.editFeature.fire({ featureId: feature.id, clientText: next || null });
        }}
        placeholder="Skjult for kunden, indtil du skriver noget"
        className="h-8 text-sm"
      />
    </li>
  );
}

function StepClientText({
  step,
  actions,
}: {
  step: NonNullable<TaskWithAgent["steps"]>[number];
  actions: PlanActions;
}) {
  const [text, setText] = useState(step.client_text ?? "");
  useEffect(() => setText(step.client_text ?? ""), [step.id, step.client_text]);

  return (
    <li className="flex flex-col gap-1">
      <span className="truncate text-[11px] text-muted-foreground" title={step.text}>
        {step.text}
      </span>
      <Input
        value={text}
        maxLength={300}
        aria-label={`Client wording for: ${step.text}`}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          const next = text.trim();
          if (next === (step.client_text ?? "").trim()) return;
          actions.editStep.fire({ stepId: step.id, clientText: next || null });
        }}
        placeholder="Skjult for kunden, indtil du skriver noget"
        className="h-8 text-sm"
      />
    </li>
  );
}
