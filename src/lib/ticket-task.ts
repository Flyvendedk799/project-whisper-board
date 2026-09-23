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
