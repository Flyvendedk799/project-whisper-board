import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { Segmented } from "@/components/status-pill";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PlanTaskPriority, PlanTaskStatus } from "@/data";
import { cn } from "@/lib/utils";
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
