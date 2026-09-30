import { Link } from "@tanstack/react-router";
import type { PlanAttachmentWithUrl, TaskWithAgent } from "@/data";
import { hasLivePullRequest } from "@/lib/plan-refs";
import { cardFace, nestedOutlineCount, plainTitle } from "@/lib/board-view";
import { readTaskOutline, stepsProgress, type TaskOutlineNode } from "@/lib/plan-markdown";
import { cn } from "@/lib/utils";
import { advanceTip, coverImages, initials, PRIORITY_STYLE, STATUS_STYLE } from "./plan-model";

const PR_TONE: Record<string, string> = {
  open: "text-success",
  draft: "text-muted-foreground",
  merged: "text-chart-5",
  closed: "text-destructive",
};

/**
 * A task on the board. Long imported titles split into a headline and detail,
 * the circle advances the status, and files show up as a cover and a count.
 */
export function PlanTaskCard({
  task,
  expanded = false,
  onToggleExpand,
  onAdvance,
  attachments = [],
  dropActive = false,
}: {
  task: TaskWithAgent;
  expanded?: boolean;
  onToggleExpand?: () => void;
  onAdvance?: () => void;
  /** Visible files on this task (marked-up copies already replace their originals). */
  attachments?: PlanAttachmentWithUrl[];
  /** A file is being dragged over the card. */
  dropActive?: boolean;
}) {
  const livePr = hasLivePullRequest(task);
  const style = STATUS_STYLE[task.status];
  const done = task.status === "done";
  const face = cardFace(task.title);
  const outline = readTaskOutline(task.description);
  const nestedCount = nestedOutlineCount(outline.nested);
  const canExpand = Boolean(face.detail || outline.body || nestedCount > 0);
  const fullTitle = plainTitle(task.title);
  const steps = task.steps ?? [];
  const progress = stepsProgress(steps);
  const covers = coverImages(attachments);
  const notes = task.comment_count?.[0]?.count ?? 0;
  const ticket = task.ticket;
  const hasFooter = Boolean(
    task.assigned_agent_id ||
    task.assigned_user_id ||
    ticket?.id ||
    livePr ||
    attachments.length ||
    notes,
  );

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-[border-color,box-shadow] hover:border-primary/50 hover:shadow-md",
        dropActive && "border-primary ring-2 ring-primary/30",
      )}
    >
      {covers.length > 0 ? (
        <div className="relative h-[104px] bg-muted/60">
          <img src={covers[0].url!} alt="" loading="lazy" className="h-full w-full object-cover" />
          {covers.length > 1 ? (
            <span className="absolute bottom-2 right-2 rounded-full bg-foreground/70 px-2 py-px text-[11px] text-background">
              +{covers.length - 1}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-2.5 p-3">
        <div className="flex items-start gap-2.5">
          <button
            type="button"
            title={advanceTip(task.status)}
            aria-label={`${advanceTip(task.status)} (now ${style.label})`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onAdvance?.();
            }}
            className={cn(
              "mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 p-0 text-[11px] font-semibold leading-none text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              style.border,
              done || task.status === "blocked" ? style.dot : "bg-transparent",
            )}
          >
            {done ? "✓" : task.status === "blocked" ? "!" : ""}
          </button>
          <div className="min-w-0 flex-1">
            <h4
              className={cn(
                "font-medium leading-snug",
                done && "text-muted-foreground line-through",
              )}
              title={face.detail ? fullTitle : undefined}
            >
              {face.headline}
            </h4>
            {canExpand && onToggleExpand ? (
              <button
                type="button"
                className="mt-1 text-xs text-muted-foreground hover:text-foreground"
                aria-expanded={expanded}
                aria-label={`${expanded ? "Hide" : "Show"} detail for ${face.headline}`}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleExpand();
                }}
              >
                {expanded ? "Hide" : nestedCount > 0 ? `${nestedCount} nested` : "More"}
              </button>
            ) : null}
          </div>
        </div>

        {expanded && canExpand ? (
          <div className="flex flex-col gap-1.5 pl-[30px] text-[13px] leading-snug">
            {face.detail ? <p>{face.detail}</p> : null}
            {outline.body ? (
              <p className="whitespace-pre-wrap text-muted-foreground">{outline.body}</p>
            ) : null}
            {nestedCount > 0 ? <NestedOutline nodes={outline.nested} /> : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn("rounded-full px-2 py-0.5 text-foreground", style.chip)}>
            {style.label}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn("h-1.5 w-1.5 rounded-full", PRIORITY_STYLE[task.priority].dot)} />
            {task.priority}
          </span>
          {task.complexity ? (
            <span className="rounded-full border px-[7px] py-px">{task.complexity}</span>
          ) : null}
        </div>

        {progress.total > 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span
              role="progressbar"
              aria-label="Sub-steps done"
              aria-valuenow={progress.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
            >
              <span className="block h-full bg-success" style={{ width: `${progress.percent}%` }} />
            </span>
            {progress.done}/{progress.total} sub-steps
          </div>
        ) : null}

        {hasFooter ? (
          <div className="flex flex-wrap items-center gap-2 border-t pt-2 text-xs text-muted-foreground">
            {task.assigned_agent_id ? (
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-chart-5/20 text-[9px] font-semibold text-foreground"
                >
                  AI
                </span>
                {task.assigned_agent?.name || "Agent"}
              </span>
            ) : null}
            {task.assigned_user_id ? (
              <span className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-accent text-[9px] font-semibold text-foreground"
                >
                  {initials(task.assigned_user?.full_name)}
                </span>
                {task.assigned_user?.full_name?.split(" ")[0] || "User"}
              </span>
            ) : null}
            <span className="flex-1" />
            {attachments.length > 0 ? (
              <span>
                {attachments.length} {attachments.length === 1 ? "file" : "files"}
              </span>
            ) : null}
            {notes > 0 ? (
              <span>
                {notes} {notes === 1 ? "note" : "notes"}
              </span>
            ) : null}
            {ticket ? (
              <Link
                to="/app/tickets/$ticketId"
                params={{ ticketId: ticket.id }}
                search={{ from: "home" }}
                onClick={(event) => event.stopPropagation()}
                className="hover:underline"
              >
                #{ticket.ticket_number}
              </Link>
            ) : null}
            {livePr && task.pr_number ? (
              <a
                href={task.pr_url || "#"}
                target="_blank"
                rel="noreferrer"
                onClick={(event) => event.stopPropagation()}
                className={cn(
                  "font-medium hover:underline",
                  PR_TONE[task.pr_status ?? "open"] ?? PR_TONE.open,
                )}
              >
                PR #{task.pr_number}
                {task.pr_status ? ` · ${task.pr_status}` : ""}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NestedOutline({ nodes }: { nodes: TaskOutlineNode[] }) {
  return (
    <ul className="flex flex-col gap-1.5 border-l pl-3">
      {nodes.map((node, index) => (
        <li key={`${node.title}-${index}`}>
          <p className="text-sm leading-snug text-foreground">{plainTitle(node.title)}</p>
          {node.body ? (
            <p className="mt-0.5 whitespace-pre-wrap text-xs leading-snug text-muted-foreground">
              {node.body}
            </p>
          ) : null}
          {node.children.length > 0 ? <NestedOutline nodes={node.children} /> : null}
        </li>
      ))}
    </ul>
  );
}
