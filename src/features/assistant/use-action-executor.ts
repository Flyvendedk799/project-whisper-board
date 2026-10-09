import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { qk } from "@/data/keys";
import type { Action } from "@/lib/assistant-actions";
import {
  addTaskComment,
  createSection,
  createTask,
  createTaskStep,
  updateSection,
  updateTask,
} from "@/lib/planner.functions";
import {
  addTaskFeatures,
  addTaskSteps,
  answerQuestion,
  askQuestion,
} from "@/lib/plan-extras.functions";
import { AppError } from "@/lib/errors";

/**
 * Runs an assistant action through the server functions every other button
 * uses, so it happens as the signed-in person under RLS. There is no assistant
 * write path of its own: whatever the model proposed, this is the whole of what
 * it can do, and each action is a call the person could have made by hand.
 */

/** Notes the assistant writes say so, so nobody mistakes them for the person's own words. */
const COMMENT_PREFIX = "AI assistant: ";

async function run(action: Action): Promise<void> {
  switch (action.type) {
    case "create_task": {
      if (!action.planId) throw new AppError("validation", "That task has no plan to go in.");
      const { id } = await createTask({
        data: {
          planId: action.planId,
          sectionId: action.sectionId,
          title: action.title,
          description: action.description,
          status: action.status,
          priority: action.priority,
          complexity: action.complexity,
          labels: action.tags,
          color: action.color ?? undefined,
          clientTitle: action.client_title,
          clientSummary: action.client_summary,
        },
      });
      // The task exists now, so a failure after this one says so rather than hiding it.
      try {
        if (action.features?.length) {
          await addTaskFeatures({ data: { taskId: id, items: action.features, source: "ai" } });
        }
        if (action.steps?.length) {
          await addTaskSteps({
            data: { taskId: id, items: action.steps.map((text) => ({ text })), source: "ai" },
          });
        }
      } catch {
        throw new AppError(
          "partial",
          "The task was created, but its features or sub-steps could not be added.",
        );
      }
      return;
    }
    case "update_task":
      await updateTask({
        data: {
          taskId: action.taskId,
          title: action.title,
          description: action.description,
          status: action.status,
          priority: action.priority,
          complexity: action.complexity,
          labels: action.tags,
          color: action.color,
          clientTitle: action.client_title,
          clientSummary: action.client_summary,
        },
      });
      return;
    case "create_section": {
      if (!action.planId) throw new AppError("validation", "That section has no plan to go in.");
      await createSection({
        data: {
          planId: action.planId,
          title: action.title,
          description: action.description,
          goals: action.goals,
          intentions: action.intentions,
          clientSummary: action.client_summary,
          tags: action.tags,
          color: action.color ?? undefined,
        },
      });
      return;
    }
    case "update_section":
      await updateSection({
        data: {
          sectionId: action.sectionId,
          title: action.title,
          description: action.description,
          goals: action.goals,
          intentions: action.intentions,
          clientSummary: action.client_summary,
          tags: action.tags,
          color: action.color,
        },
      });
      return;
    case "add_features":
      await addTaskFeatures({ data: { taskId: action.taskId, items: action.items, source: "ai" } });
      return;
    case "add_steps":
      // Steps that come with a plain-Danish client text go one by one, because only
      // createTaskStep sets it; the rest go in a single call.
      if (action.items.some((item) => item.client_text)) {
        for (const item of action.items) {
          await createTaskStep({
            data: {
              taskId: action.taskId,
              text: item.text,
              depth: item.depth,
              featureId: action.featureId ?? null,
              clientText: item.client_text,
            },
          });
        }
        return;
      }
      await addTaskSteps({
        data: {
          taskId: action.taskId,
          items: action.items.map(({ text, depth }) => ({ text, depth })),
          featureId: action.featureId ?? null,
          source: "ai",
        },
      });
      return;
    case "ask_question":
      await askQuestion({
        data: { taskId: action.taskId, body: action.body, blocking: action.blocking ?? false },
      });
      return;
    case "answer_question":
      await answerQuestion({ data: { questionId: action.questionId, answer: action.answer } });
      return;
    case "add_comment":
      await addTaskComment({
        data: { taskId: action.taskId, body: `${COMMENT_PREFIX}${action.body}` },
      });
      return;
  }
}

export type ActionOutcome = { action: Action; error: string | null };

export function useActionExecutor() {
  const queryClient = useQueryClient();

  /** Runs one action. Throws what the server function threw. */
  const execute = useCallback((action: Action) => run(action), []);

  /** Refreshes what an action may have changed: the plan, its activity, the lists. */
  const refresh = useCallback(
    (planId?: string | null) => {
      const keys = [
        qk.planList(),
        [...qk.all, "task-comments"] as const,
        ...(planId ? [qk.plan(planId), qk.planEvents(planId)] : [qk.plans()]),
      ];
      return Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })));
    },
    [queryClient],
  );

  return { execute, refresh };
}
