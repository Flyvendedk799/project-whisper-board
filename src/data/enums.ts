import { Constants, type Enums } from "@/integrations/supabase/types";

/**
 * Labels and ordering for every database enum the UI renders.
 *
 * The lists come from `Constants`, which the type generator writes, so they can
 * never drift from the database. And because each label map is a
 * `Record<TheEnum, string>`, adding a value to an enum in SQL and regenerating
 * types is a compile error until it has a label — which is the point. It also
 * removes the reason every Select handler was casting `v as any`.
 */

export type TicketStatus = Enums<"ticket_status">;
export type TicketType = Enums<"ticket_type">;
export type TicketPriority = Enums<"ticket_priority">;
export type ProjectStatus = Enums<"project_status">;
export type MilestoneStatus = Enums<"milestone_status">;
export type MeetingStatus = Enums<"meeting_status">;
export type QuoteStatus = Enums<"quote_status">;
export type InvoiceStatus = Enums<"invoice_status">;
export type NotificationKind = Enums<"notification_kind">;
export type UpdateKind = Enums<"update_kind">;
export type AppRole = Enums<"app_role">;
export type ActionItemStatus = Enums<"action_item_status">;
export type TicketRelationKind = Enums<"ticket_relation_kind">;
export type PlanStatus = Enums<"plan_status">;
export type PlanTaskStatus = Enums<"plan_task_status">;
export type PlanTaskPriority = Enums<"plan_task_priority">;
export type PlanTaskComplexity = Enums<"plan_task_complexity">;
export type PlanEventKind = Enums<"plan_event_kind">;

export const TICKET_STATUSES = Constants.public.Enums.ticket_status;
export const TICKET_TYPES = Constants.public.Enums.ticket_type;
export const TICKET_PRIORITIES = Constants.public.Enums.ticket_priority;
export const PROJECT_STATUSES = Constants.public.Enums.project_status;
export const MILESTONE_STATUSES = Constants.public.Enums.milestone_status;
export const QUOTE_STATUSES = Constants.public.Enums.quote_status;
export const INVOICE_STATUSES = Constants.public.Enums.invoice_status;
export const TICKET_RELATION_KINDS = Constants.public.Enums.ticket_relation_kind;
export const PLAN_STATUSES = Constants.public.Enums.plan_status;
export const PLAN_TASK_STATUSES = Constants.public.Enums.plan_task_status;
export const PLAN_TASK_PRIORITIES = Constants.public.Enums.plan_task_priority;
export const PLAN_TASK_COMPLEXITIES = Constants.public.Enums.plan_task_complexity;

/** Semantic tone, mapped to a colour by StatusPill. */
export type Tone = "default" | "success" | "warning" | "info" | "destructive";

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  triaged: "Triaged",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  wont_fix: "Won't fix",
};

export const TICKET_STATUS_TONE: Record<TicketStatus, Tone> = {
  open: "default",
  triaged: "warning",
  in_progress: "info",
  in_review: "info",
  done: "success",
  wont_fix: "default",
};

/** Statuses that mean nobody is going to touch this again. */
export const CLOSED_TICKET_STATUSES: readonly TicketStatus[] = ["done", "wont_fix"];
export const OPEN_TICKET_STATUSES = TICKET_STATUSES.filter(
  (s) => !CLOSED_TICKET_STATUSES.includes(s),
);

/** Left-to-right order for the board. */
export const TICKET_BOARD_ORDER: readonly TicketStatus[] = [
  "open",
  "triaged",
  "in_progress",
  "in_review",
  "done",
];

export const TICKET_TYPE_LABEL: Record<TicketType, string> = {
  bug: "Bug",
  feature: "Feature",
  question: "Question",
  feedback: "Feedback",
  change_request: "Change",
};

/** What a client is actually reporting, in their words rather than ours. */
export const TICKET_TYPE_PROMPT: Record<TicketType, string> = {
  bug: "Something is broken",
  feature: "I'd like something new",
  question: "I have a question",
  feedback: "I have some feedback",
  change_request: "I'd like something changed",
};

export const TICKET_PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

export const TICKET_PRIORITY_TONE: Record<TicketPriority, Tone> = {
  low: "info",
  medium: "default",
  high: "warning",
  urgent: "destructive",
};

/** Descending, so "most urgent first" is a sort by this. */
export const TICKET_PRIORITY_RANK: Record<TicketPriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  discovery: "Discovery",
  proposal: "Proposal",
  in_progress: "In progress",
  review: "In review",
  done: "Done",
  archived: "Archived",
};

export const PROJECT_STATUS_TONE: Record<ProjectStatus, Tone> = {
  discovery: "default",
  proposal: "warning",
  in_progress: "info",
  review: "info",
  done: "success",
  archived: "default",
};

export const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  pending: "Not started",
  in_progress: "In progress",
  done: "Done",
};

export const MILESTONE_STATUS_TONE: Record<MilestoneStatus, Tone> = {
  pending: "default",
  in_progress: "info",
  done: "success",
};

export const MEETING_STATUS_LABEL: Record<MeetingStatus, string> = {
  scheduled: "Scheduled",
  completed: "Completed",
  cancelled: "Cancelled",
};

export const MEETING_STATUS_TONE: Record<MeetingStatus, Tone> = {
  scheduled: "info",
  completed: "success",
  cancelled: "default",
};

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  sent: "Awaiting response",
  accepted: "Accepted",
  declined: "Declined",
  expired: "Expired",
};

