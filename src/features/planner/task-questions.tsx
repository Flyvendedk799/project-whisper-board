import { useState } from "react";
import { Bot, ShieldAlert } from "lucide-react";
import type { QuestionWithPeople, TaskWithAgent } from "@/data";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { questionCounts, QUESTION_ANSWER_MAX, QUESTION_BODY_MAX } from "@/lib/plan-fields";
import { cn } from "@/lib/utils";
import { timeAgo } from "./plan-model";
import { answererOf, askerOf } from "./question-author";
import type { PlanActions } from "./use-plan-actions";

function Who({ name, agent }: { name: string; agent: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      {agent ? <Bot className="h-3 w-3" aria-hidden="true" /> : null}
      {name}
    </span>
  );
}

/** One open question: answer it, dismiss it, or change whether it blocks. */
export function OpenQuestion({
  question,
  actions,
}: {
  question: QuestionWithPeople;
  actions: PlanActions;
}) {
  const [answer, setAnswer] = useState("");
  const asker = askerOf(question);
  const submit = () => {
    const text = answer.trim();
    if (!text) return;
    actions.answer.run({ questionId: question.id, answer: text }).then(
      () => setAnswer(""),
      () => {
        // The action already told the user why.
      },
    );
  };

  return (
    <li
      className={cn(
        "flex flex-col gap-2.5 rounded-xl border bg-card p-3.5",
        question.blocking && "border-destructive/50",
      )}
    >
      <div className="flex items-start gap-2.5">
        <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-snug">
          {question.body}
        </p>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
            question.blocking
              ? "bg-destructive/15 text-destructive"
              : "bg-warning/15 text-foreground",
          )}
        >
          {question.blocking ? <ShieldAlert className="h-3 w-3" aria-hidden="true" /> : null}
          {question.blocking ? "Blocking" : "Needs an answer"}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        Asked by <Who {...asker} /> · {timeAgo(question.created_at)}
      </div>
      <Textarea
        value={answer}
        onChange={(event) => setAnswer(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
        aria-label={`Answer: ${question.body}`}
        placeholder="Write the answer…"
        maxLength={QUESTION_ANSWER_MAX}
        className="min-h-[64px] resize-y bg-background text-sm"
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={question.blocking}
            onCheckedChange={(blocking) =>
              actions.setBlocking.fire({ questionId: question.id, blocking })
            }
            aria-label="Blocks the task until answered"
          />
          Blocks the task
        </label>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          disabled={actions.dismiss.busy}
          onClick={() => actions.dismiss.fire({ questionId: question.id })}
        >
          Dismiss
        </Button>
        <Button
          type="button"
          size="sm"
          className="h-8 text-xs"
          disabled={!answer.trim() || actions.answer.busy}
          onClick={submit}
        >
          Answer
        </Button>
      </div>
    </li>
  );
}

function ResolvedQuestion({
  question,
  actions,
}: {
  question: QuestionWithPeople;
  actions: PlanActions;
}) {
  const asker = askerOf(question);
  const answerer = answererOf(question);
  const dismissed = question.status === "dismissed";
  return (
    <li className="flex flex-col gap-1.5 rounded-xl border bg-surface/60 p-3 text-sm">
      <div className="flex items-start gap-2">
        <p
          className={cn(
            "min-w-0 flex-1 whitespace-pre-wrap break-words leading-snug",
            dismissed && "text-muted-foreground line-through",
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
        <p className="whitespace-pre-wrap break-words rounded-md bg-muted/50 px-2.5 py-1.5 text-[13px] leading-snug">
          {question.answer}
        </p>
      ) : null}
      <div className="text-xs text-muted-foreground">
        <Who {...asker} /> asked · {dismissed ? "dismissed" : "answered"}
        {answerer ? (
          <>
            {" "}
            by <Who {...answerer} />
          </>
        ) : null}
        {question.answered_at ? ` · ${timeAgo(question.answered_at)}` : ""}
      </div>
    </li>
  );
}

/**
 * Questions on a task. Anybody, human or agent, can ask; each shows up as
 * needing an answer. A blocking one holds the task in Blocked until it is
 * answered or dismissed.
 */
export function TaskQuestions({ task, actions }: { task: TaskWithAgent; actions: PlanActions }) {
  const [body, setBody] = useState("");
  const [blocking, setBlocking] = useState(false);
  const questions = task.questions ?? [];
  const open = questions.filter((q) => q.status === "open");
  const resolved = questions.filter((q) => q.status !== "open");
  const counts = questionCounts(questions);

  const submit = () => {
    const text = body.trim();
    if (!text) return;
    actions.ask.run({ taskId: task.id, body: text, blocking }).then(
      () => {
        setBody("");
        setBlocking(false);
      },
      () => {
        // The action already told the user why.
      },
    );
  };

  return (
    <section className="flex flex-col gap-2.5" aria-labelledby={`questions-${task.id}`}>
      <div className="flex items-baseline gap-2.5">
        <h3 id={`questions-${task.id}`} className="font-display text-[22px] leading-none">
          Questions
        </h3>
        {counts.open > 0 ? (
          <span className="text-xs text-muted-foreground">
            {counts.open} open{counts.blocking > 0 ? `, ${counts.blocking} blocking` : ""}
          </span>
        ) : null}
      </div>

      {open.length > 0 ? (
        <ul className="flex flex-col gap-2.5">
          {open.map((question) => (
            <OpenQuestion key={question.id} question={question} actions={actions} />
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-2 rounded-xl border border-dashed p-3">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          aria-label="Ask a question"
          placeholder="Ask a question that needs an answer…"
          maxLength={QUESTION_BODY_MAX}
          className="min-h-[56px] resize-y bg-background text-sm"
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={blocking}
              onCheckedChange={setBlocking}
              aria-label="Block the task until answered"
            />
            Block the task until it is answered
          </label>
          <span className="flex-1" />
          <Button
            type="button"
            size="sm"
            className="h-8 text-xs"
            disabled={!body.trim() || actions.ask.busy}
            onClick={submit}
          >
            Ask
          </Button>
        </div>
      </div>

      {resolved.length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
            {resolved.length} resolved
          </summary>
          <ul className="mt-2 flex flex-col gap-2">
            {resolved.map((question) => (
              <ResolvedQuestion key={question.id} question={question} actions={actions} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
