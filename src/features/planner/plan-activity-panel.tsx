import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { planEventsQuery } from "@/data/planner";
import type { EventWithRefs, PlanWithSections } from "@/data";
import { Button } from "@/components/ui/button";
import { eventVerb, initials, taskHeadline, tasksOf, timeAgo } from "./plan-model";

/** The "Activity" side panel: what agents and teammates did, newest first. */
export function PlanActivityPanel({
  plan,
  onClose,
  onOpenTask,
}: {
  plan: PlanWithSections;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
}) {
  const events = useQuery(planEventsQuery(plan.id));
  const tasks = new Map(tasksOf(plan).map((task) => [task.id, task] as const));
  const rows = (events.data?.events ?? []) as EventWithRefs[];

  return (
    <aside
      aria-label="Activity"
      className="flex max-h-[70vh] w-full shrink-0 flex-col border-t bg-surface md:max-h-none md:w-[330px] md:border-l md:border-t-0"
    >
      <div className="flex items-center gap-2 px-5 pb-3 pt-4">
        <h2 className="flex-1 font-display text-[22px] leading-none">Activity</h2>
        <span className="text-xs text-muted-foreground">Updates live</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground"
          aria-label="Close activity"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ol className="flex flex-1 flex-col gap-4 overflow-auto px-5 pb-5">
        {rows.map((event) => {
          const isAgent = Boolean(event.agent);
          const name =
            event.agent?.name ?? event.actor?.full_name ?? event.actor?.email ?? "Someone";
          const task = event.task_id ? tasks.get(event.task_id) : undefined;
          const metadata =
            event.metadata && typeof event.metadata === "object" && !Array.isArray(event.metadata)
              ? (event.metadata as Record<string, unknown>)
              : {};
          const taskTitle =
            task?.title ?? (typeof metadata.title === "string" ? metadata.title : "");
          const detail =
            typeof metadata.message === "string" && metadata.message
              ? metadata.message
              : event.kind === "task_moved" ||
                  event.kind === "task_updated" ||
                  event.kind === "comment_added" ||
                  event.kind === "attachment_added" ||
                  event.kind === "pr_opened"
                ? (event.new_value ?? "")
                : event.kind === "attachment_removed"
                  ? (event.old_value ?? "")
                  : "";

          return (
            <li key={event.id} className="flex gap-2.5">
              <div
                aria-hidden="true"
                className={`flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                  isAgent ? "bg-chart-5/20" : "bg-accent"
                }`}
              >
                {isAgent ? "AI" : initials(name)}
              </div>
              <div className="min-w-0">
                <p className="text-sm leading-snug">
                  <span className="font-medium">{name}</span>{" "}
                  <span className="text-muted-foreground">{eventVerb(event.kind)}</span>{" "}
                  {task ? (
                    <button
                      type="button"
                      onClick={() => onOpenTask(task.id)}
                      className="border-b border-border text-left text-foreground hover:border-foreground"
                    >
                      {taskHeadline(task.title)}
                    </button>
                  ) : taskTitle ? (
                    <span className="text-foreground">{taskHeadline(taskTitle)}</span>
                  ) : null}
                </p>
                {detail ? (
                  <p className="mt-0.5 line-clamp-3 text-[13px] leading-snug text-foreground/80">
                    {detail}
                  </p>
                ) : null}
                <p className="mt-0.5 text-xs text-muted-foreground">{timeAgo(event.created_at)}</p>
              </div>
            </li>
          );
        })}
        {rows.length === 0 && !events.isPending ? (
          <li className="text-center text-sm text-muted-foreground">
            No activity yet. Agent and teammate updates appear here.
          </li>
        ) : null}
      </ol>
    </aside>
  );
}
