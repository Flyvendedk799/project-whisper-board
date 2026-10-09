import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Check, ChevronDown, MessageSquare, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { QueryState } from "@/components/query-state";
import { ProgressBar, StatusPill, type Tone } from "@/components/status-pill";
import { PersonAvatar } from "@/components/person-avatar";
import { useAuth } from "@/components/auth-provider";
import { clientPlanQuery } from "@/data/planner";
import { qk } from "@/data/keys";
import {
  addPlanComment,
  deletePlanComment,
  setSectionApproval,
  setSectionClientSummary,
} from "@/lib/plan-client-view.functions";
import {
  CLIENT_COMMENT_MAX,
  CLIENT_SUMMARY_MAX,
  CLIENT_TASK_STATUS_DA,
  formatRelativeDa,
  overallProgress,
  personName,
  planStatusDa,
  sectionPercent,
  sectionStatusDa,
  type ClientApproval,
  type ClientComment,
  type ClientSection,
  type ClientTask,
  type ClientTaskStatus,
} from "@/lib/plan-client-view";
import { cn } from "@/lib/utils";
import { useServerAction } from "@/lib/use-server-action";
import { sectionColor } from "./plan-model";

const TASK_TONE: Record<ClientTaskStatus, Tone> = {
  todo: "default",
  in_progress: "info",
  waiting: "warning",
  done: "success",
};

/**
 * A plan as its clients see it, in the same columns as the agency's board: one
 * column per section, with the section's plain-language summary and progress on
 * top and its tasks as cards underneath. A card opens to show its steps. All of
 * it is the client's own wording; none of the agency's tasks, notes or technical
 * detail appear here, and a task or step without client wording is not shown.
 *
 * The agency opens the same screen as a preview ("View client view"), so what
 * they write is what the client reads.
 */
