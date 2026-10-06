import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { QueryState } from "@/components/query-state";
import { useAuth } from "@/components/auth-provider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { planDetailQuery } from "@/data/planner";
import type { PlanSection, PlanStatus, PlanWithSections } from "@/data";
import { PLAN_STATUS_LABEL } from "@/data/enums";
import { defaultBoardLayout } from "@/lib/board-view";
import { updatePlan } from "@/lib/planner.functions";
import { useHotkeys } from "@/lib/use-hotkeys";
import { useServerAction } from "@/lib/use-server-action";
import { qk } from "@/data/keys";
import { ApiKeyManager } from "@/features/settings/api-key-manager";
import { useImportOpenTickets } from "./import-tickets-button";
import { PlanActivityPanel } from "./plan-activity-panel";
import { PlanAiMenu, TaskAiMenu, useAutoEnrich } from "./ai-plan-actions";
import { PlanBoard } from "./plan-board";
import { PlanDeleteDialog } from "./plan-delete-dialog";
import { NewTaskDialog, SectionDialog, DIALOG_CONTENT, DIALOG_TITLE } from "./plan-dialogs";
import { PlanFilesView } from "./plan-files-view";
import { PlanPullRequests } from "./plan-pull-requests";
import { PlanPatches } from "./plan-patches";
import { PlanQuestionsView } from "./plan-questions-view";
import { collectTags } from "@/lib/plan-fields";
import { hasLivePullRequest } from "@/lib/plan-refs";
import { PlanGettingStarted } from "./plan-getting-started";
import { PlanHeader } from "./plan-header";
import { downloadPlanMarkdown } from "./plan-export";
import { ImportMarkdownDialog } from "./plan-markdown-controls";
import { PlanMediaProvider, usePlanMedia } from "./plan-media";
import {
  boardOrder,
  countByStatus,
  hasActiveFilters,
  NO_FILTERS,
  planQuestionCounts,
  removeTaskFromPlan,
  tasksOf,
  type FileKindFilter,
  type TaskFilters,
} from "./plan-model";
import { PlanSettingsForm } from "./plan-settings-form";
import { PlanTaskDrawer } from "./plan-task-drawer";
import { PlanToolbar, type PlanLayout } from "./plan-toolbar";
import { usePlanActions } from "./use-plan-actions";
import { PlanUploadsProvider } from "./use-plan-uploads";
import { usePlanRealtime } from "./use-plan-realtime";
import { cn } from "@/lib/utils";

type Modal = "newtask" | "section" | "settings" | "import" | "keys" | "delete" | null;

/**
 * The plan screen: roadmap header, toolbar, board (columns, outline or files),
 * activity panel, task drawer and dialogs. The open task lives in the URL so a
 * task can be linked to.
 */
export function PlanScreen({
  planId,
  taskId,
  onTaskChange,
  onDeleted,
}: {
  planId: string;
  taskId: string | null;
  onTaskChange: (taskId: string | null) => void;
  /** The plan was deleted from this screen; leave it. */
  onDeleted?: (plan: { projectId: string | null }) => void | Promise<void>;
}) {
  const planQuery = useQuery(planDetailQuery(planId));
  // While a delete is in flight the rows disappear under the live connection and a refetch
  // would fail. Show a quiet "deleting" state instead of "Couldn’t load plan".
  const [deleting, setDeleting] = useState(false);

  if (deleting) {
    return (
      <div
        role="status"
        className="flex items-center justify-center gap-2 text-muted-foreground max-md:h-mobile-view md:h-dvh"
      >
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        Deleting plan…
      </div>
    );
  }

  return (
    <div className="flex flex-col overflow-hidden bg-background max-md:h-mobile-view md:h-dvh">
      <QueryState
        query={planQuery}
        errorTitle="Couldn't load plan"
        pending={
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        }
      >
        {({ plan }) => (
          <PlanUploadsProvider planId={planId}>
            <PlanMediaProvider planId={planId}>
              <PlanScreenBody
                planId={planId}
                rawPlan={plan as unknown as PlanWithSections}
                taskId={taskId}
                onTaskChange={onTaskChange}
                onDeleting={setDeleting}
                onDeleted={onDeleted}
              />
            </PlanMediaProvider>
          </PlanUploadsProvider>
        )}
      </QueryState>
    </div>
  );
}

