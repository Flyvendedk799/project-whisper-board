import { forwardRef, useState } from "react";
import { Activity, ChevronDown, SlidersHorizontal } from "lucide-react";
import { Segmented } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PlanTaskPriority, PlanTaskStatus } from "@/data";
import { cn } from "@/lib/utils";
import { DIALOG_CONTENT, DIALOG_TITLE, STICKY_ACTIONS } from "./plan-dialogs";
import {
  hasActiveFilters,
  NO_FILTERS,
  PRIORITY_STYLE,
  STATUS_STYLE,
  TASK_PRIORITIES,
  TASK_STATUSES,
  WHO_LABEL,
  type TaskFilters,
  type WhoFilter,
} from "./plan-model";

export type PlanLayout = "columns" | "outline" | "files" | "prs" | "questions" | "patches";

function FilterMenu({
  label,
  current,
  active,
  children,
}: {
  label: string;
  current: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-[34px] items-center gap-1.5 rounded-lg border px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            active ? "border-primary bg-accent" : "bg-card",
          )}
        >
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium">{current}</span>
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[200px]">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Option({
  label,
  dot,
  count,
  selected,
  onSelect,
}: {
  label: string;
  dot?: string;
  count?: number;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      onSelect={onSelect}
      data-selected={selected || undefined}
      className={cn("gap-2", selected && "bg-accent")}
    >
      <span className={cn("h-2 w-2 rounded-full", dot ?? "bg-transparent")} />
      <span className="flex-1">{label}</span>
      {count !== undefined ? <span className="text-xs text-muted-foreground">{count}</span> : null}
    </DropdownMenuItem>
  );
}

const LAYOUT_LABEL: Record<PlanLayout, string> = {
  columns: "Columns",
  outline: "Outline",
  files: "Files",
  patches: "Patches",
  questions: "Questions",
  prs: "Pull requests",
};

/** A pill that is on or off, sized for a thumb. */
function Chip({
  selected,
  onClick,
  dot,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  dot?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm",
        selected ? "border-primary bg-accent font-medium" : "bg-card",
      )}
    >
      {dot ? <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", dot)} /> : null}
      {children}
    </button>
  );
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-2 text-xs font-medium text-muted-foreground">{label}</legend>
      <div className="flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