export const QUOTE_STATUS_TONE: Record<QuoteStatus, Tone> = {
  draft: "default",
  sent: "info",
  accepted: "success",
  declined: "destructive",
  expired: "warning",
};

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  draft: "Draft",
  sent: "Awaiting payment",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

export const INVOICE_STATUS_TONE: Record<InvoiceStatus, Tone> = {
  draft: "default",
  sent: "info",
  paid: "success",
  overdue: "destructive",
  void: "default",
};

export const NOTIFICATION_KIND_LABEL: Record<NotificationKind, string> = {
  mention: "Mentions",
  comment: "Replies",
  ticket_update: "Ticket updates",
  milestone: "Milestones",
  invoice: "Invoices",
  meeting: "Meetings",
};

export const NOTIFICATION_KIND_DESCRIPTION: Record<NotificationKind, string> = {
  mention: "Someone writes @you in a comment.",
  comment: "Someone replies on a ticket you're following.",
  ticket_update: "A ticket's status, priority or ETA changes.",
  milestone: "A milestone is completed.",
  invoice: "An invoice is sent, paid or falls overdue.",
  meeting: "A meeting is scheduled, moved or wrapped up.",
};

/** Sentence fragments completing "<who> ..." in the activity feed. */
export const UPDATE_KIND_LABEL: Record<UpdateKind, string> = {
  post: "posted an update",
  ticket_opened: "opened a ticket",
  ticket_closed: "closed a ticket",
  milestone_done: "completed a milestone",
  meeting_held: "held a meeting",
  invoice_paid: "recorded a payment",
};

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: "Admin",
  client_admin: "Lead contact",
  client: "Client",
};

export const ROLE_DESCRIPTION: Record<AppRole, string> = {
  admin: "Runs the workspace. Sees everything, including internal notes.",
  client_admin: "A client's lead contact. Can invite their own teammates.",
  client: "Sees their own projects, tickets, meetings and invoices.",
};

export const ACTION_ITEM_STATUS_LABEL: Record<ActionItemStatus, string> = {
  open: "Open",
  converted: "Made into a ticket",
  done: "Done",
  dismissed: "Dismissed",
};

export const TICKET_RELATION_LABEL: Record<TicketRelationKind, string> = {
  duplicate_of: "Duplicate of",
  blocks: "Blocks",
  blocked_by: "Blocked by",
  relates_to: "Relates to",
  parent_of: "Parent of",
};

/** Turning a relation around when showing it from the other ticket's side. */
export const TICKET_RELATION_INVERSE: Record<TicketRelationKind, TicketRelationKind> = {
  duplicate_of: "duplicate_of",
  blocks: "blocked_by",
  blocked_by: "blocks",
  relates_to: "relates_to",
  parent_of: "parent_of",
};

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  archived: "Archived",
};

export const PLAN_STATUS_TONE: Record<PlanStatus, Tone> = {
  draft: "default",
  active: "success",
  paused: "warning",
  completed: "info",
  archived: "default",
};

export const PLAN_TASK_STATUS_LABEL: Record<PlanTaskStatus, string> = {
  backlog: "Backlog",
  available: "Available",
  claimed: "Claimed",
  in_progress: "In progress",
  in_review: "In review",
  done: "Done",
  blocked: "Blocked",
};

export const PLAN_TASK_STATUS_TONE: Record<PlanTaskStatus, Tone> = {
  backlog: "default",
  available: "info",
  claimed: "warning",
  in_progress: "info",
  in_review: "warning",
  done: "success",
  blocked: "destructive",
};

/** Board column order — tasks flow left to right through this pipeline. */
export const PLAN_TASK_BOARD_ORDER: readonly PlanTaskStatus[] = [
  "backlog",
  "available",
  "claimed",
  "in_progress",
  "in_review",
  "done",
];

export const PLAN_TASK_PRIORITY_LABEL: Record<PlanTaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

export const PLAN_TASK_PRIORITY_TONE: Record<PlanTaskPriority, Tone> = {
  low: "info",
  medium: "default",
  high: "warning",
  critical: "destructive",
};

export const PLAN_TASK_PRIORITY_RANK: Record<PlanTaskPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const PLAN_TASK_COMPLEXITY_LABEL: Record<PlanTaskComplexity, string> = {
  trivial: "Trivial",
  small: "Small",
  medium: "Medium",
  large: "Large",
  epic: "Epic",
};

export const PLAN_EVENT_KIND_LABEL: Record<PlanEventKind, string> = {
  task_created: "created a task",
  task_updated: "updated a task",
  task_claimed: "claimed a task",
  task_unclaimed: "released a task",
  task_started: "started work on a task",
  task_completed: "completed a task",
  task_blocked: "blocked a task",
  task_reviewed: "reviewed a task",
  pr_opened: "opened a pull request",
  pr_merged: "merged a pull request",
  pr_closed: "closed a pull request",
  section_created: "created a section",
  section_updated: "updated a section",
  plan_created: "created a plan",
  plan_activated: "activated a plan",
  plan_completed: "completed a plan",
  agent_registered: "registered as an agent",
  agent_deactivated: "was deactivated",
  comment_added: "commented",
};

/** `[{ value, label }]` for a Select, in the database's own order. */
export function options<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): Array<{ value: T; label: string }> {
  return values.map((value) => ({ value, label: labels[value] }));
}
