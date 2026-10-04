import { Link } from "@tanstack/react-router";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { PlanStatus, PlanWithSections } from "@/data";
import { PLAN_STATUS_LABEL } from "@/data/enums";
import { repoWebUrl } from "@/lib/github-url";
import { workTargetOf } from "@/lib/plan-fields";
import { CopyIdButton } from "./copy-id-button";
import { cn } from "@/lib/utils";
import {
  attentionChips,
  planQuestionCounts,
  progressOf,
  sectionColor,
  sortedTasks,
  tasksOf,
  workingAgentCount,
  type TaskFilters,
} from "./plan-model";

const PLAN_STATUSES: PlanStatus[] = ["draft", "active", "paused", "completed", "archived"];

const PLAN_STATUS_CLASS: Record<PlanStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-success/15 text-foreground",
  paused: "bg-warning/15 text-foreground",
  completed: "bg-info/15 text-foreground",
  archived: "bg-muted text-muted-foreground",
};

export interface PlanHeaderActions {
  onNewTask: () => void;
  onAddSection: () => void;
  onOpenSettings: () => void;
  onImportMarkdown: () => void;
  onExportMarkdown: () => void;
  onOpenApiKeys: () => void;
  onDeletePlan: () => void;
  onImportTickets: () => void;
  onSetStatus: (status: PlanStatus) => void;
  /** Roadmap card clicked: bring that section into view. */
  onFocusSection: (sectionId: string) => void;
  onFilterStatus: (status: TaskFilters["status"]) => void;
  /** The "N questions" chip: show what is waiting for an answer. */
  onShowQuestions: () => void;
  importingTickets?: boolean;
}

/**
 * Breadcrumb, title and status, the Plan options menu, and the roadmap: one
 * card per section with its own progress, plus what needs a person right now.
 */
