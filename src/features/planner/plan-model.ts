/**
 * Pure logic behind the plan screen: how tasks are filtered, ordered, moved and
 * counted, and how attachments are grouped. No React, no network, so it is
 * tested directly and shared with the server functions that reorder tasks.
 */
import type {
  PlanAttachmentWithUrl,
  PlanEventKind,
  PlanTaskPriority,
  PlanTaskStatus,
  PlanWithSections,
  TaskWithAgent,
} from "@/data";
import type { PlanAttachmentKind } from "@/lib/upload";
import { attachmentKindOf } from "@/lib/upload";
import { cardFace } from "@/lib/board-view";
import { matchesIdQuery, questionCounts } from "@/lib/plan-fields";

// ---------------------------------------------------------------------------
// Statuses, priorities, sizes
// ---------------------------------------------------------------------------

export const TASK_STATUSES: readonly PlanTaskStatus[] = [
  "backlog",
  "available",
  "claimed",
  "in_progress",
  "in_review",
  "done",
  "blocked",
];

export const TASK_PRIORITIES: readonly PlanTaskPriority[] = ["critical", "high", "medium", "low"];

export const TASK_COMPLEXITIES = ["trivial", "small", "medium", "large", "epic"] as const;

/** Static class names so Tailwind can see them. `dot` also tints rings. */
export const STATUS_STYLE: Record<
  PlanTaskStatus,
  { label: string; dot: string; border: string; chip: string; text: string }
> = {
  backlog: {
    label: "Backlog",
    dot: "bg-status-backlog",
    border: "border-status-backlog",
    chip: "bg-status-backlog/20",
    text: "text-status-backlog",
  },
  available: {
    label: "Available",
    dot: "bg-info",
    border: "border-info",
    chip: "bg-info/15",
    text: "text-info",
  },
  claimed: {
    label: "Claimed",
    dot: "bg-status-claimed",
    border: "border-status-claimed",
    chip: "bg-status-claimed/15",
    text: "text-status-claimed",
  },
  in_progress: {
    label: "In progress",
    dot: "bg-warning",
    border: "border-warning",
    chip: "bg-warning/15",
    text: "text-warning",
  },
  in_review: {
    label: "In review",
    dot: "bg-chart-5",
    border: "border-chart-5",
    chip: "bg-chart-5/15",
    text: "text-chart-5",
  },
  done: {
    label: "Done",
    dot: "bg-success",
    border: "border-success",
    chip: "bg-success/15",
    text: "text-success",
  },
  blocked: {
    label: "Blocked",
    dot: "bg-destructive",
    border: "border-destructive",
    chip: "bg-destructive/15",
    text: "text-destructive",
  },
};

export const PRIORITY_STYLE: Record<PlanTaskPriority, { label: string; dot: string }> = {
  critical: { label: "Critical", dot: "bg-destructive" },
  high: { label: "High", dot: "bg-priority-high" },
  medium: { label: "Medium", dot: "bg-warning" },
  low: { label: "Low", dot: "bg-info" },
};

const ADVANCE_ORDER: readonly PlanTaskStatus[] = [
  "backlog",
  "available",
  "claimed",
  "in_progress",
  "in_review",
  "done",
];

/** What the status circle on a card does when clicked. */
export function nextStatus(status: PlanTaskStatus): PlanTaskStatus {
  if (status === "done") return "available";
  if (status === "blocked") return "in_progress";
  return ADVANCE_ORDER[ADVANCE_ORDER.indexOf(status) + 1] ?? "done";
}

/** Tooltip for that circle. */
export function advanceTip(status: PlanTaskStatus): string {
  if (status === "done") return "Reopen";
  if (status === "blocked") return "Unblock: move to In progress";
  return `Move to ${STATUS_STYLE[nextStatus(status)].label}`;
}

export function statusHint(status: PlanTaskStatus): string {
  if (status === "available") return "Ready: agents can claim this task.";
  if (status === "blocked") return "Blocked tasks are skipped by agents.";
  return "";
}

/** Section colours cycle through the chart tokens unless one was chosen. */
export const SECTION_PALETTE = [
  "var(--chart-3)",
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-5)",
  "var(--chart-4)",
] as const;

export function sectionColor(color: string | null | undefined, index: number): string {
  return color?.trim() ? color : SECTION_PALETTE[index % SECTION_PALETTE.length];
}

