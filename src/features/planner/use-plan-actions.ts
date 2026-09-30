import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { qk } from "@/data/keys";
import type {
  PlanTaskComplexity,
  PlanTaskPriority,
  PlanTaskStatus,
  PlanWithSections,
  TaskWithAgent,
} from "@/data";
import { useServerAction } from "@/lib/use-server-action";
import {
  convertDescriptionToSteps,
  createSection,
  createTask,
  createTaskStep,
  deleteSection,
  deleteTask,
  deleteTaskStep,
  moveTaskTo,
  releaseTaskAgent,
  updateSection,
  updateTask,
  updateTaskStep,
} from "@/lib/planner.functions";
import {
  applyTaskMove,
  locateTask,
  nextStatus,
  patchTaskInPlan,
  STATUS_STYLE,
  taskHeadline,
  tasksOf,
} from "./plan-model";

type PlanData = { plan: unknown } | undefined;

/** The fields of a task that the screen edits through `updateTask`. */
export type TaskFields = Partial<{
  title: string;
  description: string;
  status: PlanTaskStatus;
  priority: PlanTaskPriority;
  complexity: PlanTaskComplexity | null;
  branchName: string;
  assignedUserId: string | null;
  ticketId: string | null;
}>;

/** How long "Undo" stays on screen, and how long a delete waits before it is real. */
export const UNDO_MS = 5000;

/**
 * Every write the plan screen makes.
 *
 * Status changes, moves and step ticks update the cache first so the board
 * responds at once; the server call then refetches the truth, and a failure
 * refetches too, which is the rollback. Deleting a task is deferred for the
 * length of the Undo toast, because restoring a deleted row would lose its
 * notes and files.
 */
