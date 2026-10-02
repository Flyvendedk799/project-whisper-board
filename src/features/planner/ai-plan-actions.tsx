/* eslint-disable react-refresh/only-export-components -- the menus and the background hook are one feature, mounted together */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { userAiSettingsQuery } from "@/data/planner";
import { qk } from "@/data/keys";
import { AuditDialog } from "@/features/assistant/audit-dialog";
import { useAssistant } from "@/features/assistant/assistant-provider";
import { useAiEnabled } from "@/hooks/use-ai-enabled";
import { addTaskContext, assessTask } from "@/lib/ai-planner.functions";
import {
  AUTO_ENRICH_SPACING_MS,
  mayContinue,
  planRepo,
  readAssessment,
  selectNextTask,
  shouldAddContext,
  type EnrichPlan,
  type EnrichRun,
} from "@/lib/auto-enrich";
import { toUserMessage } from "@/lib/errors";
import { captureError } from "@/lib/providers";
import { useServerAction } from "@/lib/use-server-action";

/**
 * The AI controls the planner screens mount: a menu for a plan, a menu for a
 * task, and the background mode. All of them stay hidden unless AI is set up,
 * and every one hands its work to the same assistant (or the same server
 * functions) the floating button uses.
 */

/** The little the menus need to know about a plan: where its code lives and what it is called. */
export type AiPlan = {
  id: string;
  title: string;
  github_repo?: string | null;
  project?: { github_repo?: string | null } | null;
};

export type AiTask = {
  id: string;
  title: string;
  /** What `assessTask` stored, shown as a hint. */
  ai_assessment?: unknown;
};

// ---------------------------------------------------------------------------
// Adding context, for one task or several
// ---------------------------------------------------------------------------

function useTaskContext(planId: string) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (taskIds: readonly string[]) => {
      if (taskIds.length === 0 || busy) return;
      setBusy(true);
      const toastId = toast.loading(
        taskIds.length === 1
          ? "Reading the repository…"
          : `Adding context to ${taskIds.length} tasks…`,
      );
      let done = 0;
      let failedInARow = 0;
      let lastProblem = "";
      for (const [index, taskId] of taskIds.entries()) {
        if (taskIds.length > 1) {
          toast.loading(`Adding context: ${index + 1} of ${taskIds.length}…`, { id: toastId });
        }
        try {
          await addTaskContext({ data: { taskId } });
          done++;
          failedInARow = 0;
        } catch (error) {
          captureError(error, { scope: "assistant", label: "assistant.addContext" });
          lastProblem = toUserMessage(error, "Couldn't add context.");
          // Two in a row almost always means the same cause (no GitHub, no AI): stop asking.
          if (++failedInARow >= 2) break;
        }
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: qk.plan(planId) }),
        queryClient.invalidateQueries({ queryKey: qk.planEvents(planId) }),
      ]);
      setBusy(false);
      if (done === taskIds.length) {
        toast.success(done === 1 ? "Added technical context" : `Added context to ${done} tasks`, {
          id: toastId,
        });
      } else if (done > 0) {
        toast.error(`Added context to ${done} of ${taskIds.length} tasks. ${lastProblem}`, {
          id: toastId,
        });
      } else {
        toast.error(lastProblem || "Couldn't add context.", { id: toastId });
      }
    },
    [busy, planId, queryClient],
  );

  return { run, busy };
}

// ---------------------------------------------------------------------------
// Menus
// ---------------------------------------------------------------------------

/**
 * "AI" menu for a plan: Audit plan, Add context to the selected tasks, and the
 * plan-level presets (summary, standup, missing tasks, tags). Pass the ids of
 * the tasks the person has ticked so context can be added to them.
 */
export function PlanAiMenu({
  plan,
  selectedTaskIds = [],
  className,
}: {
  plan: AiPlan;
  selectedTaskIds?: readonly string[];
  className?: string;
}) {
  const aiEnabled = useAiEnabled();
  const assistant = useAssistant();
  const [auditOpen, setAuditOpen] = useState(false);
  const context = useTaskContext(plan.id);

  if (!aiEnabled) return null;

  const hasRepo = planRepo(plan) !== null;
  const run = (preset: Parameters<typeof assistant.run>[0]["preset"]) =>
    assistant.run({ preset, planId: plan.id, planTitle: plan.title });

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className={className} disabled={context.busy}>
            {context.busy ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
            )}
            AI
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            This plan
          </DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setAuditOpen(true)}>Audit plan</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run("summarize_plan")}>Summarize plan</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run("standup")}>Write a standup</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run("suggest_tasks")}>
            Suggest missing tasks
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run("tidy_tags")}>Tidy tags</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!hasRepo || selectedTaskIds.length === 0}
            onSelect={() => void context.run(selectedTaskIds)}
          >
            <span className="flex flex-col">
              <span>
                Add context to selected task{selectedTaskIds.length === 1 ? "" : "s"}
                {selectedTaskIds.length > 0 ? ` (${selectedTaskIds.length})` : ""}
              </span>
              {(!hasRepo || selectedTaskIds.length === 0) && (
                <span className="text-xs text-muted-foreground">
                  {!hasRepo ? "Connect a repository to the plan first" : "Select some tasks first"}
                </span>
              )}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AuditDialog
        planId={plan.id}
        planTitle={plan.title}
        open={auditOpen}
        onOpenChange={setAuditOpen}
      />
    </>
  );
}

