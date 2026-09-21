import { Bot, GitPullRequest, GitPullRequestClosed, GitPullRequestDraft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TaskWithAgent } from "@/data";

export function PlanTaskCard({ task, onClick }: { task: TaskWithAgent; onClick?: () => void }) {
  const isMerged = task.pr_status === "merged";
  const isClosed = task.pr_status === "closed";

  return (
    <div
      onClick={onClick}
      className="group relative flex cursor-pointer flex-col gap-3 rounded-lg border bg-card p-3 text-left shadow-sm transition-all hover:border-primary/50 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-medium leading-tight">{task.title}</h4>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {task.priority && (
          <Badge variant="outline" className="text-xs">
            <span
              className={`mr-1.5 h-1.5 w-1.5 rounded-full ${
                task.priority === "urgent"
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

      {(task.assigned_agent_id || task.pr_number) && (
        <div className="mt-1 flex items-center justify-between border-t pt-2 text-xs text-muted-foreground">
          {task.assigned_agent_id ? (
            <div className="flex items-center gap-1">
              <Bot className="h-3.5 w-3.5" />
              <span>{task.assigned_agent?.name || "Agent"}</span>
            </div>
          ) : (
            <div />
          )}

          {task.pr_number && (
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
              #{task.pr_number}
            </a>
          )}
        </div>
      )}
    </div>
  );
}
