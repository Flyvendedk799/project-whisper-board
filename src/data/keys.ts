/**
 * Query keys, nested by prefix.
 *
 * The point of the nesting is that invalidation is a single call:
 * `qk.ticket(id)` is a prefix of its comments, events and attachments, so
 * invalidating it covers all four. `qk.tickets()` covers every list and every
 * detail. Before this the app hand-typed strings at 20+ call sites and had to
 * remember to invalidate `["projects"]` and `["projects-all"]` together in
 * three different files, which is the kind of thing that works until it
 * quietly doesn't.
 */

import type { TicketFilters } from "./filters";

export const qk = {
  all: ["cf"] as const,

  session: () => [...qk.all, "session"] as const,
  workspace: () => [...qk.all, "workspace"] as const,

  profiles: () => [...qk.all, "profiles"] as const,
  profile: (id: string) => [...qk.profiles(), id] as const,
  workspacePeople: () => [...qk.profiles(), "workspace"] as const,

  projects: () => [...qk.all, "projects"] as const,
  projectList: () => [...qk.projects(), "list"] as const,
  project: (id: string) => [...qk.projects(), "detail", id] as const,
  projectMembers: (id: string) => [...qk.project(id), "members"] as const,
  projectMilestones: (id: string) => [...qk.project(id), "milestones"] as const,
  projectMeetings: (id: string) => [...qk.project(id), "meetings"] as const,
  projectUpdates: (id: string) => [...qk.project(id), "updates"] as const,
  projectQuotes: (id: string) => [...qk.project(id), "quotes"] as const,
  projectInvoices: (id: string) => [...qk.project(id), "invoices"] as const,
  projectTimeline: (id: string) => [...qk.project(id), "timeline"] as const,
  projectTime: (id: string) => [...qk.project(id), "time"] as const,

  tickets: () => [...qk.all, "tickets"] as const,
  ticketList: (filters: TicketFilters) => [...qk.tickets(), "list", filters] as const,
  ticketCounts: () => [...qk.tickets(), "counts"] as const,
  ticket: (id: string) => [...qk.tickets(), "detail", id] as const,
  ticketComments: (id: string) => [...qk.ticket(id), "comments"] as const,
  ticketEvents: (id: string) => [...qk.ticket(id), "events"] as const,
  ticketAttachments: (id: string) => [...qk.ticket(id), "attachments"] as const,
  ticketRelations: (id: string) => [...qk.ticket(id), "relations"] as const,
  ticketContext: (id: string) => [...qk.ticket(id), "context"] as const,
  ticketTime: (id: string) => [...qk.ticket(id), "time"] as const,

  meetings: () => [...qk.all, "meetings"] as const,
  meetingActionItems: (id: string) => [...qk.meetings(), id, "action-items"] as const,

  notifications: () => [...qk.all, "notifications"] as const,
  notificationList: () => [...qk.notifications(), "list"] as const,
  notificationCount: () => [...qk.notifications(), "count"] as const,
  notificationPrefs: () => [...qk.notifications(), "prefs"] as const,

  savedViews: () => [...qk.all, "saved-views"] as const,

  timer: () => [...qk.all, "timer"] as const,

  dashboard: () => [...qk.all, "dashboard"] as const,

  outbox: () => [...qk.all, "outbox"] as const,
  appErrors: () => [...qk.all, "app-errors"] as const,

  // AI Planner
  plans: () => [...qk.all, "plans"] as const,
  planList: () => [...qk.plans(), "list"] as const,
  plan: (id: string) => [...qk.plans(), "detail", id] as const,
  planSections: (id: string) => [...qk.plan(id), "sections"] as const,
  planTasks: (id: string) => [...qk.plan(id), "tasks"] as const,
  planEvents: (id: string) => [...qk.plan(id), "events"] as const,
  planAgents: () => [...qk.all, "plan-agents"] as const,
  taskComments: (id: string) => [...qk.all, "task-comments", id] as const,
  apiKeys: () => [...qk.all, "api-keys"] as const,
} as const;
