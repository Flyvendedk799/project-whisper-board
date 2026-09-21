import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanTaskCard } from "./plan-task-card";
import { useServerAction } from "@/lib/use-server-action";
import { createSection, updateTask } from "@/lib/planner.functions";
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

  const updateTaskMut = useServerAction(updateTask);
  const createSectionMut = useServerAction(createSection);

  const sections = plan.sections || [];
  const tasks = plan.tasks || [];

  // Group tasks by section
  const bySection = new Map<string, TaskWithAgent[]>();
  for (const section of sections) bySection.set(section.id, []);
  for (const task of tasks) {
    if (bySection.has(task.section_id)) {
      bySection.get(task.section_id)!.push(task);
    }
  }

  // Keyboard navigation
  const move = (taskId: string, direction: -1 | 1, fromSectionId: string) => {
    const index = sections.findIndex((s: Row<"plan_sections">) => s.id === fromSectionId);
    const next = sections[index + direction];
    if (next) updateTaskMut.mutate({ id: taskId, section_id: next.id });
  };

  // Basic DnD handlers
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

  const handleDragLeave = (e: React.DragEvent, sectionId: string) => {
    if (over === sectionId) setOver(null);
  };

  const handleDrop = (e: React.DragEvent, sectionId: string) => {
    e.preventDefault();
    setOver(null);
    setDraggedTaskId(null);
    const taskId = e.dataTransfer.getData("taskId");
    if (!taskId) return;

    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.section_id === sectionId) return; // Same section, ignore for now

    // Call server action to move
    updateTaskMut.mutate({ id: taskId, section_id: sectionId });
  };

  return (
    <div className="flex h-full w-full gap-4 overflow-x-auto p-4 md:p-6">
      {sections.map((section: Row<"plan_sections">) => {
        const column = bySection.get(section.id) || [];
        return (
          <div
            key={section.id}
            className={`flex w-[320px] shrink-0 flex-col gap-3 rounded-xl border bg-muted/30 p-3 transition-colors ${over === section.id ? "bg-accent/40 border-primary" : ""}`}
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
                  onClick={() => onTaskClick(task.id)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" && e.shiftKey) {
                      e.preventDefault();
                      move(task.id, 1, section.id);
                    } else if (e.key === "ArrowLeft" && e.shiftKey) {
                      e.preventDefault();
                      move(task.id, -1, section.id);
                    } else if (e.key === "Enter") {
                      e.preventDefault();
                      onTaskClick(task.id);
                    }
                  }}
                  tabIndex={0}
                  className={`cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg ${draggedTaskId === task.id ? "opacity-40" : ""}`}
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
          className="w-full justify-start text-muted-foreground border-dashed bg-transparent hover:bg-muted/50"
          onClick={() => {
            const title = prompt("Section title:");
            if (title) {
              createSectionMut.mutate({
                plan_id: plan.id,
                title,
                position: sections.length * 1000,
              });
            }
          }}
        >
          <Plus className="mr-2 h-4 w-4" />
          Add section
        </Button>
      </div>
    </div>
  );
}