/**
 * "AI" menu for one task: technical context from the repository, a feature
 * list, sub-steps, questions, and a fresh look at what it needs.
 */
export function TaskAiMenu({
  plan,
  task,
  className,
}: {
  plan: AiPlan;
  task: AiTask;
  className?: string;
}) {
  const aiEnabled = useAiEnabled();
  const assistant = useAssistant();
  const context = useTaskContext(plan.id);
  const reassess = useServerAction(useServerFn(assessTask), {
    label: "assistant.assessTask",
    invalidate: [qk.plan(plan.id)],
    success: (result) =>
      result.needs.length > 0
        ? `This task could use: ${result.needs.join(", ")}.`
        : "Nothing more needed: this task looks clear.",
  });

  if (!aiEnabled) return null;

  const hasRepo = planRepo(plan) !== null;
  const assessment = readAssessment(task.ai_assessment);
  const run = (preset: Parameters<typeof assistant.run>[0]["preset"]) =>
    assistant.run({
      preset,
      planId: plan.id,
      taskId: task.id,
      planTitle: plan.title,
      taskTitle: task.title,
    });
  const busy = context.busy || reassess.busy;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className={className} disabled={busy}>
          {busy ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />
          )}
          AI
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {assessment && (
          <>
            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
              {assessment.needs.length > 0
                ? `AI thinks this needs: ${assessment.needs.join(", ")}`
                : "AI thinks this task is clear"}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem disabled={!hasRepo} onSelect={() => void context.run([task.id])}>
          <span className="flex flex-col">
            <span>Add context from the repository</span>
            {!hasRepo && (
              <span className="text-xs text-muted-foreground">
                Connect a repository to the plan first
              </span>
            )}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("write_features")}>
          Write feature list
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("break_into_steps")}>
          Break into sub-steps
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("draft_questions")}>Draft questions</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => run("review_task")}>Review this task</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => reassess.fire({ taskId: task.id })}>
          Reassess what it needs
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Automatic mode
// ---------------------------------------------------------------------------

/** One run per page load, whichever plan is open: a cap on the AI's work, not on a plan's. */
const session: EnrichRun = { processed: 0, consecutiveErrors: 0 };
const attempted = new Set<string>();
let inFlight = false;

/** Let the screen settle before the first call, and look again now and then for new tasks. */
const INITIAL_DELAY_MS = 4_000;
const IDLE_RECHECK_MS = 20_000;

/**
 * Background mode: while a plan is open and the person has turned automation
 * on, look at tasks nobody has assessed, one at a time, a few per page load. A
 * task that needs context (and has a repository) gets it written too, in its
 * own field, never over the brief. It runs here in the browser, so it only
 * works while the plan is open: there is no server cron.
 */
export function useAutoEnrich(plan: EnrichPlan | null | undefined): {
  active: boolean;
  /** The task being looked at right now. */
  workingOn: string | null;
} {
  const aiEnabled = useAiEnabled();
  const settings = useQuery({ ...userAiSettingsQuery(), enabled: aiEnabled });
  const queryClient = useQueryClient();
  const [workingOn, setWorkingOn] = useState<string | null>(null);

  const planId = plan?.id;
  const active = aiEnabled && settings.data?.autoEnrich === true && Boolean(planId);

  // The loop reads the plan as it is when each step comes round, not as it was when it started.
  const latest = useRef(plan);
  useEffect(() => {
    latest.current = plan;
  });

  useEffect(() => {
    if (!active || !planId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (ms: number) => {
      timer = setTimeout(() => void step(), ms);
    };

    const step = async () => {
      if (cancelled) return;
      const current = latest.current;
      if (!current || !mayContinue(session)) return;
      if (inFlight) return schedule(AUTO_ENRICH_SPACING_MS);
      const next = selectNextTask(current, attempted);
      if (!next) return schedule(IDLE_RECHECK_MS);

      inFlight = true;
      attempted.add(next.id);
      setWorkingOn(next.id);
      try {
        const assessment = await assessTask({ data: { taskId: next.id } });
        if (shouldAddContext(assessment, current)) {
          await addTaskContext({ data: { taskId: next.id } });
        }
        session.consecutiveErrors = 0;
      } catch (error) {
        session.consecutiveErrors++;
        captureError(error, { scope: "assistant", label: "assistant.autoEnrich" });
      } finally {
        inFlight = false;
        session.processed++;
        if (!cancelled) setWorkingOn(null);
      }
      await queryClient.invalidateQueries({ queryKey: qk.plan(planId) });
      if (!cancelled) schedule(AUTO_ENRICH_SPACING_MS);
    };

    schedule(INITIAL_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, planId, queryClient]);

  return { active, workingOn };
}