/** A task's own colour, or null: it then shows no stripe at all. */
export function taskColor(color: string | null | undefined): string | null {
  return color?.trim() ? color : null;
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

export function tasksOf(plan: Pick<PlanWithSections, "sections"> | null | undefined) {
  return (plan?.sections ?? []).flatMap((section) => section.tasks ?? []);
}

export function progressOf(tasks: ReadonlyArray<Pick<TaskWithAgent, "status">>): {
  done: number;
  total: number;
  percent: number;
} {
  const done = tasks.filter((task) => task.status === "done").length;
  return {
    done,
    total: tasks.length,
    percent: tasks.length === 0 ? 0 : Math.round((done / tasks.length) * 100),
  };
}

export function countByStatus(
  tasks: ReadonlyArray<Pick<TaskWithAgent, "status">>,
): Record<PlanTaskStatus, number> {
  const counts = Object.fromEntries(TASK_STATUSES.map((s) => [s, 0])) as Record<
    PlanTaskStatus,
    number
  >;
  for (const task of tasks) counts[task.status] += 1;
  return counts;
}

/** Open questions on the plan, and how many of them hold a task up. */
export function planQuestionCounts(tasks: ReadonlyArray<Pick<TaskWithAgent, "questions">>): {
  open: number;
  blocking: number;
} {
  let open = 0;
  let blocking = 0;
  for (const task of tasks) {
    const counts = questionCounts(task.questions);
    open += counts.open;
    blocking += counts.blocking;
  }
  return { open, blocking };
}

/** "Needs you": the states where a person has to act. */
export function attentionChips(
  tasks: ReadonlyArray<Pick<TaskWithAgent, "status">>,
): Array<{ status: PlanTaskStatus; label: string; count: number }> {
  const counts = countByStatus(tasks);
  const chips: Array<{ status: PlanTaskStatus; label: string; count: number }> = [];
  if (counts.in_review > 0)
    chips.push({
      status: "in_review",
      label: `${counts.in_review} to review`,
      count: counts.in_review,
    });
  if (counts.blocked > 0)
    chips.push({ status: "blocked", label: `${counts.blocked} blocked`, count: counts.blocked });
  return chips;
}

/** Distinct agents holding a task that is not finished. */
export function workingAgentCount(tasks: ReadonlyArray<TaskWithAgent>): number {
  return new Set(
    tasks
      .filter(
        (task) => task.assigned_agent_id && task.status !== "done" && task.status !== "backlog",
      )
      .map((task) => task.assigned_agent_id),
  ).size;
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

export type WhoFilter = "all" | "me" | "agents" | "none";

export interface TaskFilters {
  q: string;
  status: PlanTaskStatus | null;
  who: WhoFilter;
  priority: PlanTaskPriority | null;
  /** Only tasks (or tasks in sections) carrying this tag. */
  tag: string | null;
  /** Only tasks with an open question. */
  questions: boolean;
}

export const NO_FILTERS: TaskFilters = {
  q: "",
  status: null,
  who: "all",
  priority: null,
  tag: null,
  questions: false,
};

export const WHO_LABEL: Record<WhoFilter, string> = {
  all: "Everyone",
  me: "Mine",
  agents: "Agents",
  none: "Unassigned",
};

export function hasActiveFilters(filters: TaskFilters): boolean {
  return Boolean(
    filters.status ||
    filters.q.trim() ||
    filters.who !== "all" ||
    filters.priority ||
    filters.tag ||
    filters.questions,
  );
}

/**
 * Search looks at the title, the tags, the description and the id (paste one
 * from a chat or an agent and it finds the task).
 */
export function matchesSearch(
  task: Pick<TaskWithAgent, "id" | "title" | "description" | "labels">,
  query: string,
  extraTags: readonly string[] = [],
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (task.title.toLowerCase().includes(q)) return true;
  if ((task.description ?? "").toLowerCase().includes(q)) return true;
  const bare = q.replace(/^#/, "");
  if ([...(task.labels ?? []), ...extraTags].some((tag) => tag.includes(bare))) return true;
  return matchesIdQuery(task.id, q);
}

export function matchesFilters(
  task: TaskWithAgent,
  filters: TaskFilters,
  meId: string | null | undefined,
  sectionTags: readonly string[] = [],
): boolean {
  if (filters.status && task.status !== filters.status) return false;
  if (filters.priority && task.priority !== filters.priority) return false;
  if (
    filters.tag &&
    !(task.labels ?? []).includes(filters.tag) &&
    !sectionTags.includes(filters.tag)
  ) {
    return false;
  }
  if (filters.questions && questionCounts(task.questions).open === 0) return false;
  if (!matchesSearch(task, filters.q, sectionTags)) return false;
  switch (filters.who) {
    case "me":
      return Boolean(meId) && task.assigned_user_id === meId;
    case "agents":
      return Boolean(task.assigned_agent_id);
    case "none":
      return !task.assigned_agent_id && !task.assigned_user_id;
    default:
      return true;
  }
}

/** Tasks in board reading order (section by section), after filtering. */
export function boardOrder(
  plan: Pick<PlanWithSections, "sections"> | null | undefined,
  filters: TaskFilters,
  meId: string | null | undefined,
): string[] {
  const ids: string[] = [];
  for (const section of plan?.sections ?? []) {
    for (const task of sortedTasks(section.tasks ?? [])) {
      if (matchesFilters(task, filters, meId, section.tags ?? [])) ids.push(task.id);
    }
  }
  return ids;
}

export function sortedTasks<T extends { position: number | null; created_at?: string }>(
  tasks: readonly T[],
): T[] {
  return [...tasks].sort(
    (a, b) =>
      (a.position ?? 0) - (b.position ?? 0) ||
      (a.created_at ?? "").localeCompare(b.created_at ?? ""),
  );
}

// ---------------------------------------------------------------------------
// Moving tasks
// ---------------------------------------------------------------------------

/**
 * The target section's ids after dropping `taskId` before `beforeId` (or at the
 * end when there is no `beforeId`, or it is not in the section).
 */
export function placeTask(
  sectionOrder: readonly string[],
  taskId: string,
  beforeId?: string | null,
): string[] {
  const rest = sectionOrder.filter((id) => id !== taskId);
  const at = beforeId ? rest.indexOf(beforeId) : -1;
  if (at < 0) return [...rest, taskId];
  return [...rest.slice(0, at), taskId, ...rest.slice(at)];
}

/** Where a task sits now, so a move can be undone exactly. */
export function locateTask(
  plan: Pick<PlanWithSections, "sections">,
  taskId: string,
): { sectionId: string; beforeId: string | null } | null {
  for (const section of plan.sections ?? []) {
    const ordered = sortedTasks(section.tasks ?? []);
    const index = ordered.findIndex((task) => task.id === taskId);
    if (index >= 0) {
      return { sectionId: section.id, beforeId: ordered[index + 1]?.id ?? null };
    }
  }
  return null;
}

/** Optimistic version of the server's move: renumbers the target column 1..n. */
export function applyTaskMove(
  plan: PlanWithSections,
  taskId: string,
  sectionId: string,
  beforeId?: string | null,
): PlanWithSections {
  const moving = tasksOf(plan).find((task) => task.id === taskId);
  if (!moving || !plan.sections.some((section) => section.id === sectionId)) return plan;

  const targetOrder = placeTask(
    sortedTasks(plan.sections.find((s) => s.id === sectionId)?.tasks ?? []).map((t) => t.id),
    taskId,
    beforeId,
  );

  return {
    ...plan,
    sections: plan.sections.map((section) => {
      if (section.id === sectionId) {
        const byId = new Map(
          [...(section.tasks ?? []), moving].map((task) => [task.id, task] as const),
        );
        return {
          ...section,
          tasks: targetOrder.map((id, index) => ({
            ...byId.get(id)!,
            section_id: sectionId,
            position: index + 1,
          })),
        };
      }
      return { ...section, tasks: (section.tasks ?? []).filter((task) => task.id !== taskId) };
    }),
  };
}

/** The section ids after dropping `sectionId` before `beforeId` (or last). */
export function placeSection(
  order: readonly string[],
  sectionId: string,
  beforeId?: string | null,
): string[] {
  return placeTask(order, sectionId, beforeId);
}

/** Optimistic version of the server's section reorder. */
export function applySectionMove(
  plan: PlanWithSections,
  sectionId: string,
  beforeId?: string | null,
): PlanWithSections {
  const sections = [...plan.sections].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  if (!sections.some((section) => section.id === sectionId)) return plan;
  const order = placeSection(
    sections.map((section) => section.id),
    sectionId,
    beforeId,
  );
  const byId = new Map(sections.map((section) => [section.id, section] as const));
  return {
    ...plan,
    sections: order.map((id, index) => ({ ...byId.get(id)!, position: index + 1 })),
  };
}

export function patchSectionInPlan(
  plan: PlanWithSections,
  sectionId: string,
  patch: Partial<PlanWithSections["sections"][number]>,
): PlanWithSections {
  return {
    ...plan,
    sections: plan.sections.map((section) =>
      section.id === sectionId ? { ...section, ...patch } : section,
    ),
  };
}

export function patchTaskInPlan(
  plan: PlanWithSections,
  taskId: string,
  patch: Partial<TaskWithAgent>,
): PlanWithSections {
  return {
    ...plan,
    sections: plan.sections.map((section) => ({
      ...section,
      tasks: (section.tasks ?? []).map((task) =>
        task.id === taskId ? { ...task, ...patch } : task,
      ),
    })),
  };
}

export function removeTaskFromPlan(plan: PlanWithSections, taskId: string): PlanWithSections {
  return {
    ...plan,
    sections: plan.sections.map((section) => ({
      ...section,
      tasks: (section.tasks ?? []).filter((task) => task.id !== taskId),
    })),
  };
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export type FileKindFilter = "all" | PlanAttachmentKind | "docs";

/** A marked-up copy supersedes its original; removing the copy restores it. */
export function visibleAttachments<T extends { id: string; source_attachment_id: string | null }>(
  attachments: readonly T[],
): T[] {
  const superseded = new Set(
    attachments.map((a) => a.source_attachment_id).filter((id): id is string => Boolean(id)),
  );
  return attachments.filter((a) => !superseded.has(a.id));
}

export function matchesFileKind(mime: string | null | undefined, filter: FileKindFilter): boolean {
  if (filter === "all") return true;
  const kind = attachmentKindOf(mime);
  // Audio has no chip of its own; it lives with documents.
  if (filter === "docs") return kind === "doc" || kind === "audio";
  return kind === filter;
}

/** Files on a task, by task. Files on the plan itself belong to no task and are left out: see `planLevelAttachments`. */
export function groupAttachmentsByTask(
  attachments: readonly PlanAttachmentWithUrl[],
): Map<string, PlanAttachmentWithUrl[]> {
  const map = new Map<string, PlanAttachmentWithUrl[]>();
  for (const attachment of visibleAttachments(attachments)) {
    if (!attachment.task_id) continue;
    const list = map.get(attachment.task_id) ?? [];
    list.push(attachment);
    map.set(attachment.task_id, list);
  }
  return map;
}

/** The files on the plan itself, as opposed to on one of its tasks. */
export function planLevelAttachments(
  attachments: readonly PlanAttachmentWithUrl[],
): PlanAttachmentWithUrl[] {
  return visibleAttachments(attachments).filter((attachment) => !attachment.task_id);
}

/** Images that can be a card cover, newest upload last. */
export function coverImages(attachments: readonly PlanAttachmentWithUrl[]) {
  return attachments.filter((a) => attachmentKindOf(a.mime_type) === "image" && a.url);
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return parts
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function pluralize(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 45) return "Just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

/** Verb phrase in front of the task name in the activity panel. */
export const EVENT_VERB: Record<string, string> = {
  task_created: "created",
  task_updated: "updated",
  task_claimed: "claimed",
  task_unclaimed: "released",
  task_started: "started work on",
  task_completed: "completed",
  task_blocked: "blocked",
  task_reviewed: "reviewed",
  pr_opened: "opened a pull request on",
  pr_merged: "merged a pull request on",
  pr_closed: "closed a pull request on",
  comment_added: "commented on",
  task_moved: "moved",
  attachment_added: "attached a file to",
  attachment_removed: "removed a file from",
  task_deleted: "deleted a task",
  question_asked: "asked a question on",
  question_answered: "answered a question on",
  section_created: "added a section",
  section_updated: "updated a section",
  plan_created: "created this plan",
  plan_activated: "activated this plan",
  plan_completed: "completed this plan",
  agent_registered: "registered as an agent",
  agent_deactivated: "was deactivated",
};

export function eventVerb(kind: string): string {
  return EVENT_VERB[kind] ?? kind.replace(/_/g, " ");
}

/** Event kind to record for a status change made by a person. */
export function eventKindForStatus(status: PlanTaskStatus): PlanEventKind {
  switch (status) {
    case "done":
      return "task_completed";
    case "blocked":
      return "task_blocked";
    case "in_progress":
      return "task_started";
    case "in_review":
      return "task_reviewed";
    case "claimed":
      return "task_claimed";
    default:
      return "task_updated";
  }
}

/** Short name of a task for links, toasts and the activity panel. */
export function taskHeadline(title: string): string {
  return cardFace(title).headline;
}

/** `?task=` deep link for a task on a plan. */
export function taskLink(origin: string, planId: string, taskId: string): string {
  return `${origin}/app/planner/${planId}?task=${taskId}`;
}

/** `Onboarding-checklist_v2.png` -> `Onboarding checklist v2`, for a task made from a dropped file. */
export function taskTitleFromFileName(name: string): string {
  const base = name
    .replace(/\.[^./\\]+$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (base || "New task").slice(0, 200);
}

/** True while a drag carries files from outside the page rather than a card. */
export function hasFiles(event: { dataTransfer: Pick<DataTransfer, "types"> | null }): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}
