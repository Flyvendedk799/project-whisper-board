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
import { cn } from "@/lib/utils";
import { collapseEmptySections, defaultBoardLayout, type BoardLayout } from "@/lib/board-view";
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
  const [layout, setLayout] = useState<BoardLayout>(() =>
    defaultBoardLayout(plan.sections?.length ?? 0),
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [openEmpty, setOpenEmpty] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

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

  const rails = collapseEmptySections(
    sections.map((section) => bySection.get(section.id)?.length ?? 0),
  );
  const selected =
    sections.find((section) => section.id === selectedId) ??
    sections.find((section) => (bySection.get(section.id)?.length ?? 0) > 0) ??
    sections[0];
  const selectedTasks = selected ? (bySection.get(selected.id) ?? []) : [];

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

  const toggleExpanded = (taskId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const expandEmpty = (sectionId: string) => {
    setOpenEmpty((prev) => new Set(prev).add(sectionId));
  };

  const collapseEmpty = (sectionId: string) => {
    setOpenEmpty((prev) => {
      const next = new Set(prev);
      next.delete(sectionId);
      return next;
    });
  };

  const renderTask = (task: TaskWithAgent, sectionId: string) => (
    <div
      key={task.id}
      draggable
      onDragStart={(e) => handleDragStart(e, task.id)}
      onDragEnd={() => setDraggedTaskId(null)}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => handleDropOnTask(e, sectionId, task.id)}
      onClick={() => onTaskClick(task.id)}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" && e.shiftKey) {
          e.preventDefault();
          moveAcross(task.id, 1, sectionId);
        } else if (e.key === "ArrowLeft" && e.shiftKey) {
          e.preventDefault();
          moveAcross(task.id, -1, sectionId);
        } else if (e.key === "Enter") {
          e.preventDefault();
          onTaskClick(task.id);
        }
      }}
      tabIndex={0}
      className={`cursor-pointer rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${draggedTaskId === task.id ? "opacity-40" : ""}`}
    >
      <PlanTaskCard
        task={task}
        expanded={expanded.has(task.id)}
        onToggleExpand={() => toggleExpanded(task.id)}
      />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div
        className="flex shrink-0 items-center gap-1 border-b px-4 py-2"
        role="group"
        aria-label="Board layout"
      >
        <Button
          type="button"
          size="sm"
          variant={layout === "columns" ? "secondary" : "ghost"}
          aria-pressed={layout === "columns"}
          onClick={() => setLayout("columns")}
        >
          Columns
        </Button>
        <Button
          type="button"
          size="sm"
          variant={layout === "outline" ? "secondary" : "ghost"}
          aria-pressed={layout === "outline"}
          onClick={() => setLayout("outline")}
        >
          Outline
        </Button>
      </div>

      {layout === "outline" ? (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav
            aria-label="Sections"
            className="flex shrink-0 gap-1 overflow-x-auto border-b p-2 md:w-64 md:flex-col md:overflow-y-auto md:border-b-0 md:border-r md:p-3"
          >
            {sections.map((section) => {
              const count = bySection.get(section.id)?.length ?? 0;
              const active = selected?.id === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  title={section.title}
                  onClick={() => setSelectedId(section.id)}
                  onDragOver={(e) => handleDragOver(e, section.id)}
                  onDragLeave={(e) => handleDragLeave(e, section.id)}
                  onDrop={(e) => handleDrop(e, section.id)}
                  className={cn(
                    "flex w-44 shrink-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-full",
                    active ? "bg-accent text-accent-foreground" : "hover:bg-muted",
                    over === section.id && "ring-2 ring-ring",
                    count === 0 && "text-muted-foreground",
                  )}
                >
                  <span className="line-clamp-2 min-w-0 flex-1 leading-snug">{section.title}</span>
                  <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                    {count}
                  </span>
                </button>
              );
            })}
            <Button
              variant="outline"
              className="mt-1 w-44 shrink-0 justify-start border-dashed bg-transparent text-muted-foreground hover:bg-muted/50 md:w-full"
              onClick={() => setSectionOpen(true)}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add section
            </Button>
          </nav>

          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto p-4 md:p-6",
              selected && over === selected.id && "bg-accent/30",
            )}
            onDragOver={selected ? (e) => handleDragOver(e, selected.id) : undefined}
            onDragLeave={selected ? (e) => handleDragLeave(e, selected.id) : undefined}
            onDrop={selected ? (e) => handleDrop(e, selected.id) : undefined}
          >
            {selected && (
              <div className="mx-auto flex max-w-3xl flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold leading-snug" title={selected.title}>
                      {selected.title}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {selectedTasks.length === 1 ? "1 task" : `${selectedTasks.length} tasks`}
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => onCreateTask?.(selected.id)}>
                    <Plus className="mr-1.5 h-4 w-4" />
                    Add task
                  </Button>
                </div>
                <div className="flex flex-col gap-3">
                  {selectedTasks.map((task) => renderTask(task, selected.id))}
                  {selectedTasks.length === 0 && (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      Drag tasks here
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto p-4 md:p-6">
          {sections.map((section: Row<"plan_sections">) => {
            const column = bySection.get(section.id) || [];
            const rail = rails && column.length === 0 && !openEmpty.has(section.id);
            if (rail) {
              return (
                <button
                  key={section.id}
                  type="button"
                  title={section.title}
                  aria-label={`${section.title}, empty`}
                  className={cn(
                    "flex w-11 shrink-0 flex-col items-center gap-2 rounded-xl border bg-muted/20 px-1 py-3 text-muted-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    over === section.id && "border-primary bg-accent/40",
                  )}
                  onClick={() => expandEmpty(section.id)}
                  onDragOver={(e) => handleDragOver(e, section.id)}
                  onDragLeave={(e) => handleDragLeave(e, section.id)}
                  onDrop={(e) => {
                    expandEmpty(section.id);
                    handleDrop(e, section.id);
                  }}
                >
                  <span className="text-xs tabular-nums">0</span>
                  <span className="max-h-48 truncate text-xs font-medium [writing-mode:vertical-rl]">
                    {section.title}
                  </span>
                </button>
              );
            }

            return (
              <div
                key={section.id}
                className={`flex w-[320px] shrink-0 flex-col gap-3 rounded-xl border bg-muted/30 p-3 transition-colors ${over === section.id ? "border-primary bg-accent/40" : ""}`}
                onDragOver={(e) => handleDragOver(e, section.id)}
                onDragLeave={(e) => handleDragLeave(e, section.id)}
                onDrop={(e) => handleDrop(e, section.id)}
              >
                <div className="flex items-start justify-between gap-2 border-b px-2 pb-2">
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    {section.color && (
                      <div
                        className="mt-1 h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: section.color }}
                      />
                    )}
                    <h3
                      className="line-clamp-2 min-w-0 font-semibold leading-snug"
                      title={section.title}
                    >
                      {section.title}
                    </h3>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                      {column.length}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center">
                    {rails && column.length === 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs text-muted-foreground"
                        onClick={() => collapseEmpty(section.id)}
                      >
                        Collapse
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 text-muted-foreground hover:text-foreground"
                      onClick={() => onCreateTask?.(section.id)}
                      aria-label={`Add task to ${section.title}`}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex flex-1 flex-col gap-3 overflow-y-auto px-1 py-2">
                  {column.map((task) => renderTask(task, section.id))}
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
        </div>
      )}

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
