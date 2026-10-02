import { useMemo, useState } from "react";
import type { PlanWithSections, QuestionWithPeople, TaskWithAgent } from "@/data";
import { cn } from "@/lib/utils";
import { sectionColor, sortedTasks, taskHeadline } from "./plan-model";
import { answererOf, askerOf } from "./question-author";
import { OpenQuestion } from "./task-questions";
import type { PlanActions } from "./use-plan-actions";
import { timeAgo } from "./plan-model";

type Entry = {
  question: QuestionWithPeople;
  task: TaskWithAgent;
  sectionTitle: string;
  color: string;
};

/**
 * Every question on the plan in one list, open ones first, so nobody has to
 * open task after task to find what is waiting for them. Blocking questions
 * come before the ones that only want an answer.
 */
export function PlanQuestionsView({
  plan,
  actions,
  onOpenTask,
}: {
  plan: PlanWithSections;
  actions: PlanActions;
  onOpenTask: (taskId: string) => void;
}) {
  const [show, setShow] = useState<"open" | "resolved">("open");

  const entries = useMemo(() => {
    const list: Entry[] = [];
    plan.sections.forEach((section, index) => {
      for (const task of sortedTasks(section.tasks ?? [])) {
        for (const question of task.questions ?? []) {
          list.push({
            question,
            task,
            sectionTitle: section.title,
            color: sectionColor(section.color, index),
          });
        }
      }
    });
    return list;
  }, [plan]);

  const open = entries
    .filter((entry) => entry.question.status === "open")
    .sort(
      (a, b) =>
        Number(b.question.blocking) - Number(a.question.blocking) ||
        a.question.created_at.localeCompare(b.question.created_at),
    );
  const resolved = entries
    .filter((entry) => entry.question.status !== "open")
    .sort((a, b) => b.question.updated_at.localeCompare(a.question.updated_at));
  const shown = show === "open" ? open : resolved;

  return (
    <div className="min-h-0 flex-1 overflow-auto px-4 py-5 md:px-8">
      <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4">
        <div className="flex items-center gap-2" role="group" aria-label="Question status">
          {(["open", "resolved"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={show === value}
              onClick={() => setShow(value)}
              className={cn(
                "h-[30px] rounded-full border px-3 text-xs",
                show === value ? "border-primary bg-accent" : "bg-card hover:bg-muted/60",
              )}
            >
              {value === "open"
                ? `Needs an answer (${open.length})`
                : `Resolved (${resolved.length})`}
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
            {show === "open"
              ? "Nothing is waiting for an answer."
              : "No question has been answered yet."}
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {shown.map(({ question, task, sectionTitle, color }) => (
              <li key={question.id} className="flex flex-col gap-1.5">
                <button
                  type="button"
                  onClick={() => onOpenTask(task.id)}
                  className="flex items-center gap-2 self-start rounded text-left text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  {sectionTitle} · {taskHeadline(task.title)}
                </button>
                {question.status === "open" ? (
                  <ul>
                    <OpenQuestion question={question} actions={actions} />
                  </ul>
                ) : (
                  <ResolvedLine question={question} actions={actions} />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function ResolvedLine({
  question,
  actions,
}: {
  question: QuestionWithPeople;
  actions: PlanActions;
}) {
  const asker = askerOf(question);
  const answerer = answererOf(question);
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border bg-surface/60 p-3 text-sm">
      <div className="flex items-start gap-2">
        <p
          className={cn(
            "min-w-0 flex-1 whitespace-pre-wrap break-words",
            question.status === "dismissed" && "text-muted-foreground line-through",
          )}
        >
          {question.body}
        </p>
        <button
          type="button"
          className="shrink-0 text-xs text-primary hover:underline"
          onClick={() => actions.dismiss.fire({ questionId: question.id, reopen: true })}
        >
          Reopen
        </button>
      </div>
      {question.answer ? (
        <p className="whitespace-pre-wrap break-words rounded-md bg-muted/50 px-2.5 py-1.5 text-[13px]">
          {question.answer}
        </p>
      ) : null}
      <div className="text-xs text-muted-foreground">
        {asker.name} asked · {question.status}
        {answerer ? ` by ${answerer.name}` : ""}
        {question.answered_at ? ` · ${timeAgo(question.answered_at)}` : ""}
      </div>
    </div>
  );
}