export function PlanHeader({
  plan,
  actions,
  aiMenu,
}: {
  plan: PlanWithSections;
  actions: PlanHeaderActions;
  /** The plan's AI menu (Audit plan and friends), shown only when AI is configured. */
  aiMenu?: React.ReactNode;
}) {
  const tasks = tasksOf(plan);
  const overall = progressOf(tasks);
  const attention = attentionChips(tasks);
  const questions = planQuestionCounts(tasks);
  const work = workTargetOf(plan);
  const agents = workingAgentCount(tasks);
  const status = (plan.status ?? "draft") as PlanStatus;
  const empty = plan.sections.length === 0;
  const repoUrl = plan.github_repo ? repoWebUrl(plan.github_repo) : null;

  return (
    <header className="flex shrink-0 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2.5 text-[13px] text-muted-foreground max-md:py-0 md:px-8">
        <Link
          to="/app/planner"
          search={{ project: plan.project_id ?? undefined }}
          className="hover:text-foreground max-md:inline-flex max-md:min-h-11 max-md:shrink-0 max-md:items-center"
        >
          ← Plans
        </Link>
        {plan.project ? (
          <>
            <span aria-hidden="true">/</span>
            <Link
              to="/app/projects/$projectId"
              params={{ projectId: plan.project.id }}
              search={{ tab: "plans" }}
              className="truncate hover:text-foreground max-md:inline-flex max-md:min-w-0 max-md:min-h-11 max-md:items-center"
            >
              {plan.project.title}
            </Link>
          </>
        ) : null}
        <span className="flex-1" />
        <span
          className="flex items-center gap-1.5 text-xs max-md:shrink-0 max-md:whitespace-nowrap"
          aria-live="polite"
        >
          <span
            aria-hidden="true"
            className="h-[7px] w-[7px] animate-pulse rounded-full bg-success"
          />
          Live · {agents} agent{agents === 1 ? "" : "s"} working
        </span>
      </div>

      <div className="flex flex-col gap-[18px] px-4 pt-5 max-md:gap-4 max-md:pt-4 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:gap-6">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-3 max-md:gap-x-2.5 max-md:gap-y-1">
              <h1 className="font-display text-[38px] font-normal leading-[1.1] tracking-[-0.01em] max-md:w-full max-md:min-w-0 max-md:break-words max-md:text-[28px]">
                {plan.title}
              </h1>
              <CopyIdButton id={plan.id} label="plan" showId className="max-md:-ml-2 max-md:p-2" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title="Change plan status"
                    className={cn(
                      "relative inline-flex h-[26px] items-center gap-1 rounded-full px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:h-9 max-md:px-3.5 max-md:text-sm max-md:before:absolute max-md:before:inset-x-0 max-md:before:-inset-y-1 max-md:before:content-['']",
                      PLAN_STATUS_CLASS[status],
                    )}
                  >
                    {PLAN_STATUS_LABEL[status]}
                    <ChevronDown className="h-3 w-3" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-40">
                  {PLAN_STATUSES.map((value) => (
                    <DropdownMenuItem
                      key={value}
                      className={cn(value === status && "bg-accent")}
                      onSelect={() => actions.onSetStatus(value)}
                    >
                      {PLAN_STATUS_LABEL[value]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {plan.description ? (
              <p className="mt-1.5 max-w-[660px] leading-normal max-md:break-words text-muted-foreground">
                {plan.description}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-muted-foreground max-md:break-all max-md:text-[13px]">
              {plan.github_repo ? (
                <>
                  {repoUrl ? (
                    <a
                      href={repoUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary hover:underline"
                    >
                      {plan.github_repo}
                    </a>
                  ) : (
                    <span>{plan.github_repo}</span>
                  )}
                  <span>base: {plan.github_base || "main"}</span>
                  {work.mode === "base" ? (
                    <span>working directly on {plan.github_base || "main"}</span>
                  ) : work.branch ? (
                    <span>
                      working on <span className="font-mono">{work.branch}</span>
                      {work.mode === "new" ? " (new)" : ""}
                    </span>
                  ) : null}
                </>
              ) : (
                <button
                  type="button"
                  onClick={actions.onOpenSettings}
                  className="text-primary hover:underline max-md:-my-2 max-md:text-left max-md:py-2.5 max-md:text-sm"
                >
                  Connect a GitHub repository so agents can link PRs
                </button>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 max-md:w-full">
            {aiMenu}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 gap-1.5 max-md:w-11 max-md:shrink-0 max-md:px-0"
                >
                  <span className="max-md:sr-only">Plan options</span>
                  <ChevronDown className="h-3.5 w-3.5 max-md:hidden" aria-hidden="true" />
                  <MoreHorizontal className="hidden h-5 w-5 max-md:block" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" collisionPadding={12} className="w-[270px]">
                <OptionItem
                  label="Add open tickets"
                  hint={
                    plan.project_id
                      ? "One task per open ticket not on this plan"
                      : "Link a project first"
                  }
                  disabled={!plan.project_id || actions.importingTickets}
                  onSelect={actions.onImportTickets}
                />
                <OptionItem
                  label="Import Markdown"
                  hint="Merge or replace from an outline"
                  onSelect={actions.onImportMarkdown}
                />
                <OptionItem
                  label="Export Markdown"
                  hint={empty ? "Add a section before exporting" : "Download this plan as .md"}
                  disabled={empty}
                  onSelect={actions.onExportMarkdown}
                />
                <DropdownMenuSeparator />
                <OptionItem
                  label="Planner API keys"
                  hint="Let agents read and update this plan"
                  onSelect={actions.onOpenApiKeys}
                />
                <OptionItem
                  label="Plan settings"
                  hint="Title, status, project, repository"
                  onSelect={actions.onOpenSettings}
                />
                <DropdownMenuSeparator />
                <OptionItem
                  label="Delete plan…"
                  hint="Remove it and all its tasks for good"
                  destructive
                  onSelect={actions.onDeletePlan}
                />
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              className="h-9 gap-2 max-md:order-first max-md:flex-1"
              onClick={actions.onNewTask}
            >
              + New task
              <kbd className="rounded border border-primary-foreground/50 px-[5px] text-[11px] font-normal opacity-85 max-md:hidden">
                N
              </kbd>
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 max-md:gap-x-2.5 max-md:gap-y-3">
            <span className="font-display text-[28px] leading-none">{overall.percent}%</span>
            <span className="text-muted-foreground">
              {overall.done} of {overall.total} tasks done
            </span>
            <span className="flex-1" />
            <span
              aria-hidden="true"
              className="block h-1.5 w-full overflow-hidden rounded-full bg-muted md:hidden"
            >
              <span
                className="block h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${overall.percent}%` }}
              />
            </span>
            {attention.length > 0 || questions.open > 0 ? (
              <div className="flex flex-wrap items-center gap-2 rounded-full bg-accent py-1 pl-3 pr-1 text-[13px] max-md:w-full max-md:rounded-2xl max-md:p-2 max-md:pl-3">
                <span>Needs you</span>
                {questions.open > 0 ? (
                  <button
                    type="button"
                    onClick={actions.onShowQuestions}
                    className="h-6 rounded-full bg-card px-2.5 text-xs font-medium hover:bg-card/70 max-md:h-10 max-md:px-3.5 max-md:text-[13px]"
                  >
                    {questions.open} {questions.open === 1 ? "question" : "questions"}
                    {questions.blocking > 0 ? ` (${questions.blocking} blocking)` : ""}
                  </button>
                ) : null}
                {attention.map((chip) => (
                  <button
                    key={chip.status}
                    type="button"
                    onClick={() => actions.onFilterStatus(chip.status)}
                    className="h-6 rounded-full bg-card px-2.5 text-xs font-medium hover:bg-card/70 max-md:h-10 max-md:px-3.5 max-md:text-[13px]"
                  >
                    {chip.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <ul
            aria-label="Roadmap"
            className="flex items-stretch gap-2.5 overflow-x-auto overflow-y-hidden px-0.5 pb-2 pt-0.5 max-md:no-scrollbar max-md:-mx-4 max-md:snap-x max-md:snap-proximity max-md:scroll-px-4 max-md:overscroll-x-contain max-md:px-4"
          >
            {plan.sections.map((section, index) => {
              const mine = sortedTasks(section.tasks ?? []);
              const progress = progressOf(mine);
              const color = sectionColor(section.color, index);
              return (
                <li
                  key={section.id}
                  className="min-w-[180px] max-w-[280px] flex-1 basis-[180px] max-md:snap-start"
                >
                  <button
                    type="button"
                    onClick={() => actions.onFocusSection(section.id)}
                    aria-label={`${section.title}: ${progress.done} of ${progress.total} done`}
                    className="flex h-full min-h-14 w-full flex-col gap-2 rounded-xl border bg-card px-3.5 py-3 text-left transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="flex-1 text-[13px] font-medium leading-tight">
                        {section.title}
                      </span>
                      <span className="font-display text-lg leading-none">
                        {progress.done}/{progress.total}
                      </span>
                    </span>
                    <span
                      role="progressbar"
                      aria-label={`${section.title} progress`}
                      aria-valuenow={progress.percent}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      className="block h-[5px] overflow-hidden rounded-full bg-muted"
                    >
                      <span
                        className="block h-full transition-[width] duration-300"
                        style={{ width: `${progress.percent}%`, backgroundColor: color }}
                      />
                    </span>
                  </button>
                </li>
              );
            })}
            <li className="flex max-md:snap-start">
              <button
                type="button"
                onClick={actions.onAddSection}
                className="rounded-xl border border-dashed px-4 text-[13px] text-muted-foreground hover:bg-muted/60 max-md:min-h-14 max-md:whitespace-nowrap"
              >
                + Section
              </button>
            </li>
          </ul>
        </div>
      </div>
    </header>
  );
}

function OptionItem({
  label,
  hint,
  disabled,
  destructive,
  onSelect,
}: {
  label: string;
  hint: string;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex-col items-start gap-0 py-2",
        destructive && "text-destructive focus:text-destructive",
      )}
    >
      <span className="text-[13px] max-md:text-sm">{label}</span>
      <span className="text-[11px] text-muted-foreground max-md:text-xs">{hint}</span>
    </DropdownMenuItem>
  );
}
