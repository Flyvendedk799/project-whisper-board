import { useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { collapseEmptySections, type BoardLayout } from "@/lib/board-view";
import { partitionUploadable } from "@/lib/upload";
import { cn } from "@/lib/utils";
import type { PlanSection, PlanWithSections, TaskWithAgent } from "@/data";
import { PlanTaskCard } from "./plan-task-card";
import { usePlanMedia } from "./plan-media";
import {
  hasFiles,
  matchesFilters,
  progressOf,
  sectionColor,
  sortedTasks,
  taskTitleFromFileName,
  type TaskFilters,
} from "./plan-model";
import type { PlanActions } from "./use-plan-actions";

type BoardActions = Pick<PlanActions, "advance" | "moveTask" | "create" | "removeSection">;

/**
 * Columns or Outline. Tasks drag between and within sections (Shift + arrow keys
 * do the same from the keyboard), a file dropped on a card attaches to it, and a
 * file dropped on a section becomes a task of its own.
 */
export function PlanBoard({
  plan,
  layout,
  filters,
  meId,
  activeTaskId = null,
  selectedSectionId = null,
  onSelectSection,
  onOpenTask,
  onAddSection,
  onRenameSection,
  actions,
}: {
  plan: PlanWithSections;
  layout: BoardLayout;
  filters: TaskFilters;
  meId?: string | null;
  activeTaskId?: string | null;
  /** Outline layout: which section is showing. */
  selectedSectionId?: string | null;
  onSelectSection?: (sectionId: string) => void;
  onOpenTask: (taskId: string) => void;
  onAddSection?: () => void;
  onRenameSection?: (section: PlanSection) => void;
  actions: BoardActions;
}) {
  const media = usePlanMedia();
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [overSection, setOverSection] = useState<string | null>(null);
  const [overTask, setOverTask] = useState<string | null>(null);
  const [openEmpty, setOpenEmpty] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [quickSection, setQuickSection] = useState<string | null>(null);
  const [quickTitle, setQuickTitle] = useState("");

  const sections = plan.sections ?? [];
  const isOutline = layout === "outline";

  const columns = new Map<string, TaskWithAgent[]>();
  for (const section of sections) columns.set(section.id, sortedTasks(section.tasks ?? []));
  const counts = sections.map((section) => columns.get(section.id)?.length ?? 0);
  const rails = collapseEmptySections(counts);
  const selected =
    sections.find((section) => section.id === selectedSectionId) ??
    sections.find((_, index) => counts[index] > 0) ??
    sections[0];

  const toggleIn = (setter: typeof setExpanded, id: string) =>
    setter((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // ----- Files ------------------------------------------------------------

  const tasksFromFiles = async (sectionId: string, dropped: File[]) => {
    const { ok, problems } = partitionUploadable(dropped);
    for (const problem of problems) toast.error(problem);
    let made = 0;
    for (const file of ok) {
      try {
        const created = await actions.create.run({
          planId: plan.id,
          sectionId,
          title: taskTitleFromFileName(file.name),
        });
        await media.upload(created.id, [file], { quiet: true });
        made += 1;
      } catch {
        // create.run already toasted the reason.
      }
    }
    if (made > 0) toast.success(`Created ${made} task${made === 1 ? "" : "s"} from files`);
  };

  // ----- Dragging ---------------------------------------------------------

  const dropOnSection = (event: React.DragEvent, sectionId: string) => {
    event.preventDefault();
    setOverSection(null);
    setOverTask(null);
    if (event.dataTransfer.files.length > 0) {
      void tasksFromFiles(sectionId, Array.from(event.dataTransfer.files));
      return;
    }
    const taskId = event.dataTransfer.getData("taskId") || draggedTaskId;
    setDraggedTaskId(null);
    if (taskId) actions.moveTask(taskId, sectionId, null);
  };

  const dropOnTask = (event: React.DragEvent, task: TaskWithAgent) => {
    event.preventDefault();
    event.stopPropagation();
    setOverSection(null);
    setOverTask(null);
    if (event.dataTransfer.files.length > 0) {
      void media.upload(task.id, Array.from(event.dataTransfer.files));
      return;
    }
    const taskId = event.dataTransfer.getData("taskId") || draggedTaskId;
    setDraggedTaskId(null);
    if (taskId && taskId !== task.id) actions.moveTask(taskId, task.section_id, task.id);
  };

  const overSectionProps = (sectionId: string) => ({
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = hasFiles(event) ? "copy" : "move";
      if (overSection !== sectionId) setOverSection(sectionId);
    },
    onDragLeave: (event: React.DragEvent) => {
      if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
      if (overSection === sectionId) setOverSection(null);
    },
    onDrop: (event: React.DragEvent) => dropOnSection(event, sectionId),
  });

  // ----- Keyboard ---------------------------------------------------------

  const onCardKeyDown = (event: React.KeyboardEvent, task: TaskWithAgent) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter") {
      event.preventDefault();
      onOpenTask(task.id);
      return;
    }
    if (!event.shiftKey) return;
    const sectionIndex = sections.findIndex((s) => s.id === task.section_id);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      const target = sections[sectionIndex + (event.key === "ArrowRight" ? 1 : -1)];
      if (!target) return;
      event.preventDefault();
      actions.moveTask(task.id, target.id, null);
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      const column = columns.get(task.section_id) ?? [];
      const at = column.findIndex((t) => t.id === task.id);
      const before = event.key === "ArrowUp" ? column[at - 1] : column[at + 2];
      if (event.key === "ArrowUp" ? at <= 0 : at >= column.length - 1) return;
      event.preventDefault();
      actions.moveTask(task.id, task.section_id, before?.id ?? null);
    }
  };

  const renderTask = (task: TaskWithAgent) => (
    <div
      key={task.id}
      role="group"
      aria-label={task.title}
      draggable
      tabIndex={0}
      onDragStart={(event) => {
        setDraggedTaskId(task.id);
        event.dataTransfer.setData("taskId", task.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => {
        setDraggedTaskId(null);
        setOverSection(null);
        setOverTask(null);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = hasFiles(event) ? "copy" : "move";
        if (overTask !== task.id) setOverTask(task.id);
      }}
      onDragLeave={() => overTask === task.id && setOverTask(null)}
      onDrop={(event) => dropOnTask(event, task)}
      onClick={() => onOpenTask(task.id)}
      onKeyDown={(event) => onCardKeyDown(event, task)}
      className={cn(
        "cursor-pointer rounded-xl outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30",
        draggedTaskId === task.id && "opacity-40",
        activeTaskId === task.id && "ring-2 ring-primary",
      )}
    >
      <PlanTaskCard
        task={task}
        expanded={expanded.has(task.id)}
        onToggleExpand={() => toggleIn(setExpanded, task.id)}
        onAdvance={() => actions.advance(task)}
        attachments={media.byTask.get(task.id) ?? []}
        dropActive={overTask === task.id && Boolean(draggedTaskId === null)}
      />
    </div>
  );

  // ----- A section --------------------------------------------------------

  const addTask = (sectionId: string) => {
    const title = quickTitle.trim();
    if (!title) return;
    setQuickTitle("");
    actions.create.fire({ planId: plan.id, sectionId, title });
  };

  const renderSection = (section: PlanSection, index: number, wide: boolean) => {
    const mine = columns.get(section.id) ?? [];
    const shown = mine.filter((task) => matchesFilters(task, filters, meId));
    const progress = progressOf(mine);
    const color = sectionColor(section.color, index);
    const isEmpty = mine.length === 0;
    const hovered = overSection === section.id;
    const adding = quickSection === section.id;

    return (
      <div
        key={section.id}
        id={`col-${section.id}`}
        style={wide ? undefined : { width: 304 }}
        className={cn(
          "flex shrink-0 flex-col gap-2.5 rounded-[14px] border bg-surface p-3 transition-colors",
          wide && "w-[min(760px,100%)]",
          hovered && "border-primary bg-accent/60",
        )}
        {...overSectionProps(section.id)}
      >
        <div className="relative flex flex-col gap-2 px-1 pb-0.5">
          <div className="flex items-center gap-2">
            <h3 className="flex-1 font-display text-[21px] font-normal leading-tight">
              {section.title}
            </h3>
            <span className="text-xs tabular-nums text-muted-foreground">
              {progress.done}/{progress.total}
            </span>
            {!wide && rails && isEmpty ? (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() =>
                  setOpenEmpty((current) => {
                    const next = new Set(current);
                    next.delete(section.id);
                    return next;
                  })
                }
              >
                Collapse
              </button>
            ) : null}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-[26px] w-[26px] text-muted-foreground"
                  aria-label={`Section options for ${section.title}`}
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onSelect={() => onRenameSection?.(section)}>
                  Rename section
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  disabled={!isEmpty}
                  onSelect={() => actions.removeSection.fire({ sectionId: section.id })}
                >
                  {isEmpty ? "Delete section" : "Move tasks out to delete"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <span
            role="progressbar"
            aria-label={`${section.title} progress`}
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            className="block h-[3px] overflow-hidden rounded-full bg-border/70"
          >
            <span
              className="block h-full transition-[width]"
              style={{ width: `${progress.percent}%`, backgroundColor: color }}
            />
          </span>
          {section.description ? (
            <details className="text-muted-foreground" open={mine.length === 0}>
              <summary className="cursor-pointer select-none text-xs hover:text-foreground">
                Section notes
              </summary>
              <div className="mt-1.5 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 text-xs leading-relaxed text-foreground/80">
                {section.description}
              </div>
            </details>
          ) : null}
        </div>

        {shown.map(renderTask)}

        {shown.length === 0 ? (
          <div className="rounded-lg border border-dashed px-2 py-[18px] text-center text-[13px] text-muted-foreground">
            {mine.length ? "No tasks match the filters" : "Drop a task or files here"}
          </div>
        ) : null}

        {adding ? (
          <input
            autoFocus
            value={quickTitle}
            aria-label={`New task in ${section.title}`}
            onChange={(event) => setQuickTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTask(section.id);
              }
              if (event.key === "Escape") {
                setQuickSection(null);
                setQuickTitle("");
              }
            }}
            onBlur={() => {
              if (!quickTitle.trim()) setQuickSection(null);
            }}
            maxLength={200}
            placeholder="Task title, Enter to add"
            className="h-[38px] rounded-lg border border-primary bg-card px-3 text-sm outline-none ring-[3px] ring-primary/15"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setQuickSection(section.id);
              setQuickTitle("");
            }}
            className="h-[34px] rounded-lg px-1.5 text-left text-[13px] text-muted-foreground hover:bg-muted"
          >
            + Add task
          </button>
        )}
      </div>
    );
  };

  // ----- Layouts ----------------------------------------------------------

  if (isOutline) {
    return (
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav
          aria-label="Sections"
          className="flex shrink-0 gap-0.5 overflow-x-auto border-b p-3 md:w-[250px] md:flex-col md:overflow-y-auto md:border-b-0 md:border-r"
        >
          {sections.map((section, index) => {
            const active = selected?.id === section.id;
            return (
              <button
                key={section.id}
                type="button"
                aria-current={active ? "page" : undefined}
                title={section.title}
                onClick={() => onSelectSection?.(section.id)}
                {...overSectionProps(section.id)}
                className={cn(
                  "flex w-44 shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:w-full",
                  active ? "bg-accent" : "hover:bg-muted",
                  overSection === section.id && "bg-accent/70 ring-2 ring-primary",
                  counts[index] === 0 && "text-muted-foreground",
                )}
              >
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: sectionColor(section.color, index) }}
                />
                <span className="line-clamp-2 min-w-0 flex-1 leading-snug">{section.title}</span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {counts[index]}
                </span>
              </button>
            );
          })}
          <Button
            type="button"
            variant="outline"
            className="mt-1 w-44 shrink-0 justify-start border-dashed bg-transparent text-muted-foreground md:w-full"
            onClick={onAddSection}
          >
            <Plus className="mr-2 h-4 w-4" />
            Add section
          </Button>
        </nav>

        <div className="min-h-0 flex-1 overflow-auto">
          <div className="flex min-h-full justify-center px-4 py-5 md:px-8 md:pb-8">
            {selected
              ? renderSection(
                  selected,
                  sections.findIndex((s) => s.id === selected.id),
                  true,
                )
              : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div id="board-scroll" className="min-h-0 flex-1 overflow-auto">
      <div className="flex min-h-full items-start gap-4 px-4 py-5 md:px-8 md:pb-8">
        {sections.map((section, index) => {
          const mine = columns.get(section.id) ?? [];
          const rail = rails && mine.length === 0 && !openEmpty.has(section.id);
          return (
            <div key={section.id} className="contents">
              {rail ? (
                <button
                  type="button"
                  id={`col-${section.id}`}
                  title={`${section.title}, empty`}
                  aria-label={`${section.title}, empty`}
                  onClick={() => setOpenEmpty((current) => new Set(current).add(section.id))}
                  onDragOver={overSectionProps(section.id).onDragOver}
                  onDragLeave={overSectionProps(section.id).onDragLeave}
                  onDrop={(event) => {
                    setOpenEmpty((current) => new Set(current).add(section.id));
                    dropOnSection(event, section.id);
                  }}
                  className={cn(
                    "flex w-11 shrink-0 flex-col items-center gap-2.5 rounded-xl border bg-surface px-1 py-3 text-muted-foreground hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    overSection === section.id && "border-primary",
                  )}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: sectionColor(section.color, index) }}
                  />
                  <span className="text-xs">0</span>
                  <span className="max-h-44 truncate text-[13px] [writing-mode:vertical-rl]">
                    {section.title}
                  </span>
                </button>
              ) : (
                renderSection(section, index, false)
              )}
            </div>
          );
        })}

        <div className="w-[200px] shrink-0">
          <button
            type="button"
            onClick={onAddSection}
            className="h-10 w-full rounded-[10px] border border-dashed px-3.5 text-left text-[13px] text-muted-foreground hover:bg-muted/60"
          >
            + Add section
          </button>
        </div>
      </div>
    </div>
  );
}