export function usePlanActions(planId: string) {
  const queryClient = useQueryClient();
  const refresh = [qk.plan(planId), qk.planEvents(planId)] as const;
  const rollback = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.plan(planId) });
  }, [queryClient, planId]);

  const setPlan = useCallback(
    (change: (plan: PlanWithSections) => PlanWithSections) => {
      queryClient.setQueryData<PlanData>(qk.plan(planId), (old) =>
        old ? { ...old, plan: change(old.plan as unknown as PlanWithSections) } : old,
      );
    },
    [queryClient, planId],
  );

  const currentPlan = useCallback(
    () =>
      (queryClient.getQueryData<PlanData>(qk.plan(planId))?.plan ??
        null) as PlanWithSections | null,
    [queryClient, planId],
  );

  const create = useServerAction(useServerFn(createTask), {
    label: "tasks.create",
    invalidate: refresh,
  });
  const update = useServerAction(useServerFn(updateTask), {
    label: "tasks.update",
    invalidate: refresh,
    onError: rollback,
  });
  const move = useServerAction(useServerFn(moveTaskTo), {
    label: "tasks.moveTo",
    invalidate: refresh,
    onError: rollback,
  });
  const remove = useServerAction(useServerFn(deleteTask), {
    label: "tasks.delete",
    invalidate: [qk.plan(planId), qk.planEvents(planId), qk.planAttachments(planId)],
  });
  const release = useServerAction(useServerFn(releaseTaskAgent), {
    label: "tasks.releaseAgent",
    success: "Agent released",
    invalidate: refresh,
  });
  const addSection = useServerAction(useServerFn(createSection), {
    label: "sections.create",
    success: "Section added",
    invalidate: refresh,
  });
  const editSection = useServerAction(useServerFn(updateSection), {
    label: "sections.update",
    invalidate: refresh,
  });
  const removeSection = useServerAction(useServerFn(deleteSection), {
    label: "sections.delete",
    success: "Section deleted",
    invalidate: refresh,
  });
  const addStep = useServerAction(useServerFn(createTaskStep), {
    label: "steps.create",
    invalidate: [qk.plan(planId)],
  });
  const editStep = useServerAction(useServerFn(updateTaskStep), {
    label: "steps.update",
    invalidate: [qk.plan(planId)],
    onError: rollback,
  });
  const removeStep = useServerAction(useServerFn(deleteTaskStep), {
    label: "steps.delete",
    invalidate: [qk.plan(planId)],
    onError: rollback,
  });
  const convert = useServerAction(useServerFn(convertDescriptionToSteps), {
    label: "steps.fromDescription",
    success: (result) =>
      result.created > 0
        ? `Made ${result.created} sub-step${result.created === 1 ? "" : "s"}`
        : "Nothing to convert",
    invalidate: [qk.plan(planId)],
  });

  // ----- Tasks ------------------------------------------------------------

  const setStatus = useCallback(
    (task: TaskWithAgent, status: PlanTaskStatus) => {
      if (task.status === status) return;
      void queryClient.cancelQueries({ queryKey: qk.plan(planId) });
      setPlan((plan) =>
        patchTaskInPlan(plan, task.id, {
          status,
          ...(status === "done" ? { completed_at: new Date().toISOString() } : {}),
        }),
      );
      update.fire({ taskId: task.id, status });
    },
    [queryClient, planId, setPlan, update],
  );

  const advance = useCallback(
    (task: TaskWithAgent) => setStatus(task, nextStatus(task.status)),
    [setStatus],
  );

  /** Edits that show up in the cache straight away (priority, size, assignee). */
  const patchTask = useCallback(
    (task: TaskWithAgent, fields: TaskFields, optimistic: Partial<TaskWithAgent> = {}) => {
      void queryClient.cancelQueries({ queryKey: qk.plan(planId) });
      if (Object.keys(optimistic).length > 0) {
        setPlan((plan) => patchTaskInPlan(plan, task.id, optimistic));
      }
      update.fire({ taskId: task.id, ...fields });
    },
    [queryClient, planId, setPlan, update],
  );

  const moveTask = useCallback(
    (taskId: string, sectionId: string, beforeId?: string | null) => {
      const plan = currentPlan();
      const task = plan ? tasksOf(plan).find((t) => t.id === taskId) : null;
      const from = plan ? locateTask(plan, taskId) : null;
      if (!plan || !task || !from) return;
      if (from.sectionId === sectionId && (beforeId === taskId || beforeId === from.beforeId)) {
        return;
      }
      if (from.sectionId === sectionId && !beforeId && from.beforeId === null) return;

      void queryClient.cancelQueries({ queryKey: qk.plan(planId) });
      setPlan((p) => applyTaskMove(p, taskId, sectionId, beforeId));
      move.fire({ taskId, sectionId, beforeTaskId: beforeId ?? null });

      if (from.sectionId !== sectionId) {
        const target = plan.sections.find((s) => s.id === sectionId)?.title ?? "section";
        toast(`Moved to ${target}`, {
          duration: UNDO_MS,
          action: {
            label: "Undo",
            onClick: () => {
              setPlan((p) => applyTaskMove(p, taskId, from.sectionId, from.beforeId));
              move.fire({ taskId, sectionId: from.sectionId, beforeTaskId: from.beforeId });
            },
          },
        });
      }
    },
    [currentPlan, queryClient, planId, setPlan, move],
  );

  /** Tasks waiting out their Undo window; the screen hides them meanwhile. */
  const [pendingDelete, setPendingDelete] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const removeRef = useRef(remove);
  removeRef.current = remove;

  const commitDelete = useCallback((taskId: string) => {
    const timer = timers.current.get(taskId);
    if (timer) clearTimeout(timer);
    timers.current.delete(taskId);
    removeRef.current.fire({ taskId });
    setPendingDelete((current) => {
      const next = new Set(current);
      next.delete(taskId);
      return next;
    });
  }, []);

  const deleteWithUndo = useCallback(
    (task: TaskWithAgent) => {
      setPendingDelete((current) => new Set(current).add(task.id));
      timers.current.set(
        task.id,
        setTimeout(() => commitDelete(task.id), UNDO_MS + 400),
      );
      toast(`Deleted "${taskHeadline(task.title)}"`, {
        duration: UNDO_MS,
        action: {
          label: "Undo",
          onClick: () => {
            const timer = timers.current.get(task.id);
            if (timer) clearTimeout(timer);
            timers.current.delete(task.id);
            setPendingDelete((current) => {
              const next = new Set(current);
              next.delete(task.id);
              return next;
            });
          },
        },
      });
    },
    [commitDelete],
  );

  // Leaving the screen makes every pending delete real; nobody can undo it any more.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of [...pending.keys()]) {
        const timer = pending.get(id);
        if (timer) clearTimeout(timer);
        pending.delete(id);
        removeRef.current.fire({ taskId: id });
      }
    };
  }, []);

  // ----- Steps ------------------------------------------------------------

  const toggleStep = useCallback(
    (taskId: string, stepId: string, done: boolean) => {
      void queryClient.cancelQueries({ queryKey: qk.plan(planId) });
      setPlan((plan) => {
        const task = tasksOf(plan).find((t) => t.id === taskId);
        return patchTaskInPlan(plan, taskId, {
          steps: (task?.steps ?? []).map((s) => (s.id === stepId ? { ...s, done } : s)),
        });
      });
      editStep.fire({ stepId, done });
    },
    [queryClient, planId, setPlan, editStep],
  );

  const deleteStepNow = useCallback(
    (taskId: string, stepId: string) => {
      void queryClient.cancelQueries({ queryKey: qk.plan(planId) });
      setPlan((plan) => {
        const task = tasksOf(plan).find((t) => t.id === taskId);
        return patchTaskInPlan(plan, taskId, {
          steps: (task?.steps ?? []).filter((s) => s.id !== stepId),
        });
      });
      removeStep.fire({ stepId });
    },
    [queryClient, planId, setPlan, removeStep],
  );

  return {
    create,
    update,
    setStatus,
    advance,
    patchTask,
    moveTask,
    deleteWithUndo,
    pendingDelete,
    release,
    addSection,
    editSection,
    removeSection,
    addStep,
    editStep,
    toggleStep,
    deleteStep: deleteStepNow,
    convert,
    statusLabel: (status: PlanTaskStatus) => STATUS_STYLE[status].label,
  };
}

export type PlanActions = ReturnType<typeof usePlanActions>;
