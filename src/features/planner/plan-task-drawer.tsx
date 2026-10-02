import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { planEventsQuery } from "@/data/planner";
import type { EventWithRefs, PlanWithSections, TaskWithAgent } from "@/data";
import { AttachmentLightbox } from "./attachment-lightbox";
import { usePlanMedia } from "./plan-media";
import { taskHeadline, taskLink } from "./plan-model";
import { collectTags, questionCounts, workTargetOf } from "@/lib/plan-fields";
import { CopyIdButton } from "./copy-id-button";
import { TaskAttachments } from "./task-attachments";
import { TaskDiscussion } from "./task-discussion";
import { TaskFeatures } from "./task-features";
import { TaskProperties } from "./task-properties";
import { TaskQuestions } from "./task-questions";
import { TaskSteps } from "./task-steps";
import { TaskTechnicalContext } from "./task-technical-context";
import type { PlanActions } from "./use-plan-actions";
import { useSyncedField } from "./use-synced-field";

/**
 * The two-pane task view: brief, sub-steps, attachments and discussion on the
 * left, properties on the right. Previous/next follow the board's current
 * filters, so walking a filtered list stays inside it.
 */
export function PlanTaskDrawer({
  plan,
  taskId,
  order,
  actions,
  onSelect,
  renderAiMenu,
}: {
  plan: PlanWithSections;
  taskId: string | null;
  /** Task ids in board reading order, after filters. */
  order: string[];
  actions: PlanActions;
  onSelect: (taskId: string | null) => void;
  /** Slot for the task's AI menu, shown only when AI is configured. */
  renderAiMenu?: (task: TaskWithAgent) => React.ReactNode;
}) {
  const task = useMemo(() => {
    if (!taskId) return null;
    for (const section of plan.sections ?? []) {
      const found = (section.tasks ?? []).find((t) => t.id === taskId);
      if (found) return found;
    }
    return null;
  }, [plan, taskId]);

  return (
    <Sheet open={Boolean(taskId)} onOpenChange={(open) => !open && onSelect(null)}>
      <SheetContent
        className="flex w-full flex-col gap-0 p-0 sm:max-w-[940px]"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <SheetTitle className="sr-only">{task ? taskHeadline(task.title) : "Task"}</SheetTitle>
        <SheetDescription className="sr-only">Task details and discussion</SheetDescription>
        {task ? (
          <DrawerBody
            key={task.id}
            plan={plan}
            task={task}
            order={order}
            actions={actions}
            onSelect={onSelect}
            aiMenu={renderAiMenu?.(task)}
          />
        ) : taskId ? (
          <div className="p-8 text-sm text-muted-foreground">
            This task doesn&rsquo;t exist any more. It may have been deleted.
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function DrawerBody({
  plan,
  task,
  order,
  actions,
  onSelect,
  aiMenu,
}: {
  plan: PlanWithSections;
  task: TaskWithAgent;
  order: string[];
  actions: PlanActions;
  onSelect: (taskId: string | null) => void;
  aiMenu?: React.ReactNode;
}) {
  const media = usePlanMedia();
  const events = useQuery(planEventsQuery(plan.id));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const section = plan.sections.find((s) => s.id === task.section_id);
  const tagSuggestions = useMemo(() => collectTags(plan).map((entry) => entry.tag), [plan]);
  const questions = questionCounts(task.questions);
  const position = order.indexOf(task.id);
  const files = media.byTask.get(task.id) ?? [];

  const createdBy = useMemo(() => {
    const created = ((events.data?.events ?? []) as EventWithRefs[]).find(
      (e) => e.kind === "task_created" && e.task_id === task.id,
    );
    return created?.actor?.full_name ?? created?.agent?.name ?? null;
  }, [events.data, task.id]);

  const title = useSyncedField(task.title ?? "", (value) => {
    const next = value.trim();
    if (!next) return false;
    actions.patchTask(task, { title: next }, { title: next });
  });
  const brief = useSyncedField(task.description ?? "", (value) =>
    actions.patchTask(task, { description: value }, { description: value }),
  );

  // Screenshots pasted anywhere in the drawer attach to the task; pasted into
  // the note box, they attach to the note.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (lightboxId) return;
      const pasted = Array.from(event.clipboardData?.files ?? []);
      if (pasted.length === 0) return;
      event.preventDefault();
      const inComposer = document.activeElement === composerRef.current;
      void media.upload(task.id, pasted, { composer: inComposer });
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [lightboxId, media, task.id]);

  const go = (delta: number) => {
    const next = order[position + delta];
    if (next) onSelect(next);
  };

  return (
    <>
      <div className="flex items-center gap-2.5 border-b px-5 py-2.5 pr-14 text-[13px] text-muted-foreground">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7"
          aria-label="Previous task"
          disabled={position <= 0}
          onClick={() => go(-1)}
        >
          <ChevronUp className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7"
          aria-label="Next task"
          disabled={position < 0 || position >= order.length - 1}
          onClick={() => go(1)}
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
        <span className="min-w-0 flex-1 truncate">
          <span className="font-mono text-xs uppercase">T-{task.id.slice(0, 4)}</span>
          {section ? ` · ${section.title}` : ""}
          {position >= 0 ? (
            <span className="ml-1.5 text-xs">
              {position + 1} of {order.length}
            </span>
          ) : null}
        </span>
        {aiMenu}
        <CopyIdButton id={task.id} label="task" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs"
          onClick={() => {
            const link = taskLink(window.location.origin, plan.id, task.id);
            navigator.clipboard
              .writeText(link)
              .then(() => toast.success("Link copied"))
              .catch(() => toast.error("Couldn't copy the link"));
          }}
        >
          Copy link
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
        >
          Delete
        </Button>
      </div>

      <div className="flex flex-1 flex-col overflow-auto md:flex-row md:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-7 px-5 pb-10 pt-6 md:px-7">
          <Input
            {...title.bind}
            aria-label="Task title"
            className="-mx-2 h-auto border-transparent bg-transparent px-2 py-1.5 font-display text-[32px] leading-tight shadow-none hover:bg-muted/50 focus-visible:border-primary focus-visible:bg-card md:text-[32px]"
          />

          <div className="flex flex-col gap-2">
            <label
              htmlFor={`brief-${task.id}`}
              className="text-xs font-medium text-muted-foreground"
            >
              Brief for the agent or developer
            </label>
            <Textarea
              id={`brief-${task.id}`}
              {...brief.bind}
              placeholder="What should be done, and what does done look like? Markdown supported."
              className="min-h-[110px] resize-y rounded-[10px] bg-background text-sm leading-relaxed"
            />
          </div>

          {questions.open > 0 ? (
            <a
              href={`#questions-${task.id}`}
              className={
                questions.blocking > 0
                  ? "rounded-lg bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive"
                  : "rounded-lg bg-warning/15 px-3.5 py-2.5 text-[13px]"
              }
            >
              {questions.blocking > 0
                ? `Blocked by ${questions.blocking} open question${questions.blocking === 1 ? "" : "s"}. Answer to release the task.`
                : `${questions.open} open question${questions.open === 1 ? "" : "s"} waiting for an answer.`}
            </a>
          ) : null}

          <TaskFeatures task={task} actions={actions} />
          <TaskSteps task={task} actions={actions} />
          <TaskQuestions task={task} actions={actions} />
          <TaskTechnicalContext task={task} actions={actions} />
          <TaskAttachments task={task} onOpenFile={setLightboxId} />
          <TaskDiscussion
            taskId={task.id}
            planId={plan.id}
            onOpenFile={setLightboxId}
            composerRef={composerRef}
          />
        </div>

        <div className="border-t bg-surface px-5 pb-10 pt-6 md:w-[272px] md:shrink-0 md:self-stretch md:border-l md:border-t-0">
          <TaskProperties
            task={task}
            planId={plan.id}
            actions={actions}
            createdBy={createdBy}
            tagSuggestions={tagSuggestions}
            work={workTargetOf(plan)}
          />
        </div>
      </div>

      <AttachmentLightbox
        items={files}
        openId={lightboxId}
        onOpenChange={setLightboxId}
        contextFor={() => taskHeadline(task.title)}
      />

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-2xl font-normal">
              Delete this task?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Its notes and links go with it. Agents working on it will lose the task.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                actions.deleteWithUndo(task);
                onSelect(null);
              }}
            >
              Delete task
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