export function ClientPlanScreen({
  planId,
  preview = false,
  backHref,
}: {
  planId: string;
  /** The agency looking at what the client sees. */
  preview?: boolean;
  backHref?: { label: string; onClick: () => void };
}) {
  const query = useQuery(clientPlanQuery(planId));
  const unwritten =
    query.data?.plan.sections.reduce((sum, section) => sum + section.unwritten_task_count, 0) ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {preview ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-accent px-4 py-2.5 text-[13px] md:px-8">
          <span>
            <strong className="font-medium">Client view.</strong> This is what your client sees.
            Their comments and approvals show up here.
            {unwritten > 0
              ? ` ${unwritten} ${unwritten === 1 ? "task is" : "tasks are"} hidden because ${unwritten === 1 ? "it has" : "they have"} no client title yet: add one under “For the client” on the task.`
              : ""}
          </span>
          {backHref ? (
            <Button type="button" size="sm" variant="outline" onClick={backHref.onClick}>
              {backHref.label}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="w-full px-4 py-6 md:px-8 md:py-10">
        <QueryState query={query} errorTitle="Kunne ikke hente planen">
          {({ plan, comments, approvals }) => {
            const overall = overallProgress(plan.sections);
            const planComments = comments.filter((comment) => comment.section_id === null);
            return (
              <div className="space-y-8">
                <header className="max-w-3xl space-y-4">
                  {!preview ? (
                    <Link
                      to="/app/planner"
                      className="text-[13px] text-muted-foreground hover:text-foreground"
                    >
                      ← Planer
                    </Link>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3">
                    <h1 className="font-display text-[34px] font-normal leading-[1.1] tracking-[-0.01em] max-md:text-[28px]">
                      {plan.title}
                    </h1>
                    <StatusPill tone={plan.status === "completed" ? "success" : "info"}>
                      {planStatusDa(plan.status)}
                    </StatusPill>
                  </div>
                  <div className="space-y-2 rounded-2xl border bg-card p-4 md:p-5">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="font-display text-[32px] leading-none">
                        {overall.percent}%
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {overall.total === 0
                          ? "Planen er under udarbejdelse"
                          : `${overall.done} af ${overall.total} opgaver færdige`}
                      </span>
                    </div>
                    <ProgressBar value={overall.percent} label="Samlet fremdrift" />
                  </div>
                </header>

                {plan.sections.length === 0 ? (
                  <Card className="max-w-3xl p-6 text-center text-sm text-muted-foreground">
                    Planen er endnu ikke delt op i afsnit. Kig tilbage snart.
                  </Card>
                ) : (
                  <ol
                    aria-label="Planens afsnit"
                    className="-mx-4 flex snap-x snap-proximity items-start gap-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8"
                  >
                    {plan.sections.map((section, index) => (
                      <SectionColumn
                        key={section.id}
                        planId={plan.id}
                        section={section}
                        index={index}
                        comments={comments.filter((comment) => comment.section_id === section.id)}
                        approvals={approvals.filter(
                          (approval) => approval.section_id === section.id,
                        )}
                        preview={preview}
                      />
                    ))}
                  </ol>
                )}

                <section aria-labelledby="plan-comments" className="max-w-3xl space-y-3">
                  <h2 id="plan-comments" className="font-display text-2xl">
                    Kommentarer til hele planen
                  </h2>
                  <CommentThread planId={plan.id} sectionId={null} comments={planComments} />
                </section>
              </div>
            );
          }}
        </QueryState>
      </div>
    </div>
  );
}

function SectionColumn({
  planId,
  section,
  index,
  comments,
  approvals,
  preview,
}: {
  planId: string;
  section: ClientSection;
  index: number;
  comments: ClientComment[];
  approvals: ClientApproval[];
  preview: boolean;
}) {
  const { user } = useAuth();
  const [open, setOpen] = useState(comments.length > 0);
  const [editing, setEditing] = useState(false);
  const color = sectionColor(section.color, index);
  const percent = sectionPercent(section);
  const status = sectionStatusDa(section);
  const approvedByMe = approvals.some((approval) => approval.user_id === user?.id);

  const approve = useServerAction(useServerFn(setSectionApproval), {
    label: "clientPlan.approve",
    invalidate: [qk.plan(planId)],
  });

  return (
    <li className="w-[min(88vw,340px)] shrink-0 snap-start">
      <Card className="overflow-hidden">
        <div className="h-1" style={{ backgroundColor: color }} aria-hidden="true" />
        <div className="space-y-4 p-4">
          <div className="space-y-2">
            <div className="flex items-start justify-between gap-2">
              <span className="font-display text-lg text-muted-foreground">
                {String(index + 1).padStart(2, "0")}
              </span>
              <StatusPill
                tone={status === "Færdig" ? "success" : status === "I gang" ? "info" : "default"}
              >
                {status}
              </StatusPill>
            </div>
            <h2 className="break-words font-display text-[22px] leading-tight">{section.title}</h2>
          </div>

          {editing ? (
            <SummaryEditor planId={planId} section={section} onDone={() => setEditing(false)} />
          ) : (
            <div>
              {section.client_summary ? (
                <p className="whitespace-pre-line break-words text-sm leading-relaxed">
                  {section.client_summary}
                </p>
              ) : (
                <p className="text-sm italic text-muted-foreground">
                  {preview
                    ? "Ingen opsummering endnu. Skriv en kort, letforståelig tekst til kunden."
                    : "Beskrivelsen af dette afsnit følger snart."}
                </p>
              )}
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="mt-1.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-9"
              >
                <Pencil className="h-3 w-3" aria-hidden="true" />
                {section.client_summary ? "Ret teksten" : "Skriv en tekst"}
              </button>
            </div>
          )}

          <div className="space-y-1.5">
            <ProgressBar value={percent} label={`${section.title}: fremdrift`} />
            <p className="text-xs text-muted-foreground">
              {section.task_count === 0
                ? "Ingen opgaver endnu"
                : `${section.done_task_count} af ${section.task_count} opgaver færdige · ${percent}%`}
            </p>
          </div>

          {section.tasks.length > 0 ? (
            <ul className="space-y-2" aria-label={`Opgaver i ${section.title}`}>
              {section.tasks.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </ul>
          ) : section.task_count > 0 ? (
            <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              Opgaverne i dette afsnit bliver beskrevet her, så snart de er klar.
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button
              type="button"
              size="sm"
              variant={approvedByMe ? "secondary" : "outline"}
              disabled={approve.busy}
              aria-pressed={approvedByMe}
              onClick={() =>
                approve.fire({ planId, sectionId: section.id, approved: !approvedByMe })
              }
              className="max-md:min-h-10"
            >
              <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {approvedByMe ? "Godkendt af dig" : "Godkend"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="max-md:min-h-10"
            >
              <MessageSquare className="mr-1.5 h-4 w-4" aria-hidden="true" />
              {comments.length === 0
                ? "Kommentar"
                : `${comments.length} ${comments.length === 1 ? "kommentar" : "kommentarer"}`}
            </Button>
            {approvals.length > 0 ? (
              <span className="w-full text-xs text-muted-foreground">
                Godkendt af{" "}
                {approvals.map((approval) => personName(approval.user, "en bruger")).join(", ")}
              </span>
            ) : null}
          </div>

          {open ? (
            <CommentThread planId={planId} sectionId={section.id} comments={comments} />
          ) : null}
        </div>
      </Card>
    </li>
  );
}

/** One task in plain words. Opens to its summary and steps. */
function TaskCard({ task }: { task: ClientTask }) {
  const [open, setOpen] = useState(false);
  const expandable = Boolean(task.summary) || task.steps.length > 0;
  const doneSteps = task.steps.filter((step) => step.done).length;

  return (
    <li className="rounded-xl border bg-card">
      <button
        type="button"
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "flex w-full items-start gap-2 rounded-xl p-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          expandable && "hover:bg-muted/40 max-md:min-h-11",
        )}
      >
        <span className="min-w-0 flex-1 space-y-1.5">
          <span
            className={cn(
              "block break-words text-sm font-medium leading-snug",
              task.status === "done" && "text-muted-foreground line-through decoration-1",
            )}
          >
            {task.title}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusPill tone={TASK_TONE[task.status]}>
              {CLIENT_TASK_STATUS_DA[task.status]}
            </StatusPill>
            {task.steps.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {doneSteps} af {task.steps.length}
              </span>
            ) : null}
          </span>
        </span>
        {expandable ? (
          <ChevronDown
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
            aria-hidden="true"
          />
        ) : null}
      </button>
      {open ? (
        <div className="space-y-2.5 border-t px-3 py-3">
          {task.summary ? (
            <p className="whitespace-pre-line break-words text-[13px] leading-relaxed text-muted-foreground">
              {task.summary}
            </p>
          ) : null}
          {task.steps.length > 0 ? (
            <ul className="space-y-1.5">
              {task.steps.map((step) => (
                <li key={step.id} className="flex items-start gap-2 text-[13px]">
                  <span
                    className={cn(
                      "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      step.done
                        ? "border-success bg-success/15 text-success"
                        : "border-muted-foreground/40",
                    )}
                    aria-hidden="true"
                  >
                    {step.done ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span className={cn("min-w-0 break-words", step.done && "text-muted-foreground")}>
                    <span className="sr-only">{step.done ? "Færdig: " : "Mangler: "}</span>
                    {step.text}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function SummaryEditor({
  planId,
  section,
  onDone,
}: {
  planId: string;
  section: ClientSection;
  onDone: () => void;
}) {
  const [text, setText] = useState(section.client_summary ?? "");
  const save = useServerAction(useServerFn(setSectionClientSummary), {
    label: "clientPlan.setSummary",
    success: "Teksten er gemt",
    invalidate: [qk.plan(planId)],
    onSuccess: onDone,
  });

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        save.fire({ sectionId: section.id, summary: text });
      }}
    >
      <Textarea
        autoFocus
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={4}
        maxLength={CLIENT_SUMMARY_MAX}
        aria-label={`Tekst til ${section.title}`}
        placeholder="Kort og letforståeligt: hvad sker der her, og hvor er vi?"
        className="resize-y text-sm"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.busy}>
          {save.busy ? "Gemmer…" : "Gem"}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={save.busy} onClick={onDone}>
          Annuller
        </Button>
      </div>
    </form>
  );
}

function CommentThread({
  planId,
  sectionId,
  comments,
}: {
  planId: string;
  sectionId: string | null;
  comments: ClientComment[];
}) {
  const { user } = useAuth();
  const [body, setBody] = useState("");
  const add = useServerAction(useServerFn(addPlanComment), {
    label: "clientPlan.comment",
    invalidate: [qk.plan(planId)],
    onSuccess: () => setBody(""),
  });
  const remove = useServerAction(useServerFn(deletePlanComment), {
    label: "clientPlan.deleteComment",
    invalidate: [qk.plan(planId)],
  });

  const send = () => {
    if (!body.trim() || add.busy) return;
    add.fire({ planId, sectionId, body });
  };

  return (
    <div className="space-y-3 border-t pt-4">
      {comments.length > 0 ? (
        <ul className="space-y-3">
          {comments.map((comment) => (
            <li key={comment.id} className="flex gap-3">
              <PersonAvatar person={comment.author} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">{personName(comment.author)}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeDa(comment.created_at)}
                  </span>
                  {comment.author?.id === user?.id ? (
                    <button
                      type="button"
                      disabled={remove.busy}
                      onClick={() => remove.fire({ commentId: comment.id })}
                      className="text-xs text-muted-foreground underline-offset-2 hover:text-destructive hover:underline max-md:min-h-9"
                    >
                      Slet
                    </button>
                  ) : null}
                </div>
                <p className="whitespace-pre-line break-words text-sm">{comment.body}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Ingen kommentarer endnu.</p>
      )}
      <div className="space-y-2">
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              send();
            }
          }}
          rows={2}
          maxLength={CLIENT_COMMENT_MAX}
          aria-label={
            sectionId ? "Skriv en kommentar til afsnittet" : "Skriv en kommentar til planen"
          }
          placeholder="Skriv en kommentar eller et spørgsmål…"
          className="resize-y text-sm"
        />
        <Button type="button" size="sm" disabled={add.busy || !body.trim()} onClick={send}>
          {add.busy ? "Sender…" : "Send"}
        </Button>
      </div>
    </div>
  );
}