function PlanScreenBody({
  planId,
  rawPlan,
  taskId,
  onTaskChange,
  onDeleting,
  onDeleted,
}: {
  planId: string;
  rawPlan: PlanWithSections;
  taskId: string | null;
  onTaskChange: (taskId: string | null) => void;
  onDeleting: (deleting: boolean) => void;
  onDeleted?: (plan: { projectId: string | null }) => void | Promise<void>;
}) {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const meId = user?.id ?? null;
  const media = usePlanMedia();
  const actions = usePlanActions(planId);
  const importTickets = useImportOpenTickets(planId);
  const setPlanStatus = useServerAction(useServerFn(updatePlan), {
    label: "plans.update",
    invalidate: [qk.plan(planId), qk.planList(), qk.planEvents(planId)],
  });

  // A task waiting out its Undo window is hidden, not yet deleted.
  const plan = useMemo(() => {
    let next = rawPlan;
    for (const id of actions.pendingDelete) next = removeTaskFromPlan(next, id);
    return next;
  }, [rawPlan, actions.pendingDelete]);

  const tasks = useMemo(() => tasksOf(plan), [plan]);
  const tags = useMemo(() => collectTags(plan), [plan]);
  const tagNames = useMemo(() => tags.map((entry) => entry.tag), [tags]);
  const questions = useMemo(() => {
    const open = planQuestionCounts(tasks).open;
    const total = tasks.reduce((sum, task) => sum + (task.questions?.length ?? 0), 0);
    return { open, total };
  }, [tasks]);
  const pullRequestCount = useMemo(
    () => new Set(tasks.filter(hasLivePullRequest).map((task) => task.pr_url?.trim())).size,
    [tasks],
  );
  const [layoutChoice, setLayoutChoice] = useState<PlanLayout | null>(null);
  const layout: PlanLayout =
    layoutChoice ?? (defaultBoardLayout(plan.sections.length) as PlanLayout);
  const [filters, setFilters] = useState<TaskFilters>(NO_FILTERS);
  const [fileKind, setFileKind] = useState<FileKindFilter>("all");
  const [sectionId, setSectionId] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [unseen, setUnseen] = useState(0);
  const [modal, setModal] = useState<Modal>(null);
  const [editingSection, setEditingSection] = useState<PlanSection | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const activityOpenRef = useRef(activityOpen);
  activityOpenRef.current = activityOpen;

  usePlanRealtime(planId, (event) => {
    if (!activityOpenRef.current && event.actor_id !== meId) setUnseen((n) => n + 1);
  });

  const order = useMemo(() => boardOrder(plan, filters, meId), [plan, filters, meId]);
  // Runs only when the person turned it on in Settings and AI is configured.
  useAutoEnrich(plan);
  const empty = plan.sections.length === 0;
  const modalOpen = modal !== null;

  useHotkeys(
    {
      n: (event) => {
        event.preventDefault();
        openNewTask();
      },
      "/": (event) => {
        event.preventDefault();
        searchRef.current?.focus();
      },
    },
    { enabled: !modalOpen && !taskId },
  );

  const selectedSection = plan.sections.find((s) => s.id === sectionId) ?? plan.sections[0];

  const openNewTask = () => {
    if (plan.sections.length === 0) {
      setEditingSection(null);
      setModal("section");
      return;
    }
    setModal("newtask");
  };

  const focusSection = useCallback(
    (id: string) => {
      if (layout === "outline") {
        setSectionId(id);
        if (!isMobile) return;
      } else if (
        layout === "files" ||
        layout === "prs" ||
        layout === "questions" ||
        layout === "patches"
      ) {
        setLayoutChoice("columns");
      }
      // The columns render on the next frame when switching from Files. On a phone the page
      // scrolls too, so bring the section up under the sticky bars.
      requestAnimationFrame(() =>
        document.getElementById(`col-${id}`)?.scrollIntoView({
          behavior: "smooth",
          inline: "start",
          block: isMobile ? "start" : "nearest",
        }),
      );
    },
    [layout, isMobile],
  );

  const toggleActivity = () => {
    setActivityOpen((open) => !open);
    setUnseen(0);
  };

  const closeModal = () => {
    setModal(null);
    setEditingSection(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto max-md:overscroll-contain max-md:[--plan-toolbar-h:3.875rem]">
      <PlanHeader
        plan={plan}
        layout={layout}
        aiMenu={<PlanAiMenu plan={plan} selectedTaskIds={hasActiveFilters(filters) ? order : []} />}
        actions={{
          onNewTask: openNewTask,
          onAddSection: () => {
            setEditingSection(null);
            setModal("section");
          },
          onOpenSettings: () => setModal("settings"),
          onImportMarkdown: () => setModal("import"),
          onExportMarkdown: () => downloadPlanMarkdown(plan),
          onOpenApiKeys: () => setModal("keys"),
          onDeletePlan: () => setModal("delete"),
          onImportTickets: () => importTickets.fire({ planId }),
          onSetStatus: (status: PlanStatus) => {
            if (status === plan.status) return;
            setPlanStatus
              .run({ planId, status })
              .then(() => toast.success(`Plan is now ${PLAN_STATUS_LABEL[status].toLowerCase()}`))
              .catch(() => {
                // The action already told the user why.
              });
          },
          onFocusSection: focusSection,
          onFilterStatus: (status) => {
            setFilters((current) => ({ ...current, status }));
            if (
              layout === "files" ||
              layout === "prs" ||
              layout === "questions" ||
              layout === "patches"
            ) {
              setLayoutChoice("columns");
            }
          },
          onShowQuestions: () => setLayoutChoice("questions"),
          importingTickets: importTickets.busy,
        }}
      />

      <PlanToolbar
        ref={searchRef}
        layout={layout}
        onLayout={setLayoutChoice}
        fileCount={media.visible.length}
        hasRepo={Boolean(plan.github_repo)}
        prCount={pullRequestCount}
        questions={questions}
        tags={tags}
        filters={filters}
        onFilters={setFilters}
        statusCounts={countByStatus(tasks)}
        total={tasks.length}
        activityOpen={activityOpen}
        unseen={unseen}
        onToggleActivity={toggleActivity}
      />

      <div className="flex min-h-[560px] flex-1 flex-col max-md:min-h-[40dvh] max-md:flex-none md:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {empty && layout !== "patches" ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <PlanGettingStarted
                hasProject={Boolean(plan.project_id)}
                importing={importTickets.busy}
                onAddSection={() => {
                  setEditingSection(null);
                  setModal("section");
                }}
                onImportMarkdown={() => setModal("import")}
                onImportTickets={() => importTickets.fire({ planId })}
              />
            </div>
          ) : layout === "patches" ? (
            <PlanPatches plan={plan} />
          ) : layout === "prs" ? (
            <PlanPullRequests planId={planId} />
          ) : layout === "questions" ? (
            <PlanQuestionsView plan={plan} actions={actions} onOpenTask={onTaskChange} />
          ) : layout === "files" ? (
            <PlanFilesView
              plan={plan}
              filters={filters}
              meId={meId}
              kind={fileKind}
              onKind={setFileKind}
              onOpenTask={onTaskChange}
            />
          ) : (
            <PlanBoard
              plan={plan}
              layout={layout}
              filters={filters}
              meId={meId}
              activeTaskId={taskId}
              selectedSectionId={selectedSection?.id ?? null}
              onSelectSection={setSectionId}
              onOpenTask={onTaskChange}
              onAddSection={() => {
                setEditingSection(null);
                setModal("section");
              }}
              onEditSection={(section) => {
                setEditingSection(section);
                setModal("section");
              }}
              onTagFilter={(tag) => setFilters((current) => ({ ...current, tag }))}
              actions={actions}
            />
          )}
        </div>

        {activityOpen && !isMobile ? (
          <PlanActivityPanel plan={plan} onClose={toggleActivity} onOpenTask={onTaskChange} />
        ) : null}
      </div>

      {isMobile && !empty && (layout === "columns" || layout === "outline") ? (
        <div className="pointer-events-none sticky bottom-0 z-30 h-0 shrink-0">
          <button
            type="button"
            aria-label="New task"
            onClick={openNewTask}
            className="pointer-events-auto absolute bottom-4 right-4 grid h-14 w-14 place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus className="h-6 w-6" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {isMobile ? (
        <Dialog open={activityOpen} onOpenChange={(open) => !open && toggleActivity()}>
          <DialogContent className="max-md:gap-0 max-md:overflow-hidden max-md:px-0 max-md:pb-0">
            <DialogTitle className="sr-only">Activity</DialogTitle>
            <DialogDescription className="sr-only">
              What agents and teammates did on this plan.
            </DialogDescription>
            <PlanActivityPanel
              sheet
              plan={plan}
              onClose={toggleActivity}
              onOpenTask={(id) => {
                setActivityOpen(false);
                onTaskChange(id);
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      <PlanTaskDrawer
        plan={plan}
        taskId={taskId}
        order={order}
        actions={actions}
        onSelect={onTaskChange}
        renderAiMenu={(task) => <TaskAiMenu plan={plan} task={task} />}
      />

      <NewTaskDialog
        open={modal === "newtask"}
        onOpenChange={(open) => !open && closeModal()}
        sections={plan.sections}
        defaultSectionId={layout === "outline" ? selectedSection?.id : undefined}
        busy={actions.create.busy}
        onCreate={async ({ sectionId: target, title }) => {
          try {
            const created = await actions.create.run({ planId, sectionId: target, title });
            closeModal();
            onTaskChange(created.id);
          } catch {
            // The action already told the user why.
          }
        }}
      />

      <SectionDialog
        open={modal === "section"}
        onOpenChange={(open) => !open && closeModal()}
        section={editingSection}
        busy={actions.addSection.busy || actions.editSection.busy}
        tagSuggestions={tagNames}
        onSubmit={async (values) => {
          try {
            if (editingSection) {
              await actions.editSection.run({
                sectionId: editingSection.id,
                title: values.title,
                description: values.description || null,
                goals: values.goals || null,
                intentions: values.intentions || null,
                color: values.color,
                tags: values.tags,
              });
            } else {
              await actions.addSection.run({
                planId,
                title: values.title,
                description: values.description || undefined,
                goals: values.goals || undefined,
                intentions: values.intentions || undefined,
                color: values.color ?? undefined,
                tags: values.tags,
              });
            }
            closeModal();
          } catch {
            // The action already told the user why.
          }
        }}
      />

      <Dialog open={modal === "settings"} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className={cn("max-h-[90vh] max-w-[540px] overflow-auto", DIALOG_CONTENT)}>
          <DialogHeader>
            <DialogTitle className={DIALOG_TITLE}>Plan settings</DialogTitle>
            <DialogDescription className="sr-only">
              Title, status, linked project and repository.
            </DialogDescription>
          </DialogHeader>
          <PlanSettingsForm plan={plan} onClose={closeModal} />
        </DialogContent>
      </Dialog>

      <PlanDeleteDialog
        plan={{
          id: planId,
          title: plan.title,
          status: plan.status ?? "draft",
          sections: plan.sections.length,
          tasks: tasks.length,
        }}
        open={modal === "delete"}
        onOpenChange={(open) => !open && closeModal()}
        onDeleting={onDeleting}
        onDeleted={() => onDeleted?.({ projectId: plan.project_id })}
      />

      <ImportMarkdownDialog
        planId={planId}
        open={modal === "import"}
        onOpenChange={(open) => !open && closeModal()}
      />

      <Dialog open={modal === "keys"} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className={cn("max-h-[90vh] max-w-[780px] overflow-auto", DIALOG_CONTENT)}>
          <DialogHeader>
            <DialogTitle className={DIALOG_TITLE}>Planner API keys</DialogTitle>
            <DialogDescription className="sr-only">
              Generate and revoke the keys agents use on plans.
            </DialogDescription>
          </DialogHeader>
          <ApiKeyManager kind="planner" onClose={closeModal} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
