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
  reorderSections,
  updateSection,
  updateTask,
  updateTaskStep,
} from "@/lib/planner.functions";
import {
  addTaskFeatures,
  addTaskSteps,
  answerQuestion,
  askQuestion,
  deleteQuestion,
  deleteTaskFeature,
  dismissQuestion,
  reorderTaskFeatures,
  reorderTaskSteps,
  setQuestionAudience,
  setQuestionBlocking,
  setStepFeature,
  updateTaskFeature,
} from "@/lib/plan-extras.functions";
import {
  applySectionMove,
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
  labels: string[];
  color: string | null;
  aiContext: string | null;
  /** The client layer: plain Danish wording a client sees. */
  clientTitle: string | null;
  clientSummary: string | null;
}>;

/** `ids` with the entry at `from` moved by `delta` places; the same array when it cannot move. */
export function shiftId(ids: readonly string[], id: string, delta: number): string[] {
  const at = ids.indexOf(id);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  next.splice(at, 1);
  next.splice(to, 0, id);
  return next;
}

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
  const reorderSec = useServerAction(useServerFn(reorderSections), {
    label: "sections.reorder",
    invalidate: refresh,
    onError: rollback,
  });
  const ask = useServerAction(useServerFn(askQuestion), {
    label: "questions.ask",
    success: (
      _result: unknown,
      input: {
        taskId: string;
        body: string;
        blocking?: boolean;
        audience?: "agency" | "agent" | "client";
        clientBody?: string;
      },
    ) =>
      input.blocking
        ? "Question asked. The task is blocked until it is answered"
        : input.audience === "client"
          ? "Question sent to the client"
          : "Question asked",
    invalidate: refresh,
  });
  const answer = useServerAction(useServerFn(answerQuestion), {
    label: "questions.answer",
    success: "Answer saved",
    invalidate: refresh,
  });
  const dismiss = useServerAction(useServerFn(dismissQuestion), {
    label: "questions.dismiss",
    invalidate: refresh,
  });
  const setAudience = useServerAction(useServerFn(setQuestionAudience), {
    label: "questions.setAudience",
    success: (
      _result: unknown,
      input: {
        questionId: string;
        audience: "agency" | "agent" | "client";
        clientBody?: string;
      },
    ) =>
      input.audience === "client"
        ? "Sent to the client"
        : input.audience === "agent"
          ? "Handed to the agents"
          : "Back with the agency",
    invalidate: refresh,
  });
  const setBlocking = useServerAction(useServerFn(setQuestionBlocking), {
    label: "questions.setBlocking",
    invalidate: refresh,
  });
  const removeQuestion = useServerAction(useServerFn(deleteQuestion), {
    label: "questions.delete",
    invalidate: refresh,
  });
  const addFeatures = useServerAction(useServerFn(addTaskFeatures), {
    label: "features.add",
    success: (result) =>
      result.created > 1 ? `Added ${result.created} features` : "Feature added",
    invalidate: [qk.plan(planId)],
  });
  const editFeature = useServerAction(useServerFn(updateTaskFeature), {
    label: "features.update",
    invalidate: [qk.plan(planId)],
    onError: rollback,
  });
  const removeFeature = useServerAction(useServerFn(deleteTaskFeature), {
    label: "features.delete",
    invalidate: [qk.plan(planId)],
    onError: rollback,
  });
  const reorderFeatures = useServerAction(useServerFn(reorderTaskFeatures), {
    label: "features.reorder",
    invalidate: [qk.plan(planId)],
    onError: rollback,
  });
  const addSteps = useServerAction(useServerFn(addTaskSteps), {
    label: "steps.addMany",
    success: (result) => (result.created > 1 ? `Added ${result.created} sub-steps` : ""),
    invalidate: [qk.plan(planId)],
  });
  const linkStep = useServerAction(useServerFn(setStepFeature), {
    label: "steps.setFeature",
    invalidate: [qk.plan(planId)],
    onError: rollback,
  });
  const reorderSteps = useServerAction(useServerFn(reorderTaskSteps), {
    label: "steps.reorder",
    invalidate: [qk.plan(planId)],
    onError: rollback,
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

  // ----- Sections ---------------------------------------------------------

  /** Drop a section before another (or last). Optimistic; the server renumbers. */
  const moveSection = useCallback(
    (sectionId: string, beforeId?: string | null) => {
      const plan = currentPlan();
      if (!plan || sectionId === beforeId) return;
      const next = applySectionMove(plan, sectionId, beforeId);
      const before = plan.sections.map((s) => s.id).join();
      const after = next.sections.map((s) => s.id).join();
      if (before === after) return;
      void queryClient.cancelQueries({ queryKey: qk.plan(planId) });
      setPlan(() => next);
      reorderSec.fire({ planId, order: next.sections.map((s) => s.id) });
    },
    [currentPlan, queryClient, planId, setPlan, reorderSec],
  );

  /** One place left or right, for the keyboard and the section menu. */
  const shiftSection = useCallback(
    (sectionId: string, delta: -1 | 1) => {
      const plan = currentPlan();
      if (!plan) return;
      const ids = plan.sections.map((s) => s.id);
      const at = ids.indexOf(sectionId);
      if (at < 0 || at + delta < 0 || at + delta >= ids.length) return;
      // Dropping before the neighbour two places on (or last) lands one place along.
      moveSection(sectionId, delta === -1 ? ids[at - 1] : (ids[at + 2] ?? null));
    },
    [currentPlan, moveSection],
  );

  // ----- Features ---------------------------------------------------------

  const toggleFeature = useCallback(
    (taskId: string, featureId: string, met: boolean) => {
      void queryClient.cancelQueries({ queryKey: qk.plan(planId) });
      setPlan((plan) => {
        const task = tasksOf(plan).find((t) => t.id === taskId);
        return patchTaskInPlan(plan, taskId, {
          features: (task?.features ?? []).map((f) => (f.id === featureId ? { ...f, met } : f)),
        });
      });
      editFeature.fire({ featureId, met });
    },
    [queryClient, planId, setPlan, editFeature],
  );

  const deleteFeatureNow = useCallback(
    (taskId: string, featureId: string) => {
      void queryClient.cancelQueries({ queryKey: qk.plan(planId) });
      setPlan((plan) => {
        const task = tasksOf(plan).find((t) => t.id === taskId);
        return patchTaskInPlan(plan, taskId, {
          features: (task?.features ?? []).filter((f) => f.id !== featureId),
          steps: (task?.steps ?? []).map((st) =>
            st.feature_id === featureId ? { ...st, feature_id: null } : st,
          ),
        });
      });
      removeFeature.fire({ featureId });
    },
    [queryClient, planId, setPlan, removeFeature],
  );

  const shiftFeature = useCallback(
    (taskId: string, featureId: string, delta: -1 | 1) => {
      const plan = currentPlan();
      const task = plan ? tasksOf(plan).find((t) => t.id === taskId) : null;
      if (!task) return;
      const list = task.features ?? [];
      const order = shiftId(
        list.map((f) => f.id),
        featureId,
        delta,
      );
      if (order.join() === list.map((f) => f.id).join()) return;
      const byId = new Map(list.map((f) => [f.id, f] as const));
      void queryClient.cancelQueries({ queryKey: qk.plan(planId) });
      setPlan((p) =>
        patchTaskInPlan(p, taskId, {
          features: order.map((id, index) => ({ ...byId.get(id)!, position: index + 1 })),
        }),
      );
      reorderFeatures.fire({ taskId, order });
    },
    [currentPlan, queryClient, planId, setPlan, reorderFeatures],
  );

  // ----- More step operations ---------------------------------------------

  const shiftStep = useCallback(
    (taskId: string, stepId: string, delta: -1 | 1) => {
      const plan = currentPlan();
      const task = plan ? tasksOf(plan).find((t) => t.id === taskId) : null;
      if (!task) return;
      const list = task.steps ?? [];
      const order = shiftId(
        list.map((st) => st.id),
        stepId,
        delta,
      );
      if (order.join() === list.map((st) => st.id).join()) return;
      const byId = new Map(list.map((st) => [st.id, st] as const));
      void queryClient.cancelQueries({ queryKey: qk.plan(planId) });
      setPlan((p) =>
        patchTaskInPlan(p, taskId, {
          steps: order.map((id, index) => ({ ...byId.get(id)!, position: index + 1 })),
        }),
      );
      reorderSteps.fire({ taskId, order });
    },
    [currentPlan, queryClient, planId, setPlan, reorderSteps],
  );

  const setStepDepth = useCallback(
    (taskId: string, stepId: string, depth: number) => {
      void queryClient.cancelQueries({ queryKey: qk.plan(planId) });
      setPlan((plan) => {
        const task = tasksOf(plan).find((t) => t.id === taskId);
        return patchTaskInPlan(plan, taskId, {
          steps: (task?.steps ?? []).map((st) => (st.id === stepId ? { ...st, depth } : st)),
        });
      });
      editStep.fire({ stepId, depth });
    },
    [queryClient, planId, setPlan, editStep],
  );

  const setStepFeatureLink = useCallback(
    (taskId: string, stepId: string, featureId: string | null) => {
      void queryClient.cancelQueries({ queryKey: qk.plan(planId) });
      setPlan((plan) => {
        const task = tasksOf(plan).find((t) => t.id === taskId);
        return patchTaskInPlan(plan, taskId, {
          steps: (task?.steps ?? []).map((st) =>
            st.id === stepId ? { ...st, feature_id: featureId } : st,
          ),
        });
      });
      linkStep.fire({ stepId, featureId });
    },
    [queryClient, planId, setPlan, linkStep],
  );

  return {
    create,
    update,
    ask,
    answer,
    dismiss,
    setAudience,
    setBlocking,
    removeQuestion,
    addFeatures,
    editFeature,
    toggleFeature,
    deleteFeature: deleteFeatureNow,
    shiftFeature,
    addSteps,
    shiftStep,
    setStepDepth,
    linkStep: setStepFeatureLink,
    moveSection,
    shiftSection,
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