/** Phones: every filter in one bottom sheet instead of four dropdowns in a row. */
function FilterSheet({
  open,
  onOpenChange,
  filters,
  onFilters,
  statusCounts,
  total,
  tags,
  questions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: TaskFilters;
  onFilters: (filters: TaskFilters) => void;
  statusCounts: Record<PlanTaskStatus, number>;
  total: number;
  tags: ReadonlyArray<{ tag: string; count: number }>;
  questions: { open: number; total: number };
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-[460px]", DIALOG_CONTENT)}>
        <DialogHeader>
          <DialogTitle className={DIALOG_TITLE}>Filter tasks</DialogTitle>
          <DialogDescription className="sr-only">
            Narrow the board by status, assignee, priority or tag.
          </DialogDescription>
        </DialogHeader>

        <FilterGroup label="Status">
          <Chip selected={!filters.status} onClick={() => onFilters({ ...filters, status: null })}>
            Any
            <span className="text-xs text-muted-foreground">{total}</span>
          </Chip>
          {TASK_STATUSES.map((status) => (
            <Chip
              key={status}
              dot={STATUS_STYLE[status].dot}
              selected={filters.status === status}
              onClick={() => onFilters({ ...filters, status })}
            >
              {STATUS_STYLE[status].label}
              <span className="text-xs text-muted-foreground">{statusCounts[status]}</span>
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Assignee">
          {(Object.keys(WHO_LABEL) as WhoFilter[]).map((who) => (
            <Chip
              key={who}
              selected={filters.who === who}
              onClick={() => onFilters({ ...filters, who })}
            >
              {WHO_LABEL[who]}
            </Chip>
          ))}
        </FilterGroup>

        <FilterGroup label="Priority">
          <Chip
            selected={!filters.priority}
            onClick={() => onFilters({ ...filters, priority: null })}
          >
            Any
          </Chip>
          {TASK_PRIORITIES.map((priority: PlanTaskPriority) => (
            <Chip
              key={priority}
              dot={PRIORITY_STYLE[priority].dot}
              selected={filters.priority === priority}
              onClick={() => onFilters({ ...filters, priority })}
            >
              {PRIORITY_STYLE[priority].label}
            </Chip>
          ))}
        </FilterGroup>

        {tags.length > 0 || filters.tag ? (
          <FilterGroup label="Tag">
            <Chip selected={!filters.tag} onClick={() => onFilters({ ...filters, tag: null })}>
              Any
            </Chip>
            {tags.map(({ tag, count }) => (
              <Chip
                key={tag}
                selected={filters.tag === tag}
                onClick={() => onFilters({ ...filters, tag })}
              >
                #{tag}
                <span className="text-xs text-muted-foreground">{count}</span>
              </Chip>
            ))}
          </FilterGroup>
        ) : null}

        {questions.open > 0 || filters.questions ? (
          <FilterGroup label="Questions">
            <Chip
              selected={filters.questions}
              onClick={() => onFilters({ ...filters, questions: !filters.questions })}
            >
              Needs an answer
              <span className="rounded-full bg-warning/25 px-1.5 text-xs">{questions.open}</span>
            </Chip>
          </FilterGroup>
        ) : null}

        <div className={cn("grid grid-cols-[auto_1fr] gap-2", STICKY_ACTIONS)}>
          <Button
            type="button"
            variant="outline"
            disabled={!hasActiveFilters(filters)}
            onClick={() => onFilters(NO_FILTERS)}
          >
            Clear
          </Button>
          <Button type="button" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Sticky bar: layout, search, filters, and the Activity toggle. */
export const PlanToolbar = forwardRef<
  HTMLInputElement,
  {
    layout: PlanLayout;
    onLayout: (layout: PlanLayout) => void;
    fileCount: number;
    hasRepo?: boolean;
    /** Pull requests the plan's tasks point at. The tab is only offered when there are some. */
    prCount?: number;
    /** Questions on the plan: open ones need an answer. The tab is offered when there are any. */
    questions?: { open: number; total: number };
    /** Tags in use on the plan's sections and tasks, most used first. */
    tags?: ReadonlyArray<{ tag: string; count: number }>;
    filters: TaskFilters;
    onFilters: (filters: TaskFilters) => void;
    statusCounts: Record<PlanTaskStatus, number>;
    total: number;
    activityOpen: boolean;
    unseen: number;
    onToggleActivity: () => void;
  }
>(function PlanToolbar(
  {
    layout,
    onLayout,
    fileCount,
    hasRepo = false,
    prCount = 0,
    questions = { open: 0, total: 0 },
    tags = [],
    filters,
    onFilters,
    statusCounts,
    total,
    activityOpen,
    unseen,
    onToggleActivity,
  },
  searchRef,
) {
  const isMobile = useIsMobile();
  const [filterOpen, setFilterOpen] = useState(false);

  if (isMobile) {
    const activeFilters = [
      filters.status,
      filters.priority,
      filters.tag,
      filters.who !== "all" ? filters.who : null,
      filters.questions ? "questions" : null,
    ].filter(Boolean).length;
    const views: Array<[PlanLayout, string]> = [
      ["columns", "Columns"],
      ["outline", "Outline"],
      ["files", fileCount > 0 ? `Files (${fileCount})` : "Files"],
      ...(hasRepo ? [["patches", "Patches"] as [PlanLayout, string]] : []),
      ...(questions.total > 0 || layout === "questions"
        ? [
            ["questions", questions.open > 0 ? `Questions (${questions.open})` : "Questions"] as [
              PlanLayout,
              string,
            ],
          ]
        : []),
      ...(prCount > 0 || layout === "prs"
        ? [
            ["prs", prCount > 0 ? `Pull requests (${prCount})` : "Pull requests"] as [
              PlanLayout,
              string,
            ],
          ]
        : []),
    ];
    return (
      <div
        role="toolbar"
        aria-label="Plan view"
        className="sticky top-0 z-20 mt-3 flex h-[var(--plan-toolbar-h,3.875rem)] shrink-0 items-center gap-2 border-y bg-surface px-4 py-2"
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`View: ${LAYOUT_LABEL[layout]}`}
              className="flex h-11 max-w-[8.5rem] shrink-0 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate">{LAYOUT_LABEL[layout]}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" collisionPadding={12} className="min-w-[200px]">
            {views.map(([value, label]) => (
              <Option
                key={value}
                label={label}
                selected={layout === value}
                onSelect={() => onLayout(value)}
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <input
          ref={searchRef}
          id="plan-search"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoCapitalize="none"
          autoCorrect="off"
          value={filters.q}
          onChange={(event) => onFilters({ ...filters, q: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (filters.q) onFilters({ ...filters, q: "" });
              else event.currentTarget.blur();
            }
          }}
          placeholder="Search tasks"
          aria-label="Search tasks"
          className="h-11 min-w-0 flex-1 rounded-lg border bg-card px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        <button
          type="button"
          aria-label={activeFilters > 0 ? `Filters, ${activeFilters} active` : "Filters"}
          onClick={() => setFilterOpen(true)}
          className={cn(
            "relative grid h-11 w-11 shrink-0 place-items-center rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            activeFilters > 0 ? "border-primary bg-accent" : "bg-card",
          )}
        >
          <SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden="true" />
          {activeFilters > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] text-primary-foreground"
            >
              {activeFilters}
            </span>
          ) : null}
        </button>

        <button
          type="button"
          aria-pressed={activityOpen}
          onClick={onToggleActivity}
          className={cn(
            "relative grid h-11 w-11 shrink-0 place-items-center rounded-lg border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            activityOpen ? "bg-accent" : "bg-card",
          )}
        >
          <Activity className="h-[18px] w-[18px]" aria-hidden="true" />
          <span className="sr-only">Activity</span>
          {unseen > 0 ? (
            <span
              className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] text-primary-foreground"
              aria-label={`${unseen} new`}
            >
              {unseen}
            </span>
          ) : null}
        </button>

        <FilterSheet
          open={filterOpen}
          onOpenChange={setFilterOpen}
          filters={filters}
          onFilters={onFilters}
          statusCounts={statusCounts}
          total={total}
          tags={tags}
          questions={questions}
        />
      </div>
    );
  }

  return (
    <div
      role="toolbar"
      aria-label="Plan view"
      className="sticky top-0 z-20 mt-4 flex shrink-0 flex-wrap items-center gap-2.5 border-y bg-surface px-4 py-3 md:px-8"
    >
      <Segmented<PlanLayout>
        label="Board layout"
        value={layout}
        onChange={onLayout}
        options={[
          { value: "columns", label: "Columns" },
          { value: "outline", label: "Outline" },
          {
            value: "files",
            label: (
              <span className="inline-flex items-center gap-1.5">
                Files
                {fileCount > 0 ? (
                  <span className="text-[11px] text-muted-foreground">{fileCount}</span>
                ) : null}
              </span>
            ),
            ariaLabel: "Files",
          },
          ...(hasRepo
            ? [{ value: "patches" as const, label: "Patches", ariaLabel: "Patches" }]
            : []),
          ...(questions.total > 0 || layout === "questions"
            ? [
                {
                  value: "questions" as const,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      Questions
                      {questions.open > 0 ? (
                        <span className="rounded-full bg-warning/25 px-1.5 text-[11px] text-foreground">
                          {questions.open}
                        </span>
                      ) : null}
                    </span>
                  ),
                  ariaLabel: "Questions",
                },
              ]
            : []),
          // Offered when there is something to show, or when it is already the open view.
          ...(prCount > 0 || layout === "prs"
            ? [
                {
                  value: "prs" as const,
                  label: (
                    <span className="inline-flex items-center gap-1.5">
                      Pull requests
                      {prCount > 0 ? (
                        <span className="text-[11px] text-muted-foreground">{prCount}</span>
                      ) : null}
                    </span>
                  ),
                  ariaLabel: "Pull requests",
                },
              ]
            : []),
        ]}
      />

      <input
        ref={searchRef}
        id="plan-search"
        type="search"
        value={filters.q}
        onChange={(event) => onFilters({ ...filters, q: event.target.value })}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            if (filters.q) onFilters({ ...filters, q: "" });
            else event.currentTarget.blur();
          }
        }}
        placeholder="Search title, tag, id  /"
        aria-label="Search tasks"
        className="h-[34px] w-[190px] rounded-lg border bg-card px-3 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      <FilterMenu
        label="Status"
        current={filters.status ? STATUS_STYLE[filters.status].label : "Any"}
        active={Boolean(filters.status)}
      >
        <Option
          label="Any status"
          count={total}
          selected={!filters.status}
          onSelect={() => onFilters({ ...filters, status: null })}
        />
        {TASK_STATUSES.map((status) => (
          <Option
            key={status}
            label={STATUS_STYLE[status].label}
            dot={STATUS_STYLE[status].dot}
            count={statusCounts[status]}
            selected={filters.status === status}
            onSelect={() => onFilters({ ...filters, status })}
          />
        ))}
      </FilterMenu>

      <FilterMenu label="Assignee" current={WHO_LABEL[filters.who]} active={filters.who !== "all"}>
        {(Object.keys(WHO_LABEL) as WhoFilter[]).map((who) => (
          <Option
            key={who}
            label={WHO_LABEL[who]}
            selected={filters.who === who}
            onSelect={() => onFilters({ ...filters, who })}
          />
        ))}
      </FilterMenu>

      <FilterMenu
        label="Priority"
        current={filters.priority ? PRIORITY_STYLE[filters.priority].label : "Any"}
        active={Boolean(filters.priority)}
      >
        <Option
          label="Any priority"
          selected={!filters.priority}
          onSelect={() => onFilters({ ...filters, priority: null })}
        />
        {TASK_PRIORITIES.map((priority: PlanTaskPriority) => (
          <Option
            key={priority}
            label={PRIORITY_STYLE[priority].label}
            dot={PRIORITY_STYLE[priority].dot}
            selected={filters.priority === priority}
            onSelect={() => onFilters({ ...filters, priority })}
          />
        ))}
      </FilterMenu>

      {tags.length > 0 || filters.tag ? (
        <FilterMenu
          label="Tag"
          current={filters.tag ? `#${filters.tag}` : "Any"}
          active={Boolean(filters.tag)}
        >
          <Option
            label="Any tag"
            selected={!filters.tag}
            onSelect={() => onFilters({ ...filters, tag: null })}
          />
          {tags.map(({ tag, count }) => (
            <Option
              key={tag}
              label={`#${tag}`}
              count={count}
              selected={filters.tag === tag}
              onSelect={() => onFilters({ ...filters, tag })}
            />
          ))}
        </FilterMenu>
      ) : null}

      {questions.open > 0 || filters.questions ? (
        <button
          type="button"
          aria-pressed={filters.questions}
          onClick={() => onFilters({ ...filters, questions: !filters.questions })}
          className={cn(
            "flex h-[34px] items-center gap-1.5 rounded-lg border px-3 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            filters.questions ? "border-primary bg-accent" : "bg-card",
          )}
        >
          Needs an answer
          <span className="rounded-full bg-warning/25 px-1.5 text-[11px]">{questions.open}</span>
        </button>
      ) : null}

      {hasActiveFilters(filters) ? (
        <button
          type="button"
          onClick={() => onFilters(NO_FILTERS)}
          className="h-[34px] px-2 text-[13px] text-primary hover:underline"
        >
          Clear
        </button>
      ) : null}

      <span className="flex-1" />

      <button
        type="button"
        aria-pressed={activityOpen}
        onClick={onToggleActivity}
        className={cn(
          "flex h-[34px] shrink-0 items-center gap-2 rounded-lg border px-3.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          activityOpen ? "bg-accent" : "bg-card",
        )}
      >
        Activity
        {unseen > 0 ? (
          <span
            className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-[5px] text-[11px] text-primary-foreground"
            aria-label={`${unseen} new`}
          >
            {unseen}
          </span>
        ) : null}
      </button>
    </div>
  );
});
