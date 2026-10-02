import type { Database } from "@/integrations/supabase/types";

type TicketPriority = Database["public"]["Enums"]["ticket_priority"];
type TaskPriority = Database["public"]["Enums"]["plan_task_priority"];

/** Tickets that still need a planner task. Closed ones stay off the board. */
export const OPEN_TICKET_STATUSES = ["open", "triaged", "in_progress", "in_review"] as const;

export function isOpenTicketStatus(status: string): boolean {
  return (OPEN_TICKET_STATUSES as readonly string[]).includes(status);
}

/** Planner priorities use `critical` where tickets use `urgent`. */
export function ticketPriorityToTask(priority: TicketPriority): TaskPriority {
  if (priority === "urgent") return "critical";
  return priority;
}

/**
 * The row for a task made through the workspace API, with or without a ticket behind it.
 * A task someone puts on a plan is ready to work, like one made in the app or through the
 * planner API; left to the column default it would sit in `backlog`, where an agent cannot
 * claim it.
 */
export function linkedTaskRow(input: {
  planId: string;
  sectionId: string;
  position: number;
  title: string;
  description: string | null;
  priority?: TaskPriority;
  ticketId?: string;
  labels?: string[];
}) {
  return {
    plan_id: input.planId,
    section_id: input.sectionId,
    title: input.title,
    description: input.description,
    position: input.position,
    status: "available" as const,
    ...(input.priority ? { priority: input.priority } : {}),
    ...(input.ticketId ? { ticket_id: input.ticketId } : {}),
    ...(input.labels ? { labels: input.labels } : {}),
  };
}

export function taskTitleFromTicket(title: string): string {
  return title.trim().slice(0, 200);
}

export function taskDescriptionFromTicket(ticket: {
  ticket_number: number;
  type: string;
  description: string | null;
}): string {
  const header = `From ticket #${ticket.ticket_number} (${ticket.type.replace(/_/g, " ")}).`;
  const body = ticket.description?.trim();
  return body ? `${header}\n\n${body}` : header;
}
