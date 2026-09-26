import { Bot, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { hasLivePullRequest } from "@/lib/plan-refs";
import { cardFace, nestedOutlineCount, plainTitle } from "@/lib/board-view";
import { readTaskOutline, type TaskOutlineNode } from "@/lib/plan-markdown";
import type { TaskWithAgent } from "@/data";

export function PlanTaskCard({
  task,
  expanded = false,
  onToggleExpand,
}: {
  task: TaskWithAgent;
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const livePr = hasLivePullRequest(task);
  const liveTicket = Boolean(task.ticket?.id);
  const showFooter = Boolean(
    task.assigned_agent_id || task.assigned_user_id || livePr || liveTicket,
  );
  const isMerged = task.pr_status === "merged";
  const isClosed = task.pr_status === "closed";
  const face = cardFace(task.title);
  const outline = readTaskOutline(task.description);
  const nestedCount = nestedOutlineCount(outline.nested);
  const canExpand = Boolean(face.detail || outline.body || nestedCount > 0);
  const fullTitle = plainTitle(task.title);

  const getStatusColor = (status: string | undefined | null) => {
    switch (status) {
      case "done":
        return "bg-green-500";
      case "blocked":
      case "cancelled":
        return "bg-red-500";
      case "in_progress":
      case "in_review":
      case "claimed":
        return "bg-yellow-500";
      case "available":
      case "backlog":
      default:
        return "bg-slate-400 dark:bg-slate-600";
    }
  };

  return (
    <div className="group relative flex cursor-pointer flex-col gap-3 rounded-lg border bg-card p-3 text-left shadow-sm transition-all hover:border-primary/50 hover:shadow-md">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-start gap-2">
          <div
            className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${getStatusColor(task.status)}`}
            title={task.status ? task.status.replace(/_/g, " ") : "unknown"}
          />
          <h4 className="font-medium leading-snug" title={face.detail ? fullTitle : undefined}>
            {face.headline}
          </h4>
        </div>
        {canExpand && onToggleExpand && (
          <button
            type="button"
            className="self-start text-xs font-medium text-muted-foreground hover:text-foreground"
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
        )}
        {expanded && canExpand && (
          <div className="space-y-2">
            {face.detail ? (
              <p className="text-sm leading-snug text-foreground">{face.detail}</p>
            ) : null}
            {outline.body ? (
              <p className="whitespace-pre-wrap text-sm leading-snug text-muted-foreground">
                {outline.body}
              </p>
            ) : null}
            {nestedCount > 0 ? <NestedOutline nodes={outline.nested} /> : null}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {task.priority && (
          <Badge variant="outline" className="text-xs">
            <span
              className={`mr-1.5 h-1.5 w-1.5 rounded-full ${
                task.priority === "critical"
                  ? "bg-red-500"
                  : task.priority === "high"
                    ? "bg-orange-500"
                    : task.priority === "medium"
                      ? "bg-yellow-500"
                      : "bg-blue-500"
              }`}
            />
            {task.priority}
          </Badge>
        )}
        {task.complexity && (
          <Badge variant="secondary" className="text-xs">
            {task.complexity}
          </Badge>
        )}
      </div>

      {showFooter && (
        <div className="mt-1 flex flex-col gap-1.5 border-t pt-2 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {task.assigned_agent_id && (
                <div className="flex items-center gap-1">
                  <Bot className="h-3.5 w-3.5" />
                  <span>{task.assigned_agent?.name || "Agent"}</span>
                </div>
              )}
              {task.assigned_user_id && (
                <div className="flex items-center gap-1">
                  <div className="flex h-4 w-4 items-center justify-center overflow-hidden rounded-full bg-primary/20 text-[8px] font-bold">
                    {task.assigned_user?.full_name?.charAt(0) || "U"}
                  </div>
                  <span>{task.assigned_user?.full_name?.split(" ")[0] || "User"}</span>
                </div>
              )}
            </div>

            {livePr && task.pr_number && (
              <a
                href={task.pr_url || "#"}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className={`flex items-center gap-1 hover:underline ${
                  isMerged ? "text-purple-500" : isClosed ? "text-red-500" : "text-green-500"
                }`}
              >
                {isMerged ? (
                  <GitPullRequest className="h-3.5 w-3.5" />
                ) : isClosed ? (
                  <GitPullRequestClosed className="h-3.5 w-3.5" />
                ) : (
                  <GitPullRequestDraft className="h-3.5 w-3.5" />
                )}
                <span>#{task.pr_number}</span>
              </a>
            )}
          </div>

          {liveTicket && task.ticket && (
            <Link
              to="/app/tickets/$ticketId"
              params={{ ticketId: task.ticket.id }}
              search={{ from: "home" }}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-[10px] text-muted-foreground/80 underline-offset-2 hover:underline"
            >
              #{task.ticket.ticket_number}
              {task.ticket.status ? ` · ${task.ticket.status.replace(/_/g, " ")}` : ""}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function NestedOutline({ nodes }: { nodes: TaskOutlineNode[] }) {
  return (
    <ul className="space-y-1.5 border-l pl-3">
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
