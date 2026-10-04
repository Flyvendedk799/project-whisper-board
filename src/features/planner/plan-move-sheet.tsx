import { ArrowDown, ArrowUp, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlanSection, PlanTaskStatus, TaskWithAgent } from "@/data";
import { cn } from "@/lib/utils";
import { DIALOG_CONTENT, DIALOG_TITLE } from "./plan-dialogs";
import { sectionColor, STATUS_STYLE, taskHeadline, TASK_STATUSES } from "./plan-model";

/**
 * Phones cannot drag a card, so this is the touch way to do what dragging does: pick a section,
 * nudge the task up or down inside it, or set its status without opening the drawer.
 */
export function MoveTaskSheet({
  task,
  sections,
  counts,
  canMoveUp,
  canMoveDown,
  onClose,
  onMoveToSection,
  onNudge,
  onSetStatus,
}: {
  task: TaskWithAgent | null;
  sections: readonly PlanSection[];
  counts: ReadonlyMap<string, number>;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onClose: () => void;
  onMoveToSection: (task: TaskWithAgent, sectionId: string) => void;
  onNudge: (task: TaskWithAgent, direction: -1 | 1) => void;
  onSetStatus?: (task: TaskWithAgent, status: PlanTaskStatus) => void;
}) {
  return (
    <Dialog open={task !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className={cn("max-w-[460px]", DIALOG_CONTENT)}>
        {task ? (
          <>
            <DialogHeader>
              <DialogTitle className={DIALOG_TITLE}>Move task</DialogTitle>
              <DialogDescription className="line-clamp-2">
                {taskHeadline(task.title)}
              </DialogDescription>
            </DialogHeader>

            {onSetStatus ? (
              <fieldset className="flex flex-col gap-2">
                <legend className="mb-2 text-xs font-medium text-muted-foreground">Status</legend>
                <div className="flex flex-wrap gap-2">
                  {TASK_STATUSES.map((status) => (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={task.status === status}
                      onClick={() => {
                        onSetStatus(task, status);
                        onClose();
                      }}
                      className={cn(
                        "flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm",
                        task.status === status ? "border-primary bg-accent" : "bg-card",
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn("h-2 w-2 rounded-full", STATUS_STYLE[status].dot)}
                      />
                      {STATUS_STYLE[status].label}
                    </button>
                  ))}
                </div>
              </fieldset>
            ) : null}

            <fieldset className="flex flex-col">
              <legend className="mb-1 text-xs font-medium text-muted-foreground">Section</legend>
              <ul className="flex flex-col">
                {sections.map((section, index) => {
                  const current = section.id === task.section_id;
                  return (
                    <li key={section.id}>
                      <button
                        type="button"
                        disabled={current}
                        aria-current={current ? "true" : undefined}
                        onClick={() => onMoveToSection(task, section.id)}
                        className="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 text-left active:bg-muted disabled:opacity-100"
                      >
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: sectionColor(section.color, index) }}
                        />
                        <span
                          className={cn(
                            "min-w-0 flex-1 break-words text-[15px] leading-snug",
                            current && "font-medium",
                          )}
                        >
                          {section.title}
                        </span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {counts.get(section.id) ?? 0}
                        </span>
                        {current ? (
                          <Check className="h-4 w-4 text-primary" aria-hidden="true" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </fieldset>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!canMoveUp}
                onClick={() => onNudge(task, -1)}
              >
                <ArrowUp aria-hidden="true" />
                Move up
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!canMoveDown}
                onClick={() => onNudge(task, 1)}
              >
                <ArrowDown aria-hidden="true" />
                Move down
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
