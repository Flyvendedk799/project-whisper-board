import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PlanTaskCard } from "./plan-task-card";
import { useServerAction } from "@/lib/use-server-action";
import { createSection, moveTask } from "@/lib/planner.functions";
import { qk } from "@/data/keys";
import type { PlanWithSections, TaskWithAgent, Row } from "@/data";

export function PlanBoard({
  plan,
  onTaskClick,
  onCreateTask,
}: {
  plan: PlanWithSections;
  onTaskClick: (taskId: string) => void;
  onCreateTask?: (sectionId: string) => void;
}) {
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [sectionOpen, setSectionOpen] = useState(false);
  const [sectionTitle, setSectionTitle] = useState("");

  const move = useServerAction(useServerFn(moveTask), {
    label: "tasks.move",
    invalidate: [qk.plan(plan.id)],
  });
  const createSectionMut = useServerAction(useServerFn(createSection), {
    label: "sections.create",
    success: "Section added",
    invalidate: [qk.plan(plan.id)],
    onSuccess: () => {
      setSectionOpen(false);
      setSectionTitle("");
    },
  });

  const sections = plan.sections || [];
  const tasks: TaskWithAgent[] = sections.flatMap((section) => section.tasks ?? []);

  const bySection = new Map<string, TaskWithAgent[]>();
  for (const section of sections) bySection.set(section.id, []);
  for (const task of tasks) {
    if (bySection.has(task.section_id)) {
      bySection.get(task.section_id)!.push(task);
    }
  }
  for (const [, column] of bySection) {
    column.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  }

  const moveAcross = (taskId: string, direction: -1 | 1, fromSectionId: string) => {
    const index = sections.findIndex((s: Row<"plan_sections">) => s.id === fromSectionId);
    const next = sections[index + direction];
    if (!next) return;
    const column = bySection.get(next.id) ?? [];
    const position = column.length > 0 ? Math.max(...column.map((t) => t.position ?? 0)) + 1 : 1;
    move.fire({ taskId, sectionId: next.id, position });
  };

  const handleDragStart = (e: React.DragEvent, taskId: string) => {
    setDraggedTaskId(taskId);
    e.dataTransfer.setData("taskId", taskId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, sectionId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (over !== sectionId) setOver(sectionId);
  };

  const handleDragLeave = (_e: React.DragEvent, sectionId: string) => {
    if (over === sectionId) setOver(null);
  };

  const handleDrop = (e: React.DragEvent, sectionId: string, beforeTaskId?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setOver(null);
    setDraggedTaskId(null);
    const taskId = e.dataTransfer.getData("taskId");
    if (!taskId) return;

    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const column = (bySection.get(sectionId) ?? []).filter((t) => t.id !== taskId);
    let position = 1;
    if (beforeTaskId) {
      const before = column.find((t) => t.id === beforeTaskId);
      position = before ? (before.position ?? 1) : column.length + 1;
    } else if (column.length > 0) {
      position = Math.max(...column.map((t) => t.position ?? 0)) + 1;
    }

    // Same-section reorder or cross-section move.
    if (task.section_id === sectionId && !beforeTaskId) return;
    move.fire({ taskId, sectionId, position });
  };

  const handleDropOnTask = (e: React.DragEvent, sectionId: string, beforeTaskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    handleDrop(e, sectionId, beforeTaskId);
  };

  return (
    <div className="flex h-full w-full gap-4 overflow-x-auto p-4 md:p-6">
      {sections.map((section: Row<"plan_sections">) => {
        const column = bySection.get(section.id) || [];
        return (
          <div
            key={section.id}
            className={`flex w-[320px] shrink-0 flex-col gap-3 rounded-xl border bg-muted/30 p-3 transition-colors ${over === section.id ? "border-primary bg-accent/40" : ""}`}
            onDragOver={(e) => handleDragOver(e, section.id)}
            onDragLeave={(e) => handleDragLeave(e, section.id)}
            onDrop={(e) => handleDrop(e, section.id)}
          >
            <div className="flex items-center justify-between border-b px-2 pb-2">
              <div className="flex items-center gap-2">
                {section.color && (
                  <div
                    className="h-3 w-3 rounded-full"
                    style={{ backgroundColor: section.color }}
                  />
                )}
                <h3 className="font-semibold">{section.title}</h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {column.length}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                onClick={() => onCreateTask?.(section.id)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-1 py-2">
              {column.map((task: TaskWithAgent) => (
                <div
                  key={task.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, task.id)}
                  onDragEnd={() => setDraggedTaskId(null)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => handleDropOnTask(e, section.id, task.id)}
                  onClick={() => onTaskClick(task.id)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" && e.shiftKey) {
                      e.preventDefault();
                      moveAcross(task.id, 1, section.id);
                    } else if (e.key === "ArrowLeft" && e.shiftKey) {
                      e.preventDefault();
                      moveAcross(task.id, -1, section.id);
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      onTaskClick(task.id);
                    }
                  }}
                  tabIndex={0}
                  className={`cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${draggedTaskId === task.id ? "opacity-40" : ""}`}
                >
                  <PlanTaskCard task={task} />
                </div>
              ))}
              {column.length === 0 && (
                <div className="py-8 text-center text-sm text-muted-foreground">
                  Drag tasks here
                </div>
              )}
            </div>
          </div>
        );
      })}

      <div className="w-[320px] shrink-0">
        <Button
          variant="outline"
          className="w-full justify-start border-dashed bg-transparent text-muted-foreground hover:bg-muted/50"
          onClick={() => setSectionOpen(true)}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add section
        </Button>
      </div>

      <Dialog open={sectionOpen} onOpenChange={setSectionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New section</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!sectionTitle.trim()) return;
              createSectionMut.fire({ planId: plan.id, title: sectionTitle.trim() });
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="section-title">Title</Label>
              <Input
                id="section-title"
                value={sectionTitle}
                onChange={(e) => setSectionTitle(e.target.value)}
                placeholder="Backlog"
                autoFocus
                required
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createSectionMut.busy || !sectionTitle.trim()}>
                {createSectionMut.busy ? "Adding…" : "Add section"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
