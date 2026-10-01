import { useCallback, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2 } from "lucide-react";
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
import { PlanBoard } from "./plan-board";
import { NewTaskDialog, SectionDialog, DIALOG_CONTENT, DIALOG_TITLE } from "./plan-dialogs";
import { PlanFilesView } from "./plan-files-view";
import { PlanGettingStarted } from "./plan-getting-started";
import { PlanHeader } from "./plan-header";
import { downloadPlanMarkdown } from "./plan-export";
import { ImportMarkdownDialog } from "./plan-markdown-controls";
import { PlanMediaProvider, usePlanMedia } from "./plan-media";
import {
  boardOrder,
  countByStatus,
  NO_FILTERS,
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

type Modal = "newtask" | "section" | "settings" | "import" | "keys" | null;

/**
 * The plan screen: roadmap header, toolbar, board (columns, outline or files),
 * activity panel, task drawer and dialogs. The open task lives in the URL so a
 * task can be linked to.
 */
export function PlanScreen({
  planId,
  taskId,
  onTaskChange,
}: {
  planId: string;
  taskId: string | null;
  onTaskChange: (taskId: string | null) => void;
}) {
  const planQuery = useQuery(planDetailQuery(planId));

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden bg-background md:h-dvh">
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
}: {
  planId: string;
  rawPlan: PlanWithSections;
  taskId: string | null;
  onTaskChange: (taskId: string | null) => void;
}) {
  const { user } = useAuth();
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
        return;
      }
      if (layout === "files") setLayoutChoice("columns");
      // The columns render on the next frame when switching from Files.
      requestAnimationFrame(() =>
        document
          .getElementById(`col-${id}`)
          ?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" }),
      );
    },
    [layout],
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
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <PlanHeader
        plan={plan}
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
            if (layout === "files") setLayoutChoice("columns");
          },
          importingTickets: importTickets.busy,
        }}
      />

      <PlanToolbar
        ref={searchRef}
        layout={layout}
        onLayout={setLayoutChoice}
        fileCount={media.visible.length}
        filters={filters}
        onFilters={setFilters}
        statusCounts={countByStatus(tasks)}
        total={tasks.length}
        activityOpen={activityOpen}
        unseen={unseen}
        onToggleActivity={toggleActivity}
      />

      <div className="flex min-h-[560px] flex-1 flex-col md:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {empty ? (
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
              onRenameSection={(section) => {
                setEditingSection(section);
                setModal("section");
              }}
              actions={actions}
            />
          )}
        </div>

        {activityOpen ? (
          <PlanActivityPanel plan={plan} onClose={toggleActivity} onOpenTask={onTaskChange} />
        ) : null}
      </div>

      <PlanTaskDrawer
        plan={plan}
        taskId={taskId}
        order={order}
        actions={actions}
        onSelect={onTaskChange}
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
        onSubmit={async (title) => {
          try {
            if (editingSection) {
              await actions.editSection.run({ sectionId: editingSection.id, title });
            } else {
              await actions.addSection.run({ planId, title });
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
