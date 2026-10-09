/**
 * The client layer of a plan, as plain types and helpers.
 *
 * A plan has two layers. The agency layer (tasks, steps, goals, comments, files)
 * is where the agency and its AI agents work, and is workspace-admin only. The
 * client layer is what a client of a shared plan sees: per section a short
 * plain-language summary (Danish), progress, and their own comments and approval.
 */

export type ClientSection = {
  id: string;
  title: string;
  color: string | null;
  position: number;
  client_summary: string | null;
  task_count: number;
  done_task_count: number;
};

export type ClientPlanOverview = {
  id: string;
  title: string;
  status: string;
  project_id: string | null;
  updated_at: string;
  sections: ClientSection[];
};

export type ClientPerson = {
  id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
};

export type ClientComment = {
  id: string;
  section_id: string | null;
  body: string;
  created_at: string;
  author: ClientPerson | null;
};

export type ClientApproval = {
  section_id: string;
  user_id: string;
  created_at: string;
  user: ClientPerson | null;
};

export type ClientPlanView = {
  plan: ClientPlanOverview;
  comments: ClientComment[];
  approvals: ClientApproval[];
};

export const CLIENT_SUMMARY_MAX = 2000;
export const CLIENT_COMMENT_MAX = 4000;

/** Whole-plan progress across the sections, for the overview header. */
export function overallProgress(
  sections: ReadonlyArray<Pick<ClientSection, "task_count" | "done_task_count">>,
) {
  const total = sections.reduce((sum, section) => sum + section.task_count, 0);
  const done = sections.reduce((sum, section) => sum + section.done_task_count, 0);
  return { total, done, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

/** A section's progress as a percentage; 0 when it has no tasks yet. */
export function sectionPercent(section: Pick<ClientSection, "task_count" | "done_task_count">) {
  return section.task_count === 0
    ? 0
    : Math.round((section.done_task_count / section.task_count) * 100);
}

/** A Danish status for a section, from its counts. */
export function sectionStatusDa(
  section: Pick<ClientSection, "task_count" | "done_task_count">,
): "Ikke startet" | "I gang" | "Færdig" {
  if (section.task_count > 0 && section.done_task_count === section.task_count) return "Færdig";
  if (section.done_task_count > 0) return "I gang";
  return "Ikke startet";
}

export function personName(person: ClientPerson | null | undefined, fallback = "Bureauet") {
  return person?.full_name?.trim() || person?.email?.trim() || fallback;
}

const PLAN_STATUS_DA: Record<string, string> = {
  draft: "Udkast",
  active: "I gang",
  paused: "På pause",
  completed: "Afsluttet",
  archived: "Arkiveret",
};

export function planStatusDa(status: string | null | undefined): string {
  return PLAN_STATUS_DA[status ?? "draft"] ?? "Udkast";
}

/** "lige nu", "5 min. siden", "3 t. siden", "2 d. siden", else the date. */
export function formatRelativeDa(
  value: string | Date | null | undefined,
  now = Date.now(),
): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  const minutes = Math.round((now - date.getTime()) / 60000);
  if (minutes < 1) return "lige nu";
  if (minutes < 60) return `${minutes} min. siden`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} t. siden`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d. siden`;
  return date.toLocaleDateString("da-DK", { day: "numeric", month: "short", year: "numeric" });
}
